# LLM Council Pro — SPA Deployment Guide

Deploy LLM Council Pro on InMotion Hosting at `proxy.askbillringle.com`.

## Architecture

```
Browser                        InMotion VPS
  │                     ┌─────────────────────────┐
  │   HTTPS             │  nginx (443)            │
  ├────────────────────▶│  proxy.askbillringle.com│
  │                     │                         │
  │                     │  /        → static SPA  │
  │                     │  /api/*   → :8001       │
  │                     │                         │
  │                     │  FastAPI (8001)          │
  │                     │  data/settings.json     │
  │                     │  data/conversations/    │
  └                     └─────────────────────────┘
```

- **Frontend**: React 19 SPA — static files served by nginx
- **Backend**: FastAPI on port 8001 (localhost only, not exposed)
- **Domain**: `proxy.askbillringle.com` — both SPA and API behind nginx reverse proxy
- **SSL**: Let's Encrypt via certbot (InMotion supports this)

## Prerequisites

On the InMotion VPS:

```bash
# Python 3.10+ and uv
curl -LsSf https://astral.sh/uv/install.sh | sh

# Node.js 18+ (for building frontend)
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo bash -
sudo apt install -y nodejs

# nginx (if not already installed)
sudo apt install -y nginx certbot python3-certbot-nginx
```

## Step 1: Clone and Install

```bash
cd /opt
sudo git clone https://github.com/BR4096/llm-council-pro.git
sudo chown -R $USER:$USER llm-council-pro
cd llm-council-pro

# Backend
uv sync

# Frontend — build with API pointing to same domain
cd frontend
VITE_API_URL=https://proxy.askbillringle.com npm run build
cd ..
```

## Step 2: DNS Record

Add an A record in your DNS provider for `askbillringle.com`:

```
Type: A
Host: proxy
Value: <InMotion VPS IP>
TTL: 3600
```

## Step 3: nginx Configuration

```bash
sudo nano /etc/nginx/sites-available/llm-council-pro
```

```nginx
server {
    listen 80;
    server_name proxy.askbillringle.com;

    # Redirect HTTP to HTTPS (certbot will add this, but explicit is fine)
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl;
    server_name proxy.askbillringle.com;

    # SSL certs — certbot will populate these
    # ssl_certificate /etc/letsencrypt/live/proxy.askbillringle.com/fullchain.pem;
    # ssl_certificate_key /etc/letsencrypt/live/proxy.askbillringle.com/privkey.pem;

    # Frontend static files
    root /opt/llm-council-pro/frontend/dist;
    index index.html;

    # SPA fallback — all non-file routes serve index.html
    location / {
        try_files $uri $uri/ /index.html;
    }

    # API reverse proxy — forward /api/* to FastAPI backend
    location /api/ {
        proxy_pass http://127.0.0.1:8001;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # SSE/streaming support — required for council deliberation
        proxy_set_header Connection '';
        proxy_buffering off;
        proxy_cache off;
        chunked_transfer_encoding on;

        # Long timeout for LLM responses (full deliberation can take minutes)
        proxy_read_timeout 600s;
        proxy_send_timeout 600s;
    }

    # Block direct access to data directory
    location /data/ {
        deny all;
        return 404;
    }

    # Security headers
    add_header X-Frame-Options DENY;
    add_header X-Content-Type-Options nosniff;
    add_header Referrer-Policy strict-origin-when-cross-origin;
}
```

Enable and test:

```bash
sudo ln -s /etc/nginx/sites-available/llm-council-pro /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

## Step 4: SSL Certificate

```bash
sudo certbot --nginx -d proxy.askbillringle.com
```

Certbot will automatically update the nginx config with SSL cert paths and set up auto-renewal.

## Step 5: CORS Configuration

Update `backend/main.py` to allow the production domain:

```python
app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"https://proxy\.askbillringle\.com|http://.*:(5173|3000)",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
```

## Step 6: Backend as systemd Service

```bash
sudo nano /etc/systemd/system/llm-council-pro.service
```

```ini
[Unit]
Description=LLM Council Pro API
After=network.target

[Service]
Type=simple
User=deploy
WorkingDirectory=/opt/llm-council-pro
ExecStart=/opt/llm-council-pro/.venv/bin/python -m backend.main
Restart=on-failure
RestartSec=5
Environment=PYTHONUNBUFFERED=1

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable llm-council-pro
sudo systemctl start llm-council-pro

# Verify it's running
sudo systemctl status llm-council-pro
curl -s http://127.0.0.1:8001/api/settings | head -c 100
```

## Step 7: HTTP Basic Auth (Required)

The backend stores API keys in plaintext — never expose without authentication.

```bash
# Create password file
sudo apt install -y apache2-utils
sudo htpasswd -c /etc/nginx/.htpasswd billringle
```

Add to the nginx `server` block (inside the `listen 443` block):

```nginx
    # Basic auth on all routes
    auth_basic "LLM Council Pro";
    auth_basic_user_file /etc/nginx/.htpasswd;
```

Then reload:

```bash
sudo nginx -t && sudo systemctl reload nginx
```

## Updating the Deployment

```bash
cd /opt/llm-council-pro

# Pull latest from your fork
git pull origin main

# Rebuild frontend
cd frontend
VITE_API_URL=https://proxy.askbillringle.com npm run build
cd ..

# Reinstall backend deps if pyproject.toml changed
uv sync

# Restart backend
sudo systemctl restart llm-council-pro
```

## Syncing with Upstream

Pull upstream changes to your fork, review before merging:

```bash
git fetch upstream
git log --oneline upstream/main..HEAD   # review your local changes
git diff upstream/main -- backend/      # check for backend conflicts
git diff upstream/main -- frontend/src/ # check for frontend conflicts

# If clean:
git merge upstream/main

# If conflicts:
git merge upstream/main --no-commit
git diff --cached                       # inspect merged result
git merge --abort                       # if not satisfied
```

Then redeploy (see "Updating the Deployment" above).

## Troubleshooting

| Issue | Fix |
|-------|-----|
| 502 Bad Gateway | Backend not running: `sudo systemctl status llm-council-pro` |
| SSL cert expired | `sudo certbot renew` |
| Streaming responses cut off | Check `proxy_read_timeout` is 600s in nginx config |
| CORS errors in browser console | Verify `allow_origin_regex` in `backend/main.py` includes production domain |
| API keys not saving | Check `data/` directory permissions: `ls -la /opt/llm-council-pro/data/` |
| White page after deploy | Rebuild frontend with correct `VITE_API_URL` |
| Can't reach from browser | Verify DNS: `dig proxy.askbillringle.com` and firewall allows 443 |

## Security Checklist

- [ ] HTTP Basic Auth enabled in nginx
- [ ] Port 8001 not exposed in firewall (backend only accessible via nginx proxy)
- [ ] `data/` directory readable only by the service user
- [ ] SSL certificate active and auto-renewing
- [ ] `.gitignore` excludes `data/` (API keys in plaintext)
- [ ] Consider IP allowlisting in nginx if only accessed from known locations

## File Locations on InMotion VPS

| Item | Path |
|------|------|
| App root | `/opt/llm-council-pro/` |
| Frontend build | `/opt/llm-council-pro/frontend/dist/` |
| Backend data | `/opt/llm-council-pro/data/` |
| nginx config | `/etc/nginx/sites-available/llm-council-pro` |
| systemd service | `/etc/systemd/system/llm-council-pro.service` |
| SSL certs | `/etc/letsencrypt/live/proxy.askbillringle.com/` |
| Auth passwords | `/etc/nginx/.htpasswd` |
| Backend logs | `journalctl -u llm-council-pro -f` |
| nginx logs | `/var/log/nginx/access.log`, `/var/log/nginx/error.log` |
