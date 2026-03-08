# Aliyun ECS Windows Domain Deployment

## Important First
If this ECS server is in mainland China, binding `jiahaochen.xyz` directly to it for public web access may require ICP filing first.

Use this route only if one of the following is true:
- the ECS instance is outside mainland China
- ICP filing has already been completed
- you accept that direct domain access may be blocked until filing is approved

## Recommended Stack
- Windows ECS
- Node.js serving both frontend and API on `localhost:3000`
- Caddy terminating HTTPS for `jiahaochen.xyz`

## Files
- `deploy/windows/prepare-app.ps1`
- `deploy/windows/run-backend.ps1`
- `deploy/windows/Caddyfile.example`
- `deploy/windows/run-caddy.ps1`
- `deploy/windows/register-caddy-task.ps1`

## DNS
In Alibaba Cloud DNS, add:

- `A` record: host `@` -> `120.55.248.202`
- `A` record: host `www` -> `120.55.248.202`

Use a short TTL such as 10 minutes while testing.

## ECS Security Group
Open inbound:
- `80/tcp`
- `443/tcp`
- `3389/tcp`

Port `3000` does not need to be public if Caddy reverse proxies locally.

## Server Setup
Install on the ECS host:
- Git
- Node.js 20 LTS
- Caddy

Suggested path:
- `C:\Program Files\Caddy\caddy.exe`

## Deploy Steps
1. Clone the repo to the server:

```powershell
git clone <your-repo-url> C:\apps\elderly-companion
cd C:\apps\elderly-companion
```

2. Build the app:

```powershell
powershell -ExecutionPolicy Bypass -File .\deploy\windows\prepare-app.ps1
```

3. Copy the example Caddy config:

```powershell
copy .\deploy\windows\Caddyfile.example .\deploy\windows\Caddyfile
```

4. Start backend for testing:

```powershell
powershell -ExecutionPolicy Bypass -File .\deploy\windows\run-backend.ps1
```

5. Start Caddy in another PowerShell window:

```powershell
powershell -ExecutionPolicy Bypass -File .\deploy\windows\run-caddy.ps1
```

6. Register startup tasks:

```powershell
powershell -ExecutionPolicy Bypass -File .\deploy\windows\register-startup-tasks.ps1
powershell -ExecutionPolicy Bypass -File .\deploy\windows\register-caddy-task.ps1
```

## Verification
On the server:

```powershell
curl http://localhost:3000/api/health
```

From the internet:

```powershell
curl https://jiahaochen.xyz/api/health
```

## Notes
- Caddy can issue and renew HTTPS certificates automatically when the domain already resolves to this server and ports `80` and `443` are open.
- For mobile speech input, always test with the final HTTPS domain in a system browser.

