#!/usr/bin/env bash
set -euo pipefail

APP_NAME="${APP_NAME:-cloud-tryon}"
APP_PORT="${PORT:-5188}"

if [ ! -f "server.js" ]; then
  echo "Run this script from the cloud-tryon app directory."
  exit 1
fi

if [ ! -f ".env" ]; then
  echo "Missing .env. Run: cp .env.example .env"
  echo "Then fill in Aliyun keys and ALLOWED_ORIGINS."
  exit 1
fi

install_node() {
  if command -v node >/dev/null 2>&1; then
    return
  fi

  echo "Node.js not found. Installing Node.js 20..."
  if command -v apt-get >/dev/null 2>&1; then
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
    apt-get install -y nodejs
  elif command -v dnf >/dev/null 2>&1; then
    dnf install -y nodejs npm
  elif command -v yum >/dev/null 2>&1; then
    yum install -y nodejs npm
  else
    echo "Could not auto-install Node.js. Install Node.js 18+ manually and retry."
    exit 1
  fi
}

install_pm2() {
  if command -v pm2 >/dev/null 2>&1; then
    return
  fi

  echo "Installing PM2..."
  npm install -g pm2
}

install_node
install_pm2

echo "Checking syntax..."
npm run check

echo "Starting ${APP_NAME}..."
pm2 delete "${APP_NAME}" >/dev/null 2>&1 || true
pm2 start server.js --name "${APP_NAME}" --time --update-env
pm2 save

echo "Waiting for app health check..."
sleep 2
curl -fsS "http://127.0.0.1:${APP_PORT}/healthz" >/dev/null

cat <<EOF

Deploy finished.

Local health check:
  http://127.0.0.1:${APP_PORT}/healthz

Next steps:
1. Open ports 80 and 443 in the Aliyun Lightweight Application Server firewall.
2. For temporary IP access, open ${APP_PORT} and visit http://SERVER_PUBLIC_IP:${APP_PORT}
3. For production, configure Nginx to proxy 80/443 to 127.0.0.1:${APP_PORT}

EOF
