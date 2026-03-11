# Aliyun ECS Linux Domain Deployment

This guide is for a Linux ECS host with a public IP and a bound domain.

## 1. Clone the repository

```bash
cd /opt
git clone https://github.com/486705669/Interview_Project.git elderly-companion
cd /opt/elderly-companion
git checkout codex/deepseek-agent-upgrade
git pull
```

## 2. Install runtime dependencies

Ubuntu/Debian:

```bash
apt update
apt install -y git curl build-essential
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs caddy
```

Alibaba Cloud Linux / CentOS / RHEL:

```bash
dnf install -y git curl gcc-c++ make
curl -fsSL https://rpm.nodesource.com/setup_20.x | bash -
dnf install -y nodejs caddy
```

## 3. Prepare env file

```bash
cp deploy/linux/backend.env.example deploy/linux/backend.env
nano deploy/linux/backend.env
```

Fill your own values for Aliyun speech recognition and DeepSeek.

## 4. Build the app

```bash
chmod +x deploy/linux/prepare-app.sh deploy/linux/run-backend.sh
./deploy/linux/prepare-app.sh
```

## 5. Start backend

```bash
./deploy/linux/run-backend.sh
```

You should see:

```text
backend started on :3000
deepseek agent enabled: deepseek-chat
```

## 6. Configure Caddy

```bash
cp deploy/linux/Caddyfile.example /etc/caddy/Caddyfile
systemctl restart caddy
systemctl enable caddy
```

## 7. Verify

```bash
curl http://127.0.0.1:3000/api/health
curl https://jiahaochen.xyz/api/health
```

## 8. Open firewall/security group

Allow inbound:

- TCP 80
- TCP 443
- TCP 22

## 9. Optional systemd service for backend

Create `/etc/systemd/system/elderly-companion-backend.service`:

```ini
[Unit]
Description=Elderly Companion Backend
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/elderly-companion
ExecStart=/opt/elderly-companion/deploy/linux/run-backend.sh
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

Then:

```bash
systemctl daemon-reload
systemctl enable elderly-companion-backend
systemctl start elderly-companion-backend
```
