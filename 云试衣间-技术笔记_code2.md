# 云试衣间技术笔记

## 1. 项目定位

这是一个本地运行的“云试衣间”小工具：用户上传人物照片和衣服照片，前端把两张图片传给本地 Node 服务，本地服务再上传图片到阿里云 OSS，并调用阿里云 DashScope 的 AI 试衣模型生成试穿效果图。

本项目不依赖前端框架和第三方 npm 包，主要由原生 HTML、CSS、JavaScript 和 Node.js 内置模块组成。

## 2. 文件分工

| 文件 | 作用 |
| --- | --- |
| `index.html` | 页面结构，包含上传入口、生成按钮、预览画布、下载按钮和大图预览层 |
| `styles.css` | 页面视觉样式和响应式布局 |
| `app.js` | 前端主流程：上传状态、点击生成、倒计时、请求接口、展示结果、下载和灯箱预览 |
| `upload-module.js` | 读取用户选择的图片，生成 `Image` 对象和 Data URL，并更新上传缩略图 |
| `tryon-generator.js` | Canvas 预览、占位图、结果图渲染、下载图片 |
| `server.js` | 本地 HTTP 服务、静态文件服务、OSS 上传、DashScope 任务创建和轮询 |
| `start.bat` | Windows 启动脚本，设置环境变量并启动服务 |
| `open-web.bat` | 启动服务后自动打开浏览器 |
| `test-e2e.js` | 端到端测试：请求本地接口并把生成结果保存为 `test-result.jpg` |
| `test-aliyun.js` | 早期阿里云接口测试脚本，当前主链路以 `server.js` 中的 DashScope 调用为准 |

## 3. 启动方式

推荐方式：

```bat
open-web.bat
```

手动方式：

```bat
npm start
```

默认访问地址：

```text
http://localhost:5188
```

默认端口在 `server.js` 中定义：

```js
const PORT = Number(process.env.PORT || 5188);
```

如需改端口，可在启动前设置：

```bat
set PORT=5180
node server.js
```

## 4. 前端交互流程

1. 用户选择人物照片和衣服照片。
2. `upload-module.js` 通过 `FileReader.readAsDataURL()` 读取图片，保存为 base64 Data URL。
3. 两张图片都准备好后，生成按钮可点击。
4. 点击生成后，`app.js` 请求本地接口：

```http
POST /api/tryon
Content-Type: application/json
```

请求体：

```json
{
  "personImage": "data:image/jpeg;base64,...",
  "clothImage": "data:image/jpeg;base64,..."
}
```

5. 前端显示秒表倒计时，等待 AI 生成。
6. 接口返回 `data:image/jpeg;base64,...` 后，`tryon-generator.js` 把结果绘制到 Canvas。
7. 用户可以点击预览图放大查看，也可以下载 PNG。

## 5. Canvas 预览参数

Canvas 尺寸定义在 `index.html`：

```html
<canvas id="tryonCanvas" class="generated-preview" width="900" height="1200"></canvas>
```

`tryon-generator.js` 中保留了一套本地叠图预览参数，主要用于非 AI 合成或占位预览：

| 参数 | 默认值 | 说明 |
| --- | ---: | --- |
| `scale` | `72` | 衣服缩放比例，实际使用时除以 100，即 `0.72` |
| `x` | `0` | 衣服水平偏移 |
| `y` | `-6` | 衣服垂直偏移 |
| `opacity` | `88` | 衣服透明度，实际使用时除以 100，即 `0.88` |

人物图铺满画布：

```js
coverRect(image, canvasWidth, canvasHeight)
```

衣服图限制在画布区域内：

```js
containRect(clothImage, canvas.width * 0.82, canvas.height * 0.52)
```

衣服定位核心公式：

```js
const centerX = canvas.width / 2 + (x / 100) * canvas.width * 0.34;
const topY = canvas.height * 0.245 + (y / 100) * canvas.height * 0.34;
```

当前正式生成结果来自 AI 接口，成功后使用 `renderImageUrl()` 直接把 AI 返回图居中绘制到 Canvas。

## 6. 服务端接口

本地服务只暴露一个业务接口：

```http
POST /api/tryon
```

服务端限制请求体最大为：

```js
const MAX_BODY_BYTES = 60 * 1024 * 1024;
```

接口校验：

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `personImage` | 是 | 人物图片 Data URL |
| `clothImage` | 是 | 衣服图片 Data URL |

返回成功：

```json
{
  "image": "data:image/jpeg;base64,..."
}
```

返回失败：

```json
{
  "error": "错误原因"
}
```

## 7. 阿里云 OSS 上传

AI 接口需要公网可访问的图片 URL，所以服务端先把前端上传的 base64 图片转成 Buffer，再上传到 OSS。

需要的环境变量：

| 变量 | 说明 |
| --- | --- |
| `ALIYUN_OSS_BUCKET` | OSS Bucket 名称 |
| `ALIYUN_OSS_ENDPOINT` | OSS Endpoint，例如 `oss-cn-beijing.aliyuncs.com` |
| `ALIYUN_ACCESS_KEY_ID` | 阿里云 AccessKey ID |
| `ALIYUN_ACCESS_KEY_SECRET` | 阿里云 AccessKey Secret |

上传文件名格式：

```text
tryon/person_<timestamp>_<random>.jpg
tryon/cloth_<timestamp>_<random>.jpg
```

上传方法：

```http
PUT https://<bucket>.<endpoint>/<fileName>
```

上传 Content-Type：

```text
image/jpeg
```

OSS 上传成功后，服务端生成一个临时签名 URL，当前有效期：

```js
const expires = Math.floor(Date.now() / 1000) + 3600;
```

也就是 1 小时。

## 8. DashScope AI 试衣调用

DashScope Endpoint：

```text
dashscope.aliyuncs.com
```

创建任务接口：

```http
POST https://dashscope.aliyuncs.com/api/v1/services/aigc/image2image/image-synthesis
```

请求头：

```http
Content-Type: application/json
Authorization: Bearer <ALIYUN_API_KEY>
X-DashScope-Async: enable
```

API Key 来源：

```js
const apiKey = process.env.ALIYUN_API_KEY || OSS_ACCESS_KEY_ID;
```

建议优先配置单独的 `ALIYUN_API_KEY`，不要复用 OSS AccessKey。

创建任务请求体：

```json
{
  "model": "aitryon",
  "input": {
    "person_image_url": "<人物图 OSS 签名 URL>",
    "top_garment_url": "<衣服图 OSS 签名 URL>"
  },
  "parameters": {
    "resolution": -1,
    "restore_face": true
  }
}
```

参数说明：

| 参数 | 当前值 | 说明 |
| --- | --- | --- |
| `model` | `aitryon` | 阿里云 AI 试衣模型 |
| `person_image_url` | OSS 签名 URL | 人物照片 |
| `top_garment_url` | OSS 签名 URL | 上装图片 |
| `resolution` | `-1` | 使用模型默认或自适应分辨率 |
| `restore_face` | `true` | 开启人脸修复 |

创建成功后，接口返回：

```json
{
  "output": {
    "task_id": "..."
  }
}
```

## 9. 任务轮询参数

查询任务接口：

```http
GET https://dashscope.aliyuncs.com/api/v1/tasks/<task_id>
```

轮询配置：

```js
for (let i = 0; i < 60; i++) {
  await new Promise(resolve => setTimeout(resolve, 3000));
}
```

也就是：

| 参数 | 当前值 |
| --- | ---: |
| 轮询间隔 | 3 秒 |
| 最大轮询次数 | 60 次 |
| 最大等待时间 | 约 180 秒 |

任务状态处理：

| 状态 | 处理 |
| --- | --- |
| `SUCCEEDED` | 读取结果图 URL，下载图片并转成 base64 返回给前端 |
| `FAILED` | 抛出失败原因 |
| 其他状态 | 继续等待下一轮 |

结果 URL 兼容了两种返回结构：

```js
queryPayload.output?.results?.[0]?.url
queryPayload.output?.image_url
```

## 10. 下载与展示

AI 返回结果会被服务端下载成二进制，再转成：

```text
data:image/jpeg;base64,...
```

前端拿到后绘制到 Canvas。

下载按钮使用 Canvas 导出 PNG：

```js
canvas.toDataURL("image/png")
```

默认下载文件名：

```text
云试衣间-试穿图.png
```

## 11. 测试方式

启动本地服务后，可运行端到端测试：

```bat
node test-e2e.js
```

测试逻辑：

1. 访问 `http://localhost:5188` 检查服务是否可达。
2. 从 `uploads` 目录读取测试人物图和衣服图。
3. 请求 `POST /api/tryon`。
4. 成功后把返回图片保存为 `test-result.jpg`。

注意：当前前端上传流程不会自动把图片保存到 `uploads`，`test-e2e.js` 依赖该目录中已有 `person_` 和 `cloth_` 开头的图片文件。

## 12. 常见问题排查

### 生成失败：缺少配置

检查这些环境变量是否已设置：

```text
ALIYUN_API_KEY
ALIYUN_ACCESS_KEY_ID
ALIYUN_ACCESS_KEY_SECRET
ALIYUN_OSS_BUCKET
ALIYUN_OSS_ENDPOINT
```

### 生成失败：OSS 图片不可访问

检查：

1. Bucket 和 Endpoint 是否匹配。
2. AccessKey 是否有 OSS 写入权限。
3. 签名 URL 是否能在浏览器打开。
4. OSS Bucket 的地域是否和 Endpoint 一致。

### 等待很久没有结果

当前最大等待约 180 秒。可以根据模型实际耗时调整：

```js
for (let i = 0; i < 60; i++) {
  await new Promise(resolve => setTimeout(resolve, 3000));
}
```

例如改成 80 次就是约 240 秒。

### 图片太大

服务端最大请求体是 60MB。若手机原图太大，可在前端上传前压缩，或降低输入图片尺寸。

## 13. 安全注意事项

`start.bat` 中如果写入真实密钥，只适合本机临时使用，不建议分享或提交到公共仓库。

更稳妥的方式：

1. 把密钥放到系统环境变量。
2. 或使用本地 `.env` 文件，并确保 `.env` 不提交。
3. 对外分享项目时，只保留 `.env.example` 这类示例文件。

建议示例：

```text
ALIYUN_API_KEY=your_dashscope_api_key
ALIYUN_ACCESS_KEY_ID=your_access_key_id
ALIYUN_ACCESS_KEY_SECRET=your_access_key_secret
ALIYUN_OSS_BUCKET=your_bucket
ALIYUN_OSS_ENDPOINT=oss-cn-beijing.aliyuncs.com
PORT=5188
```

## 14. 后续可优化点

1. 前端上传前压缩图片，减少请求体积和等待时间。
2. 增加错误提示分层，例如 OSS 上传失败、DashScope 鉴权失败、模型任务失败分别提示。
3. 把密钥从 `start.bat` 挪到环境变量或 `.env`。
4. 保存历史生成记录，方便对比多次试衣效果。
5. 支持下装、连衣裙等更多服装类型参数。
6. 增加取消生成按钮，避免用户重复点击时等待不明确。
