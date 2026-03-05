# Elderly Companion Assistant (Interview MVP)

This repository contains a 3-day MVP for a mobile web product:
- voice-first chat companion
- reminder assistant
- emergency guidance mode
- family/admin traceable logs

## Docs
- [Product PRD](./docs/PRD-老人陪伴助手.md)
- [3-Day Delivery Plan](./docs/三天落地执行方案.md)

## Project Structure
```text
.
├─ frontend/   # Vue 3 mobile web
├─ backend/    # Express API service
├─ deploy/     # Docker Compose + Nginx gateway
└─ docs/       # PRD and planning docs
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
cp ../.env.example ../.env
docker compose up -d --build
```

Then open:
- `http://<your-server-ip>` for web
- `http://<your-server-ip>/api/health` for API health check

## Current MVP Status
- [x] PRD and delivery plan
- [x] Frontend mobile pages (chat/reminder/logs)
- [x] Backend APIs (chat/risk detection/reminder/emergency/logs)
- [x] Docker deployment files (frontend + backend + nginx gateway)

