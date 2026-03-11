# Elderly Companion Assistant (Interview MVP)

This repository contains a 3-day MVP for a mobile web product:
- voice-first chat companion
- reminder assistant
- emergency guidance mode
- family/admin query dashboard
- emergency event detail page with resolve action

## Docs
- `docs/PRD-老人陪伴助手.md`
- `docs/三天落地执行方案.md`
- `docs/Cloudflare-named-tunnel部署.md`
- `docs/Aliyun-ECS-Windows-deployment.md`
- `docs/Aliyun-ECS-Windows-domain-deployment.md`

## Project Structure
```text
.
|- frontend/   # Vue 3 mobile web
|- backend/    # Express API service
|- deploy/     # Docker Compose + Nginx gateway
`- docs/       # PRD and deployment docs
```

## Local Development
```bash
cd backend
npm install
npm run dev
```

```bash
cd frontend
npm install
npm run dev
```

Open `http://localhost:5173` on desktop or mobile browser in the same LAN.

## Standard Docker Deployment
```bash
cd deploy
docker compose up -d --build
```

## Cloudflare Named Tunnel Deployment
1. Create a named tunnel in Cloudflare Zero Trust and copy the Docker token.
2. Add a public hostname in Cloudflare that points to `http://gateway:80`.
3. Create `.env.cloudflare` from `.env.cloudflare.example`.
4. Start with:

```bash
cd deploy
docker compose \
  -f docker-compose.yml \
  -f docker-compose.cloudflare.yml \
  --env-file ../.env.cloudflare \
  up -d --build
```

See `docs/Cloudflare-named-tunnel部署.md` for the full flow.

## Aliyun ECS Windows Deployment
For a Windows ECS host, use the Windows scripts in `deploy/windows/` and point the Cloudflare named tunnel to `http://localhost:3000`.

See `docs/Aliyun-ECS-Windows-deployment.md` for the full flow.

## Aliyun ECS With Domain
If you want to bind a real domain directly to the Windows ECS host, use Caddy as the HTTPS reverse proxy.

See `docs/Aliyun-ECS-Windows-domain-deployment.md` for the full flow.

## Server-Side Voice Recognition
The mobile web now uses `press-and-hold to record -> upload WAV -> server-side transcription`.

For a Windows ECS host, create `deploy/windows/backend.env` from `deploy/windows/backend.env.example` and choose one provider:

```text
ALIYUN_NLS_APPKEY=your_appkey
ALIYUN_AK_ID=your_access_key_id
ALIYUN_AK_SECRET=your_access_key_secret
ALIYUN_NLS_REGION=cn-shanghai
```

If you do not want to manage temporary NLS tokens manually, this setup will request `CreateToken` from Aliyun automatically and refresh it before expiry.

Optional fallback:

```text
ALIYUN_NLS_TOKEN=your_temporary_token
```

or

```text
OPENAI_API_KEY=your_api_key
OPENAI_TRANSCRIPTION_MODEL=gpt-4o-mini-transcribe
```

## DeepSeek Agent Branch
The branch `codex/deepseek-agent-upgrade` upgrades `/api/chat` to a DeepSeek-powered agent flow:
- the model replies as the companion assistant
- the model can decide to create reminders, record health notes, or open emergency events
- the original rule-based logic remains as a fallback when the model is unavailable

Environment variables:

```text
DEEPSEEK_API_KEY=your_deepseek_api_key
DEEPSEEK_MODEL=deepseek-chat
DEEPSEEK_BASE_URL=https://api.deepseek.com
```

## Current MVP Status
- [x] PRD and delivery plan
- [x] Frontend pages: chat / reminder / logs / family dashboard / emergency detail
- [x] Backend APIs: chat, risk detection, reminders, emergencies, family summary, timeline
- [x] Docker deployment: frontend + backend + nginx gateway
- [x] Cloudflare named tunnel deployment template
