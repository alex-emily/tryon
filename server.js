const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ROOT = __dirname;
const IS_PRODUCTION = process.env.NODE_ENV === "production";

const PUBLIC_FILES = new Set([
  "index.html",
  "styles.css",
  "api-config.js",
  "app.js",
  "upload-module.js",
  "tryon-generator.js",
  "promo-tile-a.jpg",
  "promo-tile-b.jpg",
  "promo-tile-c.jpg",
]);

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
};

const rateBuckets = new Map();
const activeByIp = new Map();
let activeGenerations = 0;

class PublicError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.statusCode = statusCode;
    this.expose = true;
  }
}

function loadEnvFile(fileName) {
  const filePath = path.join(ROOT, fileName);
  if (!fs.existsSync(filePath)) return;

  const content = fs.readFileSync(filePath, "utf8");
  content.split(/\r?\n/).forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return;

    const match = trimmed.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/i);
    if (!match) return;

    const [, key, rawValue] = match;
    if (process.env[key]) return;

    process.env[key] = rawValue.replace(/^["']|["']$/g, "");
  });
}

loadEnvFile(".env.local");
loadEnvFile(".env");

const PORT = Number(process.env.PORT || 5188);
const MAX_BODY_BYTES = Number(process.env.MAX_BODY_MB || 36) * 1024 * 1024;
const MAX_IMAGE_BYTES = Number(process.env.MAX_IMAGE_MB || 14) * 1024 * 1024;
const OSS_SIGN_EXPIRES_SECONDS = Number(process.env.OSS_SIGN_EXPIRES_SECONDS || 900);
const TRYON_RATE_LIMIT = Number(process.env.TRYON_RATE_LIMIT || 6);
const TRYON_RATE_WINDOW_MS = Number(process.env.TRYON_RATE_WINDOW_MS || 60 * 60 * 1000);
const MAX_ACTIVE_GENERATIONS = Number(process.env.MAX_ACTIVE_GENERATIONS || 2);
const ALIYUN_ENDPOINT = "dashscope.aliyuncs.com";
const SERVER_VERSION = "2026-06-02-env-alias-v2";

function firstEnv(...keys) {
  for (const key of keys) {
    const value = process.env[key];
    if (value) return value;
  }
  return "";
}

function getConfig() {
  const config = {
    aliyunApiKey: firstEnv("ALIYUN_API_KEY", "DASHSCOPE_API_KEY"),
    ossBucket: firstEnv("ALIYUN_OSS_BUCKET", "OSS_BUCKET"),
    ossEndpoint: firstEnv("ALIYUN_OSS_ENDPOINT", "OSS_ENDPOINT"),
    ossAccessKeyId: firstEnv(
      "ALIYUN_ACCESS_KEY_ID",
      "ALIYUN_ACCESS_KEYID",
      "OSS_ACCESS_KEY_ID",
      "OSS_ACCESS_KEYID",
      "OSSAccessKeyId",
      "OSSAccessKeyID",
      "ossAccessKeyId",
      "ossAccessKeyID",
    ),
    ossAccessKeySecret: firstEnv(
      "ALIYUN_ACCESS_KEY_SECRET",
      "ALIYUN_ACCESS_KEYSECRET",
      "OSS_ACCESS_KEY_SECRET",
      "OSS_ACCESS_KEYSECRET",
      "OSSAccessKeySecret",
      "ossAccessKeySecret",
    ),
  };

  const missing = Object.entries(config)
    .filter(([, value]) => !value)
    .map(([key]) => key);

  if (missing.length > 0) {
    throw new PublicError(`服务端缺少必要环境变量：${missing.join(", ")}`, 500);
  }

  return config;
}

function baseSecurityHeaders(extra = {}) {
  return {
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "X-Frame-Options": "DENY",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
    "Content-Security-Policy": [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com",
      "img-src 'self' data: blob:",
      "connect-src 'self'",
      "object-src 'none'",
      "base-uri 'self'",
      "frame-ancestors 'none'",
    ].join("; "),
    ...extra,
  };
}

function sendJson(request, response, statusCode, payload, extraHeaders = {}) {
  response.writeHead(statusCode, baseSecurityHeaders({
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    ...getCorsHeaders(request),
    ...extraHeaders,
  }));
  response.end(JSON.stringify(payload));
}

function redactUrl(value) {
  try {
    const url = new URL(value);
    return `${url.origin}${url.pathname}`;
  } catch (error) {
    return "[url hidden]";
  }
}

function getSelfOrigin(request) {
  const host = request.headers["x-forwarded-host"] || request.headers.host || "";
  const protocol = request.headers["x-forwarded-proto"] || (request.socket.encrypted ? "https" : "http");
  return `${protocol}://${host}`;
}

function getAllowedOrigins(request) {
  const configured = (process.env.ALLOWED_ORIGINS || "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

  const origins = new Set([getSelfOrigin(request), ...configured]);
  if (!IS_PRODUCTION) {
    origins.add("http://localhost:5188");
    origins.add("http://127.0.0.1:5188");
  }
  return origins;
}

function isOriginAllowed(request) {
  const origin = request.headers.origin;
  if (!origin) return true;
  return getAllowedOrigins(request).has(origin);
}

function getCorsHeaders(request) {
  const origin = request.headers.origin;
  if (!origin || !isOriginAllowed(request)) return {};

  return {
    "Access-Control-Allow-Origin": origin,
    "Vary": "Origin",
  };
}

function getClientIp(request) {
  const forwarded = request.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.trim()) {
    return forwarded.split(",")[0].trim();
  }
  return request.socket.remoteAddress || "unknown";
}

function checkRateLimit(ip) {
  const now = Date.now();
  const current = rateBuckets.get(ip);
  if (!current || now > current.resetAt) {
    rateBuckets.set(ip, {
      count: 1,
      resetAt: now + TRYON_RATE_WINDOW_MS,
    });
    return null;
  }

  if (current.count >= TRYON_RATE_LIMIT) {
    const retryAfter = Math.max(1, Math.ceil((current.resetAt - now) / 1000));
    return retryAfter;
  }

  current.count += 1;
  return null;
}

function acquireGenerationSlot(ip) {
  const ipActive = activeByIp.get(ip) || 0;
  if (activeGenerations >= MAX_ACTIVE_GENERATIONS || ipActive >= 1) {
    return false;
  }

  activeGenerations += 1;
  activeByIp.set(ip, ipActive + 1);
  return true;
}

function releaseGenerationSlot(ip) {
  activeGenerations = Math.max(0, activeGenerations - 1);
  const ipActive = activeByIp.get(ip) || 0;
  if (ipActive <= 1) {
    activeByIp.delete(ip);
  } else {
    activeByIp.set(ip, ipActive - 1);
  }
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let tooLarge = false;

    request.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        tooLarge = true;
        return;
      }
      if (!tooLarge) chunks.push(chunk);
    });

    request.on("end", () => {
      if (tooLarge) {
        reject(new PublicError("图片太大，请压缩后再上传", 413));
        return;
      }
      resolve(Buffer.concat(chunks).toString("utf8"));
    });
    request.on("error", reject);
  });
}

function parseDataImage(value, fieldName) {
  if (typeof value !== "string") {
    throw new PublicError(`${fieldName} 格式不正确`, 400);
  }

  const match = value.match(/^data:image\/(jpeg|jpg|png|webp);base64,([a-z0-9+/=\r\n]+)$/i);
  if (!match) {
    throw new PublicError(`${fieldName} 只支持 JPG、PNG 或 WebP 图片`, 400);
  }

  const subtype = match[1].toLowerCase();
  const base64 = match[2].replace(/\s/g, "");
  const buffer = Buffer.from(base64, "base64");
  if (!buffer.length || buffer.length > MAX_IMAGE_BYTES) {
    throw new PublicError(`${fieldName} 图片过大，请压缩后再上传`, 413);
  }

  const extension = subtype === "jpeg" || subtype === "jpg" ? "jpg" : subtype;
  const contentType = extension === "jpg" ? "image/jpeg" : `image/${extension}`;
  return { buffer, contentType, extension };
}

function signOSSRequest(config, method, contentType, date, resource) {
  const stringToSign = `${method}\n\n${contentType || ""}\n${date}\n${resource}`;
  return crypto.createHmac("sha1", config.ossAccessKeySecret)
    .update(stringToSign, "utf8")
    .digest("base64");
}

async function uploadToOSS(config, image, fileName) {
  const timestamp = new Date().toUTCString();
  const resource = `/${config.ossBucket}/${fileName}`;
  const signature = signOSSRequest(config, "PUT", image.contentType, timestamp, resource);
  const url = `https://${config.ossBucket}.${config.ossEndpoint}/${fileName}`;

  const uploadResponse = await fetch(url, {
    method: "PUT",
    headers: {
      "Content-Type": image.contentType,
      "Date": timestamp,
      "Authorization": `OSS ${config.ossAccessKeyId}:${signature}`,
    },
    body: image.buffer,
  });

  if (!uploadResponse.ok) {
    const errorText = await uploadResponse.text();
    throw new Error(`OSS upload failed: ${uploadResponse.status} ${errorText.slice(0, 200)}`);
  }

  const expires = Math.floor(Date.now() / 1000) + OSS_SIGN_EXPIRES_SECONDS;
  const encodedFileName = encodeURIComponent(fileName).replace(/%2F/g, "/");
  const signResource = `/${config.ossBucket}/${encodedFileName}`;
  const signString = `GET\n\n\n${expires}\n${signResource}`;
  const signSignature = crypto.createHmac("sha1", config.ossAccessKeySecret)
    .update(signString, "utf8")
    .digest("base64");
  const signedUrl = `${url}?OSSAccessKeyId=${config.ossAccessKeyId}&Expires=${expires}&Signature=${encodeURIComponent(signSignature)}`;

  console.log("[tryon] uploaded input:", redactUrl(signedUrl));
  return signedUrl;
}

async function deleteFromOSS(config, fileName) {
  const timestamp = new Date().toUTCString();
  const resource = `/${config.ossBucket}/${fileName}`;
  const signature = signOSSRequest(config, "DELETE", "", timestamp, resource);
  const url = `https://${config.ossBucket}.${config.ossEndpoint}/${fileName}`;

  const deleteResponse = await fetch(url, {
    method: "DELETE",
    headers: {
      "Date": timestamp,
      "Authorization": `OSS ${config.ossAccessKeyId}:${signature}`,
    },
  });

  if (!deleteResponse.ok && deleteResponse.status !== 404) {
    console.warn("[tryon] OSS cleanup failed:", deleteResponse.status, fileName);
  }
}

async function cleanupOSSInputs(config, fileNames) {
  if (process.env.OSS_CLEANUP_INPUTS === "false") return;
  await Promise.allSettled(fileNames.map((fileName) => deleteFromOSS(config, fileName)));
}

async function fetchResultImage(url) {
  const imageResponse = await fetch(url);
  if (!imageResponse.ok) {
    throw new Error(`Result image fetch failed: ${imageResponse.status}`);
  }
  const imageBuffer = await imageResponse.arrayBuffer();
  const base64 = Buffer.from(imageBuffer).toString("base64");
  return {
    buffer: Buffer.from(imageBuffer),
    dataUrl: `data:image/jpeg;base64,${base64}`,
  };
}

async function deletePreviousResult(config) {
  const resultFileName = "tryon/result.jpg";
  try {
    await deleteFromOSS(config, resultFileName);
    console.log("[tryon] deleted previous result from OSS");
  } catch (_) {
    // 404 or network error — safe to ignore
  }
}

async function uploadResultToOSS(config, imageBuffer) {
  const resultFileName = "tryon/result.jpg";
  try {
    const timestamp = new Date().toUTCString();
    const resource = `/${config.ossBucket}/${resultFileName}`;
    const signature = signOSSRequest(config, "PUT", "image/jpeg", timestamp, resource);
    const url = `https://${config.ossBucket}.${config.ossEndpoint}/${resultFileName}`;

    const uploadResponse = await fetch(url, {
      method: "PUT",
      headers: {
        "Content-Type": "image/jpeg",
        "Date": timestamp,
        "Authorization": `OSS ${config.ossAccessKeyId}:${signature}`,
      },
      body: imageBuffer,
    });

    if (!uploadResponse.ok) {
      const errorText = await uploadResponse.text();
      console.warn("[tryon] OSS result upload failed:", uploadResponse.status, errorText.slice(0, 200));
    } else {
      console.log("[tryon] result uploaded to OSS");
    }
  } catch (error) {
    console.warn("[tryon] OSS result upload error:", error.message);
  }
}

async function createTryOnImage(personImageData, clothImageData) {
  const config = getConfig();
  const personImage = parseDataImage(personImageData, "人物照片");
  const clothImage = parseDataImage(clothImageData, "衣服照片");
  const uploadedFileNames = [];

  try {
    const requestId = crypto.randomUUID();
    const personFileName = `tryon/${requestId}/person.${personImage.extension}`;
    const clothFileName = `tryon/${requestId}/cloth.${clothImage.extension}`;
    uploadedFileNames.push(personFileName, clothFileName);

    // 先删除上次的生成结果
    await deletePreviousResult(config);

    const personImageUrl = await uploadToOSS(config, personImage, personFileName);
    const clothImageUrl = await uploadToOSS(config, clothImage, clothFileName);

    const createTaskBody = {
      model: "aitryon",
      input: {
        person_image_url: personImageUrl,
        top_garment_url: clothImageUrl,
      },
      parameters: {
        resolution: -1,
        restore_face: true,
      },
    };

    const createResponse = await fetch(`https://${ALIYUN_ENDPOINT}/api/v1/services/aigc/image2image/image-synthesis`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${config.aliyunApiKey}`,
        "X-DashScope-Async": "enable",
      },
      body: JSON.stringify(createTaskBody),
    });

    const createText = await createResponse.text();
    let createPayload;
    try {
      createPayload = JSON.parse(createText);
    } catch (error) {
      throw new Error(`DashScope create response is not JSON: ${createText.slice(0, 200)}`);
    }

    if (!createResponse.ok) {
      throw new Error(createPayload.message || "DashScope task creation failed");
    }

    const taskId = createPayload.output?.task_id;
    if (!taskId) {
      throw new Error("DashScope did not return task_id");
    }

    console.log("[tryon] task created:", taskId);

    for (let i = 0; i < 60; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 3000));

      const queryResponse = await fetch(`https://${ALIYUN_ENDPOINT}/api/v1/tasks/${taskId}`, {
        method: "GET",
        headers: {
          "Authorization": `Bearer ${config.aliyunApiKey}`,
        },
      });

      const queryText = await queryResponse.text();
      let queryPayload;
      try {
        queryPayload = JSON.parse(queryText);
      } catch (error) {
        console.warn("[tryon] task query returned non-JSON:", queryText.slice(0, 120));
        continue;
      }

      const taskStatus = queryPayload.output?.task_status;
      console.log("[tryon] task status:", taskStatus);

      if (taskStatus === "SUCCEEDED") {
        const resultUrl = queryPayload.output?.results?.[0]?.url || queryPayload.output?.image_url;
        if (!resultUrl) {
          throw new Error("DashScope task succeeded without image URL");
        }
        const result = await fetchResultImage(resultUrl);
        // 把结果图上传到 OSS，方便下次覆盖
        await uploadResultToOSS(config, result.buffer);
        return result.dataUrl;
      }

      if (taskStatus === "FAILED") {
        throw new Error(queryPayload.output?.message || "DashScope task failed");
      }
    }

    throw new Error("DashScope task timed out");
  } finally {
    await cleanupOSSInputs(config, uploadedFileNames);
  }
}

function getClientError(error) {
  if (error.expose) return error.message;
  if (!IS_PRODUCTION) return error.message || "生成失败";
  return "生成失败，请稍后再试";
}

async function handleTryOn(request, response) {
  const ip = getClientIp(request);

  if (!isOriginAllowed(request)) {
    sendJson(request, response, 403, { error: "请求来源不允许" });
    return;
  }

  const retryAfter = checkRateLimit(ip);
  if (retryAfter) {
    sendJson(request, response, 429, { error: "生成次数过多，请稍后再试" }, {
      "Retry-After": String(retryAfter),
    });
    return;
  }

  if (!acquireGenerationSlot(ip)) {
    sendJson(request, response, 429, { error: "当前生成任务较多，请稍后再试" }, {
      "Retry-After": "30",
    });
    return;
  }

  try {
    const contentType = request.headers["content-type"] || "";
    if (!contentType.includes("application/json")) {
      throw new PublicError("请求格式不正确", 415);
    }

    const body = await readBody(request);
    let payload;
    try {
      payload = JSON.parse(body);
    } catch (error) {
      throw new PublicError("请求 JSON 格式不正确", 400);
    }

    if (!payload.personImage || !payload.clothImage) {
      throw new PublicError("请上传人物照片和衣服照片", 400);
    }

    const image = await createTryOnImage(payload.personImage, payload.clothImage);
    sendJson(request, response, 200, { image });
  } catch (error) {
    console.error("[tryon] generation failed:", error.message);
    const statusCode = error.statusCode || 500;
    sendJson(request, response, statusCode, { error: getClientError(error) });
  } finally {
    releaseGenerationSlot(ip);
  }
}

function serveStatic(request, response) {
  const requestUrl = new URL(request.url, getSelfOrigin(request));
  const requestedFile = requestUrl.pathname === "/" ? "index.html" : requestUrl.pathname.replace(/^\/+/, "");

  if (requestedFile.includes("/") || !PUBLIC_FILES.has(requestedFile)) {
    response.writeHead(404, baseSecurityHeaders({
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
    }));
    response.end("Not Found");
    return;
  }

  const filePath = path.join(ROOT, requestedFile);
  fs.readFile(filePath, (error, content) => {
    if (error) {
      response.writeHead(404, baseSecurityHeaders({
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-store",
      }));
      response.end("Not Found");
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const cacheControl = requestedFile === "index.html" ? "no-store" : "public, max-age=3600";
    response.writeHead(200, baseSecurityHeaders({
      "Content-Type": contentTypes[ext] || "application/octet-stream",
      "Cache-Control": cacheControl,
    }));
    response.end(content);
  });
}

const server = http.createServer((request, response) => {
  const requestUrl = new URL(request.url, getSelfOrigin(request));

  if (request.method === "OPTIONS" && requestUrl.pathname === "/api/tryon") {
    if (!isOriginAllowed(request)) {
      response.writeHead(403, baseSecurityHeaders());
      response.end();
      return;
    }
    response.writeHead(204, baseSecurityHeaders({
      ...getCorsHeaders(request),
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Max-Age": "600",
    }));
    response.end();
    return;
  }

  if (request.method === "POST" && requestUrl.pathname === "/api/tryon") {
    handleTryOn(request, response);
    return;
  }

  if (request.method === "GET" && requestUrl.pathname === "/healthz") {
    sendJson(request, response, 200, { ok: true, version: SERVER_VERSION });
    return;
  }

  if (request.method === "GET") {
    serveStatic(request, response);
    return;
  }

  response.writeHead(405, baseSecurityHeaders({
    "Content-Type": "text/plain; charset=utf-8",
    "Cache-Control": "no-store",
  }));
  response.end("Method Not Allowed");
});

server.requestTimeout = 240000;
server.headersTimeout = 245000;

server.listen(PORT, () => {
  console.log(`云试衣间服务已启动：http://localhost:${PORT}`);
});
