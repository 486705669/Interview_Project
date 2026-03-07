# Cloudflare Named Tunnel Deployment

## Goal
Use a stable HTTPS hostname for the mobile web app so microphone access works on phones and the link stays valid for multiple days.

## Why This Instead of Quick Tunnel
- `trycloudflare.com` is temporary and can disappear at any time.
- A named tunnel stays available as long as the tunnel, token, and DNS hostname remain configured in your Cloudflare account.
- The phone browser gets HTTPS, which is required by many browsers for microphone APIs.

## Prerequisites
- A Cloudflare-managed domain
- Cloudflare Zero Trust enabled
- A server with Docker and Docker Compose
- This repository deployed on that server

## Files Added In This Repo
- `deploy/docker-compose.cloudflare.yml`
- `.env.cloudflare.example`

## Cloudflare Dashboard Setup
1. Open Cloudflare Zero Trust.
2. Go to `Networks` -> `Tunnels`.
3. Create a new tunnel.
4. Choose `Cloudflared`.
5. Name it something like `elderly-companion-prod`.
6. In the connector setup, choose `Docker`.
7. Copy the generated tunnel token.

## Public Hostname Setup
In the same tunnel, add a public hostname:

- Hostname: `app.your-domain.com`
- Service type: `HTTP`
- URL: `http://gateway:80`

Important:
- `gateway` is the Nginx container name from this project.
- The `cloudflared` container must run in the same Docker Compose project network, which this repo configuration already does.

## Server Deployment Steps
1. On the server, clone or pull this repository.
2. Create `.env.cloudflare` in the project root based on `.env.cloudflare.example`.
3. Put your real tunnel token into `CLOUDFLARED_TOKEN`.
4. Start the app and the tunnel:

```bash
cd deploy
docker compose \
  -f docker-compose.yml \
  -f docker-compose.cloudflare.yml \
  --env-file ../.env.cloudflare \
  up -d --build
```

## Verification
Check containers:

```bash
cd deploy
docker compose \
  -f docker-compose.yml \
  -f docker-compose.cloudflare.yml \
  --env-file ../.env.cloudflare \
  ps
```

Check tunnel logs:

```bash
docker logs elderly-companion-cloudflared --tail 100
```

Expected result:
- Your custom hostname opens the app over HTTPS
- `https://app.your-domain.com/api/health` returns `ok: true`
- Phone browsers can request microphone permission

## Update Or Restart
```bash
cd deploy
docker compose \
  -f docker-compose.yml \
  -f docker-compose.cloudflare.yml \
  --env-file ../.env.cloudflare \
  up -d --build
```

## Stop
```bash
cd deploy
docker compose \
  -f docker-compose.yml \
  -f docker-compose.cloudflare.yml \
  --env-file ../.env.cloudflare \
  down
```

## Notes
- If you do not have a Cloudflare-managed domain, you cannot use a named tunnel hostname.
- For the interview demo, open the link in a system browser, not in WeChat or QQ embedded browsers.
- If the microphone still fails on iPhone, test in Safari with site microphone permission enabled.

