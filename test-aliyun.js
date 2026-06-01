const crypto = require('crypto');

const ALIYUN_ENDPOINT = "vision.cn-shanghai.aliyuncs.com";
const ALIYUN_API_VERSION = "2019-03-28";

function getSignature(params, secret) {
  const sortedKeys = Object.keys(params).sort();
  let canonicalString = "";
  for (const key of sortedKeys) {
    canonicalString += `${key}${params[key]}`;
  }
  const hmac = crypto.createHmac("sha1", secret);
  const signature = hmac.update(Buffer.from(canonicalString, "utf8")).digest("base64");
  return signature;
}

function getTimestamp() {
  const date = new Date();
  return date.toISOString().replace(/[-T:\.Z]/g, "");
}

async function testTryOn() {
  const accessKeyId = process.env.ALIYUN_ACCESS_KEY_ID;
  const accessKeySecret = process.env.ALIYUN_ACCESS_KEY_SECRET;

  if (!accessKeyId || !accessKeySecret) {
    console.error("请设置环境变量 ALIYUN_ACCESS_KEY_ID 和 ALIYUN_ACCESS_KEY_SECRET");
    return;
  }

  const testPersonImage = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/4QBYRXhpZgAATU0AKgAAAAgAAgESAAMAAAABAAEAAIdpAAQAAAABAAAAMgAAAAEBAAMAAAABAAEAAKACAAQAAAABAAAAMKADAAQAAAABAAAAMAAAAABESUREAAEAAAABAAMAAAABAAIAAAAEAAMAAAABAAgAAAEaAAUAAAABAAAAnqACAAQAAAABAAAAnAAAAABJRU5ErkJggg==";
  const testClothImage = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/4QBYRXhpZgAATU0AKgAAAAgAAgESAAMAAAABAAEAAIdpAAQAAAABAAAAMgAAAAEBAAMAAAABAAEAAKACAAQAAAABAAAAMKADAAQAAAABAAAAMAAAAABJRU5ErkJggg==";

  const personBuffer = Buffer.from(testPersonImage.split(",")[1], "base64");
  const clothBuffer = Buffer.from(testClothImage.split(",")[1], "base64");

  const personBlob = new Blob([personBuffer], { type: "image/jpeg" });
  const clothBlob = new Blob([clothBuffer], { type: "image/jpeg" });

  const formData = new FormData();
  formData.append("ImageUrl", "");
  formData.append("ImageData", personBlob, "person.jpg");
  formData.append("ClothUrl", "");
  formData.append("ClothData", clothBlob, "cloth.jpg");
  formData.append("Action", "VirtualTryOn");
  formData.append("Version", ALIYUN_API_VERSION);
  formData.append("Format", "JSON");
  formData.append("AccessKeyId", accessKeyId);
  formData.append("SignatureMethod", "HMAC-SHA1");
  formData.append("Timestamp", getTimestamp());
  formData.append("SignatureVersion", "1.0");
  formData.append("SignatureNonce", crypto.randomUUID());

  const params = {
    Action: "VirtualTryOn",
    Version: ALIYUN_API_VERSION,
    Format: "JSON",
    AccessKeyId: accessKeyId,
    SignatureMethod: "HMAC-SHA1",
    Timestamp: formData.get("Timestamp"),
    SignatureVersion: "1.0",
    SignatureNonce: formData.get("SignatureNonce"),
  };

  const signature = getSignature(params, accessKeySecret + "&");
  formData.append("Signature", signature);

  console.log("发送请求到阿里云...");
  console.log("参数:", Object.keys(params));

  try {
    console.log("URL:", `https://${ALIYUN_ENDPOINT}/`);
    
    const response = await fetch(`https://${ALIYUN_ENDPOINT}/`, {
      method: "POST",
      body: formData,
    });

    console.log("响应状态:", response.status, response.statusText);
    
    const text = await response.text();
    console.log("响应原始内容:", text);
    
    let payload;
    try {
      payload = JSON.parse(text);
      console.log("响应JSON:", JSON.stringify(payload, null, 2));
    } catch (e) {
      console.log("解析JSON失败:", e.message);
    }

    if (!response.ok || (payload && payload.Code !== "OK")) {
      console.error("错误:", payload?.Message || "请求失败");
    } else {
      console.log("成功!");
    }
  } catch (error) {
    console.error("异常:", error.message);
    console.error("异常详情:", error);
    if (error.code) console.error("错误代码:", error.code);
    if (error.cause) console.error("错误原因:", error.cause);
  }
}

testTryOn();
