# ABR LLM Council — Deployment Plan

**Domain**: `proxy.askbillringle.com`
**Host**: InMotion VPS
**Status**: Draft
**Date**: 2026-04-01

## Objective

Deploy LLM Council Pro as an invite-only SPA for Bill's clients and collaborators. Users authenticate with a password, select from 3 pre-configured council roles, rate deliberation quality, and all usage is tracked for performance analysis.

---

## Architecture Overview

```
Browser                         InMotion VPS
  │                      ┌──────────────────────────────┐
  │  HTTPS               │  nginx (443)                 │
  ├─────────────────────▶│  proxy.askbillringle.com     │
  │                      │                              │
  │  GET /               │  → frontend/dist/ (SPA)      │
  │  POST /api/*         │  → FastAPI :8001             │
  │                      │                              │
  │                      │  FastAPI                     │
  │                      │  ├── /api/auth/*    (auth)   │
  │                      │  ├── /api/admin/*   (admin)  │
  │                      │  ├── /api/ratings/* (ratings)│
  │                      │  ├── /api/usage/*   (stats)  │
  │                      │  └── data/                   │
  │                      │      ├── settings.json       │
  │                      │      ├── users.json          │
  │                      │      ├── usage.jsonl         │
  │                      │      └── conversations/      │
  │                      └──────────────────────────────┘
```

---

## Phase 1: Auth System (Password-Only, Invite-Only)

### Design

No usernames or emails — password-only access. Admin creates invite codes; users enter a code to get a session token. Simple, low-friction, appropriate for a small invited group.

### Data Model

**`data/users.json`**
```json
{
  "invite_codes": {
    "alpine-fox-2026": {
      "label": "Bill's Test",
      "created_at": "2026-04-01T12:00:00Z",
      "role": "admin",
      "active": true,
      "last_used": null,
      "use_count": 0
    },
    "river-stone-lead": {
      "label": "Client: Jane M.",
      "created_at": "2026-04-01T12:00:00Z",
      "role": "user",
      "active": true,
      "last_used": null,
      "use_count": 0
    }
  }
}
```

### Backend Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `POST` | `/api/auth/login` | None | Validate invite code, return session token |
| `POST` | `/api/auth/validate` | Token | Verify token is still valid |
| `POST` | `/api/admin/invite` | Admin | Create new invite code |
| `DELETE` | `/api/admin/invite/{code}` | Admin | Revoke invite code |
| `GET` | `/api/admin/invites` | Admin | List all invite codes with usage stats |

### Auth Flow

```
1. User visits proxy.askbillringle.com
2. SPA shows password screen (no username field)
3. User enters invite code → POST /api/auth/login
4. Backend validates code, returns JWT with { role, label, code_hash }
5. SPA stores token in sessionStorage (not localStorage — clears on tab close)
6. All subsequent API calls include Authorization: Bearer <token>
7. Backend middleware validates token on every /api/* except /api/auth/login
```

### Token Strategy

- JWT signed with a server-side secret (env var `COUNCIL_JWT_SECRET`)
- Expiry: 24 hours (invite-only users aren't daily users)
- No refresh tokens — re-enter code after expiry
- Role embedded in token: `admin` or `user`

### Frontend Changes

| File | Change |
|------|--------|
| `App.jsx` | Add `authToken` state, wrap app in auth gate |
| New: `LoginScreen.jsx` | Single input field, submit button, error state |
| `api.js` | Add `Authorization` header to all fetches when token exists |

---

## Phase 2: Fixed Council Roles (3 Pre-Configured Options)

### Design

Users don't configure models — they pick from 3 named council roles. Each role has a fixed model lineup, persona set, and tuned prompts. Admin can update configs without users knowing the underlying models.

### The 3 Roles

#### Role 1: Strategy Council

**Purpose**: Business strategy, go-to-market, positioning, competitive analysis

| Seat | Persona | Model | Why |
|------|---------|-------|-----|
| Member 1 | **The Strategist** | `anthropic:claude-sonnet-4-6` | Nuanced strategic reasoning |
| Member 2 | **The Analyst** | `openai:gpt-4o` | Structured quantitative analysis |
| Member 3 | **The Contrarian** | `google:gemini-2.5-flash` | Fast pattern-breaking perspective |
| Chairman | **The Advisor** | `perplexity:sonar-pro` | Web-grounded synthesis with current data |

**Stage 1 Prompt Enhancement**:
> Think like a senior management consultant. Ground recommendations in business fundamentals: unit economics, competitive moats, customer lifetime value, and market timing. Cite frameworks only when they add analytical clarity, not as decoration. If you recommend an action, specify who does it, by when, and what success looks like.

#### Role 2: Content Council

**Purpose**: Cold email, marketing copy, content strategy, messaging

| Seat | Persona | Model | Why |
|------|---------|-------|-----|
| Member 1 | **Alex Hormozi** | `anthropic:claude-sonnet-4-6` | Offer framing, hooks, direct response |
| Member 2 | **The Data Strategist** | `openai:gpt-4o` | Segmentation, A/B test design, benchmarks |
| Member 3 | **The Skeptic** | `google:gemini-2.5-flash` | Buyer-side filtering, deliverability, compliance |
| Chairman | **The Campaign Director** | `perplexity:sonar-pro` | Synthesizes into send-ready copy with current best practices |

**Stage 1 Prompt Enhancement**:
> Deliver specific, actionable copy — not principles. Include example subject lines, opening lines, and CTAs whenever relevant. Explain WHY a particular approach works for the target audience, not just WHAT to write. If recommending personalization, specify which variables move reply rates vs. vanity personalization that doesn't.

#### Role 3: Leadership Council

**Purpose**: Leadership development, team dynamics, organizational design, coaching

| Seat | Persona | Model | Why |
|------|---------|-------|-----|
| Member 1 | **The Executive Coach** | `anthropic:claude-sonnet-4-6` | Empathetic, nuanced leadership advice |
| Member 2 | **The Org Designer** | `openai:gpt-4o` | Structural analysis, role clarity, spans of control |
| Member 3 | **The Researcher** | `google:gemini-2.5-flash` | Evidence-based practices, academic grounding |
| Chairman | **The Mentor** | `perplexity:sonar-pro` | Synthesizes with real-world context and current research |

**Stage 1 Prompt Enhancement**:
> Draw on evidence-based leadership research (not pop psychology). When recommending a practice, cite whether it's supported by organizational behavior research, anecdotal executive experience, or your own inference. Distinguish between advice for first-time managers vs. senior executives — the same question may have very different answers at different levels.

### Backend Implementation

**`data/council_roles.json`**
```json
{
  "strategy": {
    "name": "Strategy Council",
    "description": "Business strategy, GTM, positioning",
    "icon": "chess",
    "council_models": ["anthropic:claude-sonnet-4-6", "openai:gpt-4o", "google:gemini-2.5-flash"],
    "chairman_model": "perplexity:sonar-pro",
    "character_names": {"0": "The Strategist", "1": "The Analyst", "2": "The Contrarian"},
    "chairman_character_name": "The Advisor",
    "member_prompts": {"0": "...", "1": "...", "2": "..."},
    "chairman_custom_prompt": "...",
    "stage1_prompt": "...",
    "council_temperature": 0.5,
    "chairman_temperature": 0.4,
    "execution_mode": "full"
  },
  "content": { ... },
  "leadership": { ... }
}
```

### New Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/api/roles` | User | List available council roles |
| `GET` | `/api/roles/{role_id}` | User | Get role config (models redacted for users) |
| `PUT` | `/api/admin/roles/{role_id}` | Admin | Update role config |

### Frontend Changes

| File | Change |
|------|--------|
| New: `RoleSelector.jsx` | 3-card selector shown before first message or in sidebar |
| `ChatInterface.jsx` | Pass selected role to `sendMessage`; display role badge in header |
| `App.jsx` | Add `selectedRole` state; pass to ChatInterface |
| Remove from user view | Settings panel model selection (admin-only now) |

### Message Flow Change

```
1. User selects a role (e.g., "Content Council")
2. SPA sends role_id with message: POST /api/conversations/{id}/message/stream
   { content: "...", role_id: "content", web_search: false, ... }
3. Backend loads role config from council_roles.json
4. Backend applies role's models, prompts, temps to this deliberation
5. Role is stored in conversation metadata for replay
```

---

## Phase 3: Satisfaction Rating

### Design

After each completed deliberation (Stage 5 rendered), show a simple rating widget. Ratings are stored per-conversation-message and aggregated for admin dashboard.

### Rating Model

```json
{
  "score": 4,
  "comment": "Good segmentation but subject lines too generic",
  "rated_at": "2026-04-01T14:30:00Z",
  "role_id": "content",
  "invite_label": "Client: Jane M."
}
```

- **Score**: 1-5 stars (simple, fast, mobile-friendly)
- **Comment**: Optional free-text (shown after star selection)
- **Context**: role_id and invite_label stored automatically

### Backend Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `POST` | `/api/conversations/{id}/messages/{idx}/rating` | User | Submit rating |
| `GET` | `/api/admin/ratings` | Admin | List all ratings with filters |
| `GET` | `/api/admin/ratings/summary` | Admin | Aggregated stats by role, time period |

### Storage

Ratings stored inline in conversation JSON (keeps data co-located):

```json
{
  "role": "assistant",
  "stage1": [...],
  "stage5": {...},
  "metadata": {...},
  "rating": {
    "score": 4,
    "comment": "...",
    "rated_at": "2026-04-01T14:30:00Z",
    "role_id": "content",
    "invite_label": "Client: Jane M."
  }
}
```

Also appended to `data/ratings.jsonl` for fast aggregation without scanning all conversations.

### Frontend Changes

| File | Change |
|------|--------|
| New: `RatingWidget.jsx` | 5-star selector + optional comment textarea |
| `Stage5.jsx` | Render RatingWidget below chairman response (after loading complete) |
| `ChatInterface.jsx` | Pass `onRate` callback and auth context to Stage5 |

### Rating UX Flow

```
1. Stage 5 finishes rendering
2. Below the response, show: ★ ★ ★ ★ ★  "How useful was this?"
3. User clicks a star → stars fill, comment field slides open
4. User optionally types comment → clicks "Submit"
5. POST /api/conversations/{id}/messages/{idx}/rating
6. Stars lock (no re-rating), show "Thanks for your feedback"
```

---

## Phase 4: Backend Admin & Monitoring

### 4A: Admin Dashboard Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/api/admin/dashboard` | Admin | Overview: total conversations, ratings avg, active users, costs |
| `GET` | `/api/admin/usage` | Admin | Usage stats with date range filter |
| `GET` | `/api/admin/usage/by-role` | Admin | Breakdown by council role |
| `GET` | `/api/admin/usage/by-user` | Admin | Breakdown by invite code label |
| `GET` | `/api/admin/usage/by-model` | Admin | Breakdown by LLM model |
| `GET` | `/api/admin/health` | Admin | System health: API key status, model availability |
| `GET` | `/api/admin/errors` | Admin | Recent errors with context |

### 4B: Usage Tracking

Every deliberation appends a record to `data/usage.jsonl`:

```json
{
  "timestamp": "2026-04-01T14:30:00Z",
  "conversation_id": "uuid",
  "message_index": 2,
  "role_id": "content",
  "invite_label": "Client: Jane M.",
  "execution_mode": "full",
  "web_search": true,
  "debate_enabled": false,
  "models_used": ["anthropic:claude-sonnet-4-6", "openai:gpt-4o", "google:gemini-2.5-flash", "perplexity:sonar-pro"],
  "stages_completed": ["stage1", "stage2", "stage3", "stage4", "stage5"],
  "duration_ms": {
    "total": 45000,
    "stage1": 12000,
    "stage2": 8000,
    "stage3": 10000,
    "stage4": 5000,
    "stage5": 10000
  },
  "token_usage": {
    "anthropic:claude-sonnet-4-6": {"input": 2400, "output": 1800},
    "openai:gpt-4o": {"input": 2400, "output": 1500},
    "google:gemini-2.5-flash": {"input": 2400, "output": 1200},
    "perplexity:sonar-pro": {"input": 8000, "output": 2000}
  },
  "errors": [],
  "rating": null
}
```

**Why JSONL**: Append-only, no locking issues, easy to grep/filter, can be rotated monthly.

### 4C: Performance Analysis

Admin dashboard calculates from usage.jsonl:

| Metric | Calculation | Purpose |
|--------|-------------|---------|
| **Avg deliberation time** | Mean of `duration_ms.total` | Identify slow models |
| **Stage bottleneck** | Max stage duration per run | Find which stage to optimize |
| **Model reliability** | `errors` count per model / total runs | Detect flaky providers |
| **Cost per deliberation** | Token usage × model pricing | Budget monitoring |
| **Avg rating by role** | Mean of `rating.score` grouped by `role_id` | Which council is most valued |
| **Usage by user** | Count of runs grouped by `invite_label` | Identify active users |
| **Usage trend** | Daily/weekly run counts | Demand forecasting |

### 4D: Reliability Monitoring

**Automatic error tracking** (append to `data/errors.jsonl`):

```json
{
  "timestamp": "2026-04-01T14:30:00Z",
  "model": "google:gemini-2.5-flash",
  "stage": "stage1",
  "error_type": "rate_limit",
  "error_message": "429 Too Many Requests",
  "conversation_id": "uuid",
  "role_id": "content",
  "resolved": false
}
```

**Health check endpoint** (`GET /api/admin/health`):

```json
{
  "status": "degraded",
  "providers": {
    "anthropic": {"status": "ok", "last_success": "2026-04-01T14:28:00Z"},
    "openai": {"status": "ok", "last_success": "2026-04-01T14:28:00Z"},
    "google": {"status": "error", "last_error": "rate_limit", "last_success": "2026-04-01T13:00:00Z"},
    "perplexity": {"status": "ok", "last_success": "2026-04-01T14:29:00Z"}
  },
  "uptime_24h": 0.98,
  "errors_24h": 3,
  "conversations_24h": 12
}
```

### 4E: Admin Config Flexibility

Admin can change via API without redeploying:

| Setting | Endpoint | Effect |
|---------|----------|--------|
| Swap a model in a role | `PUT /api/admin/roles/content` | Next deliberation uses new model |
| Adjust temperature | `PUT /api/admin/roles/strategy` | Changes reasoning style |
| Update prompts | `PUT /api/admin/roles/leadership` | Refines council behavior |
| Create invite code | `POST /api/admin/invite` | Grant access to new user |
| Revoke access | `DELETE /api/admin/invite/{code}` | Immediately invalidates sessions |
| Toggle web search default | `PUT /api/admin/config` | Changes default for all users |

---

## Implementation Order

| Priority | Phase | Effort | Depends On |
|----------|-------|--------|------------|
| P0 | Phase 1: Auth | 2 days | Nothing (blocks everything else) |
| P0 | Phase 2: Council Roles | 1 day | Phase 1 (role stored per conversation) |
| P1 | Phase 3: Satisfaction Rating | 1 day | Phase 1 (invite_label in rating) |
| P1 | Phase 4A-B: Usage Tracking | 1 day | Phase 1 (user context in logs) |
| P2 | Phase 4C-D: Dashboard & Monitoring | 2 days | Phase 4A-B (needs data to display) |
| P2 | Phase 4E: Admin Config API | 1 day | Phase 2 (modifies role configs) |

**Total estimated build**: 8 days

---

## File Changes Summary

### New Files

| File | Purpose |
|------|---------|
| `backend/auth.py` | JWT creation, validation, invite code management |
| `backend/middleware.py` | Auth middleware for all /api/* routes |
| `backend/admin.py` | Admin endpoints (invites, roles, dashboard, usage) |
| `backend/usage.py` | Usage tracking, JSONL append, aggregation queries |
| `backend/ratings.py` | Rating storage, aggregation |
| `data/users.json` | Invite codes and roles |
| `data/council_roles.json` | 3 fixed role configurations |
| `data/usage.jsonl` | Append-only usage log |
| `data/errors.jsonl` | Append-only error log |
| `data/ratings.jsonl` | Append-only ratings log |
| `frontend/src/components/LoginScreen.jsx` | Password-only login |
| `frontend/src/components/RoleSelector.jsx` | 3-card council role picker |
| `frontend/src/components/RatingWidget.jsx` | 5-star rating + comment |

### Modified Files

| File | Change |
|------|--------|
| `backend/main.py` | Add auth middleware, role-based message flow, rating endpoint |
| `backend/storage.py` | Add rating field to message schema, usage append |
| `backend/council.py` | Accept role config override instead of global settings |
| `frontend/src/App.jsx` | Auth gate, role selection state, token management |
| `frontend/src/api.js` | Add Authorization header, new endpoints |
| `frontend/src/components/ChatInterface.jsx` | Role badge, rating callback |
| `frontend/src/components/Stage5.jsx` | Render RatingWidget |
| `frontend/src/components/Settings.jsx` | Hide model config from user role; show admin panel for admin role |

---

## Environment Variables (InMotion VPS)

| Variable | Example | Description |
|----------|---------|-------------|
| `COUNCIL_JWT_SECRET` | `random-64-char-string` | JWT signing key |
| `COUNCIL_ADMIN_CODE` | `alpine-fox-2026` | Bootstrap admin invite code |
| `ANTHROPIC_API_KEY` | `sk-ant-...` | Anthropic API key |
| `OPENAI_API_KEY` | `sk-...` | OpenAI API key |
| `GOOGLE_API_KEY` | `AIza...` | Google AI API key |
| `PERPLEXITY_API_KEY` | `pplx-...` | Perplexity API key |

---

## Security Considerations

- Invite codes are hashed (bcrypt) in `users.json` — plaintext never stored
- JWT secret must be 64+ characters, generated via `python -c "import secrets; print(secrets.token_hex(32))"`
- API keys remain in `data/settings.json` — file permissions must be `600`
- Rate limit: max 10 deliberations per invite code per hour (prevents abuse)
- Admin role required for all `/api/admin/*` endpoints
- No PII stored — invite labels are admin-assigned nicknames, not real names
- JSONL files should be rotated monthly and archived
