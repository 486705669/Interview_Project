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

## Project Structure
```text
.
|- frontend/   # Vue 3 mobile web
|- backend/    # Express API service
|- deploy/     # Docker Compose + Nginx gateway
`- docs/       # PRD and planning docs
```

## Local Development
### 1) Start backend
```bash
cd backend
npm install
npm run dev
```

### 2) Start frontend
```bash
cd frontend
npm install
npm run dev
```

Open `http://localhost:5173` on desktop or mobile browser in the same LAN.

## Docker Deployment
```bash
cd deploy
docker compose up -d --build
```

Then open:
- `http://<your-server-ip>` for web
- `http://<your-server-ip>/api/health` for API health check

Stop services:
```bash
cd deploy
docker compose down
```

## Current MVP Status
- [x] PRD and delivery plan
- [x] Frontend pages: chat / reminder / logs / family dashboard / emergency detail
- [x] Backend APIs: chat, risk detection, reminders, emergencies, family summary, timeline
- [x] Docker deployment: frontend + backend + nginx gateway

