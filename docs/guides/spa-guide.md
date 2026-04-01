# LLM Council Pro — SPA Deployment Guide

Deploy LLM Council Pro as a standalone Single Page Application with a separate backend API.

## Architecture

```
Browser (SPA)              Backend API
┌──────────────┐          ┌──────────────┐
│  Vite/React  │ ──HTTP──▶│   FastAPI     │
│  Static HTML │          │  Port 8001   │
│  Port 5173   │          │  data/*.json │
└──────────────┘          └──────────────┘
```

- **Frontend**: React 19 SPA — no client-side router, single `index.html` entry point
- **Backend**: FastAPI on port 8001 — stateful (stores settings + conversations in `data/`)
- **API discovery**: Frontend reads `VITE_API_URL` env var, falls back to `http://{window.location.hostname}:8001`

## Option 1: Static Build + Reverse Proxy (Recommended)

Build the frontend to static files and serve behind nginx/Caddy alongside the API.

### Build

```bash
cd frontend
VITE_API_URL=https://council.yourdomain.com npm run build
# Output: frontend/dist/
```

### Caddy (simplest)

```
council.yourdomain.com {
    handle /api/* {
        reverse_proxy localhost:8001
    }
    handle {
        root * /path/to/llm-council-pro/frontend/dist
        try_files {path} /index.html
        file_server
    }
}
```

### nginx

```nginx
server {
    listen 443 ssl;
    server_name council.yourdomain.com;

    # Frontend static files
    root /path/to/llm-council-pro/frontend/dist;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }

    # API proxy
    location /api/ {
        proxy_pass http://127.0.0.1:8001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_read_timeout 300s;  # long timeout for LLM streaming
    }
}
```

### Run the backend

```bash
cd /path/to/llm-council-pro
uv run python -m backend.main
```

Or as a systemd service:

```ini
[Unit]
Description=LLM Council Pro API
After=network.target

[Service]
Type=simple
WorkingDirectory=/path/to/llm-council-pro
ExecStart=/path/to/llm-council-pro/.venv/bin/python -m backend.main
Restart=on-failure
Environment=PYTHONUNBUFFERED=1

[Install]
WantedBy=multi-user.target
```

## Option 2: Split Deployment (Frontend CDN + Backend VPS)

Host the static SPA on a CDN (Vercel, Netlify, Cloudflare Pages) and point it at a backend running elsewhere.

### Frontend

```bash
cd frontend
VITE_API_URL=https://api.council.yourdomain.com npm run build
```

Deploy `frontend/dist/` to your CDN. Set the SPA fallback to `index.html`.

### Backend

Run on a VPS with CORS configured. The backend already allows origins on ports 5173 and 3000. For a custom domain, update `backend/main.py`:

```python
app.add_middleware(
    CORSMiddleware,
    allow_origins=["https://council.yourdomain.com"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
```

## Option 3: Docker Compose

```yaml
services:
  backend:
    build:
      context: .
      dockerfile: Dockerfile.backend
    ports:
      - "8001:8001"
    volumes:
      - ./data:/app/data
    restart: unless-stopped

  frontend:
    build:
      context: ./frontend
      dockerfile: Dockerfile.frontend
      args:
        VITE_API_URL: http://localhost:8001
    ports:
      - "5173:80"
    depends_on:
      - backend
    restart: unless-stopped
```

**Dockerfile.backend:**

```dockerfile
FROM python:3.10-slim
WORKDIR /app
COPY pyproject.toml uv.lock ./
RUN pip install uv && uv sync --frozen
COPY backend/ backend/
COPY presets/ presets/
RUN mkdir -p data/conversations
CMD ["uv", "run", "python", "-m", "backend.main"]
```

**Dockerfile.frontend:**

```dockerfile
FROM node:18 AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
ARG VITE_API_URL
ENV VITE_API_URL=$VITE_API_URL
COPY . .
RUN npm run build

FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
```

## Option 4: macOS launchd (Local Always-On)

For running Council Pro as a persistent local service on macOS:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.llm-council-pro</string>
    <key>WorkingDirectory</key>
    <string>/path/to/llm-council-pro</string>
    <key>ProgramArguments</key>
    <array>
        <string>/bin/bash</string>
        <string>start.sh</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>/tmp/llm-council-pro.log</string>
    <key>StandardErrorPath</key>
    <string>/tmp/llm-council-pro.err</string>
</dict>
</plist>
```

Install:

```bash
cp com.llm-council-pro.plist ~/Library/LaunchAgents/
launchctl load ~/Library/LaunchAgents/com.llm-council-pro.plist
```

Access at http://localhost:5173.

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `VITE_API_URL` | `http://{hostname}:8001` | Backend API URL (build-time) |

## Security Considerations

- API keys are stored in plaintext in `data/settings.json` — keep the `data/` directory access-restricted
- The backend has no authentication — do not expose port 8001 to the public internet without adding auth
- If deploying publicly, add basic auth or an auth proxy (e.g., Authelia, Cloudflare Access) in front of both frontend and API
- `data/` is in `.gitignore` — never commit it

## Syncing with Upstream

This repo is forked from `jbullockgroup/llm-council-pro`. To pull upstream updates:

```bash
git fetch upstream
git log --oneline upstream/main..HEAD   # review your local changes first
git diff upstream/main -- backend/      # check for conflicts in backend
git diff upstream/main -- frontend/src/ # check for conflicts in frontend

# If clean, merge:
git merge upstream/main

# If conflicts exist, review each file before accepting:
git merge upstream/main --no-commit
git diff --cached                       # inspect merged result
git merge --abort                       # if not satisfied
```

Always review upstream changes before merging — breaking changes in the API or prompt format can affect your council configuration and conversation history.
