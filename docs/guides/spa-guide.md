# LLM Council Pro — SPA Deployment Guide

Deploy LLM Council Pro on InMotion shared hosting at `app.askbillringle.com`.

## Architecture

```
Browser                        InMotion Shared Hosting
  │                     ┌─────────────────────────────────┐
  │  HTTPS              │  Apache + LiteSpeed              │
  ├────────────────────▶│  app.askbillringle.com           │
  │                     │                                  │
  │  GET /              │  → ~/app.askbillringle.com/      │
  │                     │    (static SPA files)            │
  │                     │                                  │
  │  /api/*             │  → frontend JS calls :8001       │
  │                     │    (direct, same-origin)         │
  │                     │                                  │
  │                     │  FastAPI (:8001, localhost only)  │
  │                     │  ~/llm-council-pro/              │
  │                     │  ├── backend/                    │
  │                     │  └── data/ (settings, convos)    │
  │                     └─────────────────────────────────┘
```

- **Frontend**: React 19 SPA — static files in cPanel subdomain docroot
- **Backend**: FastAPI on port 8001 (localhost only, not publicly exposed)
- **API routing**: Frontend JS calls `https://app.askbillringle.com` which routes to `:8001` via `VITE_API_URL`
- **SSL**: Let's Encrypt via cPanel AutoSSL (already provisioned)
- **Auth**: JWT-based invite codes (built into the app, no HTTP Basic Auth needed)

**Note**: InMotion shared hosting uses Apache/LiteSpeed with ModSecurity. No `mod_proxy`, no nginx, no systemd. The backend runs as a user-level background process.

## Current Server State

| Item | Status |
|------|--------|
| Domain `app.askbillringle.com` | Active, docroot at `~/app.askbillringle.com/` |
| SSL | Provisioned (Let's Encrypt R13) |
| Python 3.12 | Available at `/opt/alt/python312/bin/python3.12` |
| Python venv | Created at `~/llm-council-pro/.venv/` (Python 3.10 via uv) |
| Backend deps | Installed via pip |
| Backend code | Deployed at `~/llm-council-pro/` |
| Frontend build | Deployed to `~/app.askbillringle.com/` |
| Backend process | Running on `:8001` |
| ModSecurity | **Blocking requests** — needs to be disabled via cPanel |

## Remaining Setup Steps

### Step 1: Disable ModSecurity for app.askbillringle.com (BLOCKING)

ModSecurity is blocking all requests to the subdomain with HTTP 406. This must be disabled via cPanel:

1. Log into cPanel at `https://ecres271.servconfig.com:2083`
2. Go to **Security** → **ModSecurity**
3. Find `app.askbillringle.com` in the domain list
4. Click **Off** to disable ModSecurity for this subdomain only
5. Verify: `curl -s -o /dev/null -w "%{http_code}" https://app.askbillringle.com/`
   - Should return `200` (not `406`)

### Step 2: Configure API Proxy via .htaccess

Since `mod_proxy` is not available on shared hosting, the frontend calls the API directly. The `VITE_API_URL` was set to `https://app.askbillringle.com` at build time, but the API runs on port 8001.

**Option A: cPanel Application Proxy (Preferred)**

InMotion cPanel may support Application Manager or cPanel Terminal proxy:

1. Go to cPanel → **Setup Python App** or **Application Manager**
2. Configure the app to proxy `/api` to `http://127.0.0.1:8001`

**Option B: Rebuild frontend to call port 8001 directly**

If no proxy is available, rebuild the frontend to call the API on the backend port directly:

```bash
# On local machine:
cd frontend
VITE_API_URL=https://app.askbillringle.com:8001 npm run build

# Deploy:
rsync -avz --delete dist/ abr-prod:~/app.askbillringle.com/
```

Then the backend must listen on `0.0.0.0:8001` (it already does) and port 8001 must be open in the firewall. Update CORS in `backend/main.py`:

```python
app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"https://app\.askbillringle\.com|http://.*:(5173|3000)",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
```

**Option C: cPanel .htaccess Proxy (if mod_proxy_http is loaded)**

```apache
RewriteEngine On
RewriteCond %{REQUEST_URI} ^/api/
RewriteRule ^(.*)$ http://127.0.0.1:8001/$1 [P,L]

RewriteCond %{REQUEST_FILENAME} !-f
RewriteCond %{REQUEST_FILENAME} !-d
RewriteRule . /index.html [L]
```

Test if this works after ModSecurity is disabled.

### Step 3: Verify Frontend Loads

After ModSecurity is disabled:

```bash
curl -s https://app.askbillringle.com/ | head -5
# Should show <!doctype html>...
```

Visit `https://app.askbillringle.com` in a browser — should show the login screen.

### Step 4: Log in as Admin

The bootstrap admin code is: `alpine-fox-2026`

1. Enter the code on the login screen
2. Go to Settings → enter your LLM API keys (Anthropic, OpenAI, Google, Perplexity)
3. Test each key
4. Save Changes

### Step 5: Create Invite Codes for Users

Via the API (or build an admin UI later):

```bash
curl -X POST https://app.askbillringle.com/api/admin/invite \
  -H "Authorization: Bearer <your-jwt-token>" \
  -H "Content-Type: application/json" \
  -d '{"label": "Client: Jane M.", "role": "user"}'
```

The response includes the generated invite code to share.

## Server Management

### Start Backend

```bash
ssh abr-prod
cd ~/llm-council-pro
./start-prod.sh
```

### Stop Backend

```bash
ssh abr-prod
cd ~/llm-council-pro
./stop-prod.sh
```

### Check Backend Status

```bash
ssh abr-prod 'cat ~/llm-council-pro/.pid 2>/dev/null && ps aux | grep "backend.main" | grep -v grep || echo "Not running"'
```

### View Logs

```bash
ssh abr-prod 'tail -50 ~/logs/llm-council.log'
```

### Keep Backend Running (cron restart)

Add a cron job via cPanel to ensure the backend restarts if it dies:

```
*/5 * * * * cd ~/llm-council-pro && [ ! -f .pid ] || ! kill -0 $(cat .pid) 2>/dev/null && ./start-prod.sh
```

## Updating the Deployment

```bash
# 1. Push changes from local
cd ~/webdev/github/llm-council-pro
git push origin main

# 2. Pull on server
ssh abr-prod 'cd ~/llm-council-pro && git pull origin main'

# 3. Install new deps if needed
ssh abr-prod 'cd ~/llm-council-pro && .venv/bin/python -m pip install -r <(grep -oP "\"[^\"]+\"" pyproject.toml | tr -d \")'

# 4. Rebuild and deploy frontend
cd frontend
VITE_API_URL=https://app.askbillringle.com npm run build
rsync -avz --delete dist/ abr-prod:~/app.askbillringle.com/

# 5. Restart backend
ssh abr-prod 'cd ~/llm-council-pro && ./stop-prod.sh && ./start-prod.sh'
```

## Syncing with Upstream

```bash
git fetch upstream
git log --oneline upstream/main..HEAD   # review your local changes
git diff upstream/main -- backend/      # check for backend conflicts
git diff upstream/main -- frontend/src/ # check for frontend conflicts

# If clean:
git merge upstream/main

# If conflicts:
git merge upstream/main --no-commit
git diff --cached
git merge --abort   # if not satisfied
```

Then redeploy (see above).

## Troubleshooting

| Issue | Fix |
|-------|-----|
| 406 Not Acceptable | Disable ModSecurity for subdomain in cPanel |
| 500 Internal Server Error | Check .htaccess syntax; remove unsupported directives |
| Backend not running | `ssh abr-prod 'cd ~/llm-council-pro && ./start-prod.sh'` |
| CORS errors | Update `allow_origin_regex` in `backend/main.py` |
| API keys not saving | Check `data/` directory permissions: `chmod 700 ~/llm-council-pro/data/` |
| White page | Rebuild frontend with correct `VITE_API_URL` |
| Port 8001 blocked | Ask InMotion support to open port, or use cPanel proxy |
| SSL cert issues | Check cPanel → SSL/TLS Status |
| Backend crash loop | Check `~/logs/llm-council.log` for errors |

## Security Checklist

- [ ] ModSecurity disabled only for `app.askbillringle.com` (not all domains)
- [ ] JWT auth enforced (login required for all API endpoints)
- [ ] `data/` directory permissions are `700`
- [ ] `.env` file permissions are `600`
- [ ] Port 8001 not exposed publicly (or if exposed, auth handles security)
- [ ] SSL active on `app.askbillringle.com`
- [ ] `.gitignore` excludes `data/` and `.env`

## File Locations on InMotion

| Item | Path |
|------|------|
| Frontend docroot | `~/app.askbillringle.com/` |
| Backend app | `~/llm-council-pro/` |
| Python venv | `~/llm-council-pro/.venv/` |
| Backend data | `~/llm-council-pro/data/` |
| Environment vars | `~/llm-council-pro/.env` |
| Start script | `~/llm-council-pro/start-prod.sh` |
| Stop script | `~/llm-council-pro/stop-prod.sh` |
| PID file | `~/llm-council-pro/.pid` |
| Backend logs | `~/logs/llm-council.log` |
| .htaccess | `~/app.askbillringle.com/.htaccess` |
