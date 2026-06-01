const fs = require("fs");
const path = require("path");

const SERVER = "http://localhost:5188";

async function test() {
  console.log("云试衣间 E2E 测试");
  console.log("Server:", SERVER);
  console.log("");

  try {
    await fetch(SERVER);
    console.log("[OK] 服务器可达");
  } catch (e) {
    console.error("[FAIL] 服务器不可达:", e.message);
    process.exit(1);
  }

  const uploadsDir = path.join(__dirname, "uploads");
  const files = fs.existsSync(uploadsDir) ? fs.readdirSync(uploadsDir) : [];
  const personFiles = files.filter(f => f.startsWith("person_"));
  const clothFiles = files.filter(f => f.startsWith("cloth_"));

  let personBase64, clothBase64;

  if (personFiles.length > 0 && clothFiles.length > 0) {
    const personBuf = fs.readFileSync(path.join(uploadsDir, personFiles[0]));
    const clothBuf = fs.readFileSync(path.join(uploadsDir, clothFiles[0]));
    personBase64 = personBuf.toString("base64");
    clothBase64 = clothBuf.toString("base64");
    console.log("[INFO] 使用本地已上传的图片");
    console.log("  人物:", personFiles[0], "大小:", (personBuf.length / 1024).toFixed(1), "KB");
    console.log("  衣服:", clothFiles[0], "大小:", (clothBuf.length / 1024).toFixed(1), "KB");
  } else {
    console.error("[FAIL] uploads 目录下没有图片文件，请先通过浏览器上传图片");
    process.exit(1);
  }

  const personImage = `data:image/jpeg;base64,${personBase64}`;
  const clothImage = `data:image/jpeg;base64,${clothBase64}`;

  console.log("\n[INFO] 发送 POST /api/tryon ...");
  const t0 = Date.now();

  const resp = await fetch(`${SERVER}/api/tryon`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ personImage, clothImage }),
  });

  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  const payload = await resp.json();

  console.log(`  状态: ${resp.status} | 耗时: ${elapsed}s`);

  if (!resp.ok) {
    console.error("[FAIL]", payload.error);
    process.exit(1);
  }

  if (!payload.image || !payload.image.startsWith("data:image")) {
    console.error("[FAIL] 返回值不是图片");
    process.exit(1);
  }

  const out = path.join(__dirname, "test-result.jpg");
  fs.writeFileSync(out, Buffer.from(payload.image.split(",")[1], "base64"));
  const sizeKB = (fs.statSync(out).size / 1024).toFixed(1);

  console.log("\n====================================");
  console.log(" [PASS] AI 试衣成功！");
  console.log(" 结果: test-result.jpg");
  console.log(` 大小: ${sizeKB} KB | 耗时: ${elapsed}s`);
  console.log(" 浏览器打开 http://localhost:5188 测试");
  console.log("====================================");
}

test();