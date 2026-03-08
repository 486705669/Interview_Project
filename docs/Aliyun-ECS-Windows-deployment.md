# Aliyun ECS Windows Deployment

## Recommended Path
For this ECS instance, use:
- Windows Server deployment
- one Node.js process serving both API and built frontend
- Cloudflare named tunnel pointing to `http://localhost:3000`

This avoids Docker-on-Windows complexity and is simpler to demo.

## Why
- The ECS credentials indicate a Windows host (`Administrator`).
- The project can now serve the built frontend directly from the backend process.
- Cloudflare named tunnel provides stable HTTPS, which helps mobile microphone support.

## Files Added
- `deploy/windows/prepare-app.ps1`
- `deploy/windows/run-backend.ps1`
- `deploy/windows/run-cloudflared.ps1`
- `deploy/windows/register-startup-tasks.ps1`

## Server Preparation
Install on the ECS server:
- Node.js 20 LTS
- cloudflared
- Git

Suggested install paths:
- Node.js: `C:\Program Files\nodejs\node.exe`
- cloudflared: `C:\Program Files\cloudflared\cloudflared.exe`

## App Deployment Steps On ECS
1. Clone this repo to the server, for example:

```powershell
git clone <your-repo-url> C:\apps\elderly-companion
cd C:\apps\elderly-companion
```

2. Build the frontend and backend:

```powershell
powershell -ExecutionPolicy Bypass -File .\deploy\windows\prepare-app.ps1
```

3. Put your Cloudflare named tunnel token into:

```text
deploy\windows\cloudflared-token.txt
```

4. In Cloudflare Zero Trust, create a public hostname:
- Hostname: `app.your-domain.com`
- Service type: `HTTP`
- URL: `http://localhost:3000`

5. Register startup tasks:

```powershell
powershell -ExecutionPolicy Bypass -File .\deploy\windows\register-startup-tasks.ps1 -IncludeCloudflared
```

6. Start once immediately for testing:

```powershell
powershell -ExecutionPolicy Bypass -File .\deploy\windows\run-backend.ps1
```

Open a second PowerShell window:

```powershell
powershell -ExecutionPolicy Bypass -File .\deploy\windows\run-cloudflared.ps1
```

## Verification
Check local app:

```powershell
curl http://localhost:3000/api/health
```

Check public app:

```powershell
curl https://app.your-domain.com/api/health
```

## Notes
- This route does not require Nginx on the ECS host.
- It also does not require Docker on the ECS host.
- For mobile microphone access, open the final Cloudflare HTTPS hostname in a system browser.
