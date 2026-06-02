# 云试衣间部署说明

## 线上必须配置的环境变量

不要把真实密钥写进前端文件、仓库、压缩包或 bat 文件。把下面变量配置到服务器或托管平台的环境变量面板：

- `NODE_ENV=production`
- `ALIYUN_API_KEY`
- `ALIYUN_ACCESS_KEY_ID`
- `ALIYUN_ACCESS_KEY_SECRET`
- `ALIYUN_OSS_BUCKET`
- `ALIYUN_OSS_ENDPOINT`
- `ALLOWED_ORIGINS=https://你的域名`

可选保护参数：

- `TRYON_RATE_LIMIT=6`
- `TRYON_RATE_WINDOW_MS=3600000`
- `MAX_ACTIVE_GENERATIONS=2`
- `MAX_BODY_MB=36`
- `MAX_IMAGE_MB=14`
- `OSS_SIGN_EXPIRES_SECONDS=900`
- `OSS_CLEANUP_INPUTS=true`

## 启动命令

```bash
npm start
```

## 阿里云轻量应用服务器快速部署

1. 上传发布包到服务器，例如 `/opt/cloud-tryon`。
2. 解压后进入目录：

```bash
cd /opt/cloud-tryon
cp .env.example .env
nano .env
```

3. 填好 `.env` 后执行：

```bash
bash scripts/aliyun-lightweight-install.sh
```

4. 暂时不用域名时，可以在轻量应用服务器防火墙放行 `5188`，然后访问：

```text
http://服务器公网IP:5188
```

5. 正式上线建议用 Nginx 代理 `80/443` 到 `127.0.0.1:5188`，模板见：

```text
nginx/cloud-tryon.conf.example
```

## 部署文件

需要上传：

- `server.js`
- `package.json`
- `index.html`
- `styles.css`
- `api-config.js`
- `app.js`
- `upload-module.js`
- `tryon-generator.js`
- `promo-tile-a.jpg`
- `promo-tile-b.jpg`
- `promo-tile-c.jpg`
- `scripts/aliyun-lightweight-install.sh`
- `nginx/cloud-tryon.conf.example`

不要上传：

- `.env.local`
- `.env`
- 任何包含真实密钥的文件
- `test-aliyun.js`
- `test-e2e.js`
- `test-result.jpg`
- `.codex-server.*.log`

## 健康检查

线上启动后访问：

```text
/healthz
```

返回 `{"ok":true}` 表示服务已启动。
