# ABR LLM Council — Deployment Plan

**Domain**: `proxy.askbillringle.com`
**Host**: InMotion VPS
**Status**: Revised (post-check)
**Date**: 2026-04-01
**Revised**: 2026-04-01

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

## Phase 0: Rate Limit Resilience & Token Tracking

### Problem

A full deliberation generates ~20+ API calls across 5 stages. The current direct providers (`providers/anthropic.py`, `providers/google.py`, `providers/openai.py`, `providers/perplexity.py`) have **no retry logic** for rate limits — only `openrouter.py` and `ollama_client.py` have retries. Additionally, the backend does not capture token usage from API responses, which blocks cost tracking in Phase 4B.

### 0A: Add Retry Logic to Direct Providers

Each direct provider's `query()` method must handle HTTP 429 with exponential backoff, matching the pattern already in `openrouter.py`:

**Files to modify:**

| File | Current State | Change |
|------|--------------|--------|
| `backend/providers/anthropic.py` | No retry | Add 3-retry loop with 1s/2s/4s backoff on 429 and 529 (overloaded) |
| `backend/providers/openai.py` | No retry | Add 3-retry loop with 1s/2s/4s backoff on 429 |
| `backend/providers/google.py` | No retry | Add 3-retry loop with 1s/2s/4s backoff on 429 and 503 |
| `backend/providers/perplexity.py` | No retry | Add 3-retry loop with 1s/2s/4s backoff on 429 |

**Retry pattern** (standardized across all providers):

```python
MAX_RETRIES = 3
INITIAL_RETRY_DELAY = 1.0

for attempt in range(MAX_RETRIES + 1):
    try:
        response = await client.post(...)
        if response.status_code == 429:
            if attempt < MAX_RETRIES:
                delay = INITIAL_RETRY_DELAY * (2 ** attempt)
                logger.warning(f"Rate limited on {model_id}, retry in {delay}s ({attempt+1}/{MAX_RETRIES})")
                await asyncio.sleep(delay)
                continue
            return {"response": None, "error": True, "error_message": "Rate limited after retries"}
        # process successful response...
    except httpx.ReadTimeout:
        if attempt < MAX_RETRIES:
            await asyncio.sleep(INITIAL_RETRY_DELAY * (2 ** attempt))
            continue
        return {"response": None, "error": True, "error_message": "Request timed out after retries"}
```

### 0B: Extract Token Usage from API Responses

Each provider returns token counts in different formats. Normalize to a common shape and propagate through `council.py`.

**Provider response formats:**

| Provider | Token Field | Format |
|----------|------------|--------|
| Anthropic | `response.usage` | `{"input_tokens": N, "output_tokens": N}` |
| OpenAI | `response.usage` | `{"prompt_tokens": N, "completion_tokens": N}` |
| Google | `response.usage_metadata` | `{"prompt_token_count": N, "candidates_token_count": N}` |
| Perplexity | `response.usage` | `{"prompt_tokens": N, "completion_tokens": N}` (OpenAI-compatible) |

**Normalized shape** (returned from each provider's `query()` method):

```python
{
    "response": "model text...",
    "error": False,
    "token_usage": {"input": 2400, "output": 1800}  # NEW FIELD
}
```

**Propagation path:**

1. Each provider's `query()` extracts token counts from API response → returns `token_usage`
2. `council.py` `query_model()` passes `token_usage` through in its return dict
3. `council.py` stage functions (`stage1_collect_responses`, etc.) collect per-model token usage
4. `main.py` streaming handler accumulates token usage across stages → passes to `usage.py` for logging

### 0C: Add Stage Timing to Backend

The current backend emits SSE timing events but doesn't record them server-side. Add timing instrumentation to `main.py`'s streaming handler:

```python
stage_timers = {}

# Before each stage:
stage_timers["stage1_start"] = time.time()

# After each stage:
stage_timers["stage1_end"] = time.time()
stage_timers["stage1_duration_ms"] = int((stage_timers["stage1_end"] - stage_timers["stage1_start"]) * 1000)
```

Pass `stage_timers` to usage tracking at deliberation completion.

### 0D: Inter-Stage Delay for Rate Limit Protection

Add a configurable delay between stages to prevent burst-firing 3 models simultaneously across 5 stages. Default: 500ms between stages. Configurable via `data/settings.json`:

```json
{
  "inter_stage_delay_ms": 500
}
```

This is especially important for Google (Gemini) which has lower per-minute limits than Anthropic/OpenAI.

---

## Phase 1: Auth System (Password-Only, Invite-Only)

### Design

No usernames or emails — password-only access. Admin creates invite codes; users enter a code to get a session token. Simple, low-friction, appropriate for a small invited group.

### Data Model

Invite codes are stored as plaintext dictionary keys. This is acceptable for a small invite-only system (< 50 users) where the `data/` directory is access-restricted on the server. The codes themselves are random 3-word phrases that are not guessable.

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

**File permissions**: `data/users.json` must be `600` (owner read/write only). The nginx config blocks `/data/*` from HTTP access.

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

### Conversation Isolation

Users must only see their own conversations. The current `GET /api/conversations` returns all conversations from the flat `data/conversations/` directory.

**Implementation:**

1. Add `created_by` field to conversation JSON (set from JWT `label` on creation):
   ```json
   {
     "id": "uuid",
     "created_by": "Client: Jane M.",
     "created_at": "2026-04-01T12:00:00Z",
     ...
   }
   ```

2. Modify `storage.py` `list_conversations()` to accept `created_by` filter parameter

3. Modify `backend/main.py` `GET /api/conversations` to extract `label` from JWT and pass as filter

4. Admin role bypasses filter — sees all conversations

5. Modify `GET /api/conversations/{id}` to verify the requesting user's label matches `created_by` (or user is admin)

**No directory namespacing** — conversations stay in the flat `data/conversations/` directory. The filter is applied at query time. This avoids filesystem changes and keeps the backup strategy simple.

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

### Backend Implementation — Extending the Existing Presets System

The backend already has a full presets CRUD API (`GET/POST/PUT/DELETE /api/presets`) stored in `data/presets.json`. Rather than creating a parallel `council_roles.json`, roles are implemented as **locked presets** — presets with a `locked: true` flag that cannot be modified or deleted by regular users.

**Extended preset schema** (add to existing preset structure):

```json
{
  "name": "Strategy Council",
  "locked": true,
  "role_id": "strategy",
  "description": "Business strategy, GTM, positioning",
  "icon": "chess",
  "config": {
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
  }
}
```

**Changes to existing presets system:**

| File | Change |
|------|--------|
| `backend/presets.py` | Add `locked` and `role_id` fields; reject user DELETE/PUT on locked presets |
| `backend/main.py` | `GET /api/presets` returns all presets; frontend filters by `locked` for role display |

**Why reuse presets**: Avoids a parallel storage system, reuses existing CRUD endpoints, and the admin preset import/export feature works for roles too.

### New Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/api/roles` | User | List locked presets (redacts model IDs for user role) |
| `PUT` | `/api/admin/roles/{role_id}` | Admin | Update a locked preset's config |

### Frontend Changes

| File | Change |
|------|--------|
| New: `RoleSelector.jsx` | 3-card selector shown before first message or in sidebar |
| `ChatInterface.jsx` | Pass selected role to `sendMessage`; display role badge in header |
| `App.jsx` | Add `selectedRole` state; pass to ChatInterface |
| `Settings.jsx` | Hide model config from user role; show admin panel for admin role |
| Existing preset UI | Hidden from user view — users only see RoleSelector |

### Message Flow Change

```
1. User selects a role (e.g., "Content Council")
2. SPA sends role_id with message: POST /api/conversations/{id}/message/stream
   { content: "...", role_id: "content", web_search: false, ... }
3. Backend loads locked preset by role_id from presets.json
4. Backend constructs a config dict from the preset and passes it to council.py
   stage functions via parameters (NOT by mutating global settings — prevents
   race conditions with concurrent users)
5. Role is stored in conversation metadata for replay
```

**Concurrency note**: `council.py` functions (`stage1_collect_responses`, `stage2_collect_rankings`, etc.) currently call `get_settings()` internally to read models and prompts. These must be refactored to accept a `config` parameter that overrides global settings. When `role_id` is present in the request, the streaming handler builds this config from the preset and passes it through. When no `role_id` is present (admin using raw settings), the existing `get_settings()` path is used unchanged.

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
| Global defaults | `PUT /api/admin/config` | Changes defaults for all users |

**`PUT /api/admin/config` request model:**

```json
{
  "web_search_default": true,
  "debate_enabled_default": false,
  "execution_mode_default": "full",
  "inter_stage_delay_ms": 500,
  "max_deliberations_per_hour": 10,
  "truth_check_default": false
}
```

All fields are optional — only provided fields are updated. These defaults are stored in `data/settings.json` under a new `admin_defaults` key and applied when a user starts a new conversation. Users can override per-conversation (except `max_deliberations_per_hour`, which is enforced server-side).

---

## Implementation Order

| Priority | Phase | Effort | Depends On |
|----------|-------|--------|------------|
| P0 | Phase 0: Rate Limit & Token Tracking | 1 day | Nothing (foundational infrastructure) |
| P0 | Phase 1: Auth | 2 days | Nothing (blocks user-facing features) |
| P0 | Phase 2: Council Roles | 1 day | Phase 1 (role stored per conversation) |
| P1 | Phase 3: Satisfaction Rating | 1 day | Phase 1 (invite_label in rating) |
| P1 | Phase 4A-B: Usage Tracking | 1 day | Phase 0 (token data), Phase 1 (user context) |
| P2 | Phase 4C-D: Dashboard & Monitoring | 2 days | Phase 4A-B (needs data to display) |
| P2 | Phase 4E: Admin Config API | 1 day | Phase 2 (modifies role configs) |

**Total estimated build**: 9 days

### Wave Schedule

```
Wave 1 (parallel): Phase 0 (Rate Limits) + Phase 1 (Auth)
Wave 2 (parallel): Phase 2 (Roles) + Phase 3 (Ratings) + Phase 4A-B (Usage Tracking)
Wave 3 (parallel): Phase 4C-D (Dashboard) + Phase 4E (Admin Config)
```

---

## File Changes Summary

### New Files

| File | Purpose |
|------|---------|
| `pyproject.toml` | Add `PyJWT>=2.8.0` dependency (JWT auth) |
| `backend/retry.py` | Shared retry decorator/helper for direct providers (Phase 0) |
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
| `backend/council.py` | Accept role config parameter; propagate token_usage from providers |
| `backend/providers/anthropic.py` | Add retry logic, extract token_usage (Phase 0) |
| `backend/providers/openai.py` | Add retry logic, extract token_usage (Phase 0) |
| `backend/providers/google.py` | Add retry logic, extract token_usage (Phase 0) |
| `backend/providers/perplexity.py` | Add retry logic, extract token_usage (Phase 0) |
| `frontend/src/App.jsx` | Auth gate, role selection state, token management |
| `frontend/src/api.js` | Add Authorization header, new endpoints |
| `frontend/src/components/ChatInterface.jsx` | Role badge, rating callback |
| `frontend/src/components/Stage5.jsx` | Render RatingWidget |
| `frontend/src/components/Settings.jsx` | Hide model config from user role; show admin panel for admin role |

---

## Environment Variables (InMotion VPS)

| Variable | Example | Description |
|----------|---------|-------------|
| `COUNCIL_JWT_SECRET` | `random-64-char-string` | JWT signing key (required) |
| `COUNCIL_ADMIN_CODE` | `alpine-fox-2026` | Bootstrap admin invite code (required, first-run only) |

### API Key Management

LLM API keys remain in `data/settings.json` — the existing storage mechanism. They are **not** migrated to environment variables because:

1. The backend already reads/writes keys via the Settings model and admin UI
2. The admin can test and rotate keys via the Settings panel without SSH access
3. Environment variables would require a service restart to update

**Security**: `data/settings.json` permissions must be `600`. The nginx config blocks all `/data/*` paths from HTTP access. The admin UI for key management is protected by the auth system (admin role required to view Settings).

**Bootstrap sequence** (first deployment):
1. Set `COUNCIL_JWT_SECRET` and `COUNCIL_ADMIN_CODE` in systemd service env
2. Start the backend — it creates `data/users.json` with the bootstrap admin code
3. Admin logs in via the SPA, opens Settings, enters LLM API keys through the UI
4. Keys persist in `data/settings.json` across restarts

---

## Security Considerations

- Invite codes are stored as plaintext in `users.json` — acceptable for a small invite-only system (< 50 users) where `data/` is filesystem-restricted. Codes are random 3-word phrases (e.g., `alpine-fox-2026`) that are not guessable. If the system scales beyond ~50 users, migrate to bcrypt-hashed codes with a list structure.
- `data/users.json` and `data/settings.json` file permissions must be `600` (owner read/write only)
- nginx config must block all `/data/*` paths from HTTP access
- JWT secret must be 64+ characters, generated via `python -c "import secrets; print(secrets.token_hex(32))"`
- Rate limit: max 10 deliberations per invite code per hour (enforced server-side, prevents abuse and runaway API costs)
- Admin role required for all `/api/admin/*` endpoints — role is embedded in JWT and validated by middleware
- No PII stored — invite labels are admin-assigned nicknames, not real names
- Conversations are isolated per invite code — users cannot access each other's deliberations
- JSONL files (`usage.jsonl`, `errors.jsonl`, `ratings.jsonl`) should be rotated monthly and archived
