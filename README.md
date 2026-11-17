# Weekly Task Planner — Multi-Tenant SaaS

> A full-stack MERN task planner: mobile-first React and Tailwind UI, an Express 5 API, tenant-scoped MongoDB data, Redis caching, and BullMQ reminders.

**Live demo:** [Add live demo URL](#) · **Video walkthrough:** [Add video link](#) · **Figma:** [Add design link](#)

This repository is the Express backend. The companion client lives in [`../todo-react-frontend`](../todo-react-frontend); its UI-specific setup and behaviors are also described in that repository's README.

## Executive summary

The planner organizes tasks into server-computed Monday–Sunday weeks, with day/week navigation, weekly open/completed counts, task create/edit/status/delete flows, keyword search, and touch swipe-to-delete. The app extends those task-management flows with multi-tenant workspaces and role-based permissions, an in-memory access-token client with refresh-cookie rotation, configurable reminder channels, an asynchronous delivery worker, and mobile-oriented alarm experiences.

The browser UI is responsive and mobile-first, but **is not currently packaged as an installable/offline PWA**: the frontend has no web app manifest or service worker. The frontend implements an in-app alarm panel, Web Audio chime and vibration when supported; browser scheduling is subject to the tab being active and browser/device policies.

## System architecture

[![System Architecture](./docs/architecture.png)](./docs/architecture.svg)

Open the [zoomable SVG diagram](./docs/architecture.svg) or inspect its [Mermaid source](./docs/architecture.mmd).

### Five architectural layers

1. **Mobile-first client:** React + Tailwind provides weekly cards, search, task forms, touch gestures, workspace switching, in-memory access tokens, silent refresh, and the optional foreground Web Audio/vibration alarm.
2. **API gateway and security:** Express 5 mounts auth, workspace, task and calendar routes. Zod validates request bodies; login is rate-limited; JWT authentication and workspace membership/role guards run before protected operations.
3. **Tenant-scoped reads:** List/search and weekly-summary responses use workspace-keyed Redis cache-aside with `X-Cache: HIT|MISS`; MongoDB is the source of truth. Weekly summary groups with `$dateTrunc` using Monday as the week start and the requested timezone.
4. **Writes and invalidation:** Task CRUD is scoped to the authorized workspace, writes invalidate that workspace's task cache keys, and eligible tasks get a deterministic BullMQ delayed reminder job.
5. **Async reminders:** A separate BullMQ worker rechecks task/workspace state, then dispatches email and WhatsApp channels concurrently. Email can include an RFC 5545 `.ics` event with a `VALARM`; authenticated task-alarm and calendar-feed endpoints provide additional calendar output.

> **Calendar integration boundary:** The calendar feed endpoint requires the user's Bearer access token and only permits that user ID. External calendar clients generally cannot attach the web app's authorization header. The app therefore supports authenticated per-task `.ics` downloads, but an automatically refreshable external calendar subscription would need a separate feed-token mechanism. The email delivery worker currently attaches the `.ics` event only when the task requests `MOBILE_ALARM` and the user allows that preference.

## Engineering highlights

### Multi-tenancy and security

- Each task stores `workspaceId` and `createdBy`; task reads, updates and deletes include the authorized workspace in their MongoDB filter.
- Workspace membership is resolved from `x-workspace-id` (or the user's default workspace if the header is absent). Invalid workspace IDs return `400`; missing membership or disallowed roles return `403`.
- Access JWTs default to 15 minutes and refresh JWTs to 7 days. The refresh token is an `HttpOnly`, `Secure`, `SameSite=Strict` cookie scoped to `/api/auth`; the browser client keeps the access token in memory and serializes concurrent refresh attempts through one shared promise.
- Refresh-token hashes are stored server-side. Refresh rotates the cookie/token hash; reusing a rotated/unknown token revokes all refresh sessions for that account.
- Password reset links contain a single-use 32-byte token; only its SHA-256 hash is stored, the link expires after 15 minutes, and successful resets revoke every refresh session. Forgot/reset requests are each limited to 5 per 15 minutes per IP.
- Registration requires a 12–128 character password, hashes it with bcrypt, and provisions a personal `"<Name>'s Workspace"` with the user as `OWNER`.
- Login is limited to 10 attempts per 15 minutes per rate-limiter key. The API enables credentialed CORS for configured `FRONTEND_URL` origins and exposes `X-Cache`.

#### Role and permission matrix

| Action | OWNER | ADMIN | MEMBER | VIEWER |
| --- | :---: | :---: | :---: | :---: |
| List/search tasks, weekly summary, upcoming alarms, task `.ics` | Yes | Yes | Yes | Yes |
| Read individual task detail (`GET /tasks/:id`) | Yes | Yes | Yes | No |
| Create, edit, or change task status | Yes | Yes | Yes | No |
| Delete any task in the workspace | Yes | Yes | No | No |
| Delete own task | Yes | Yes | Yes | No |
| List/create workspaces | Yes | Yes | Yes | Yes |
| Invite an existing user as `ADMIN`, `MEMBER`, or `VIEWER` | Yes | Yes | No | No |
| Change another member's role | Yes | No | No | No |
| Remove a non-owner member | Yes | Yes | No | No |
| Delete workspace | Yes | No | No | No |

Task `MEMBER` writes are workspace-scoped; the backend specifically limits deletion to tasks created by that member. The backend does not impose a creator-only restriction on task edits/status changes. A workspace owner cannot be removed or have their role changed.

### Database and caching performance

- MongoDB indexes support workspace/date/status task queries and workspace-scoped text search over task title and description. Workspace membership has an index; user email is unique.
- Weekly summaries are computed by a MongoDB aggregation pipeline using `$dateTrunc` with `startOfWeek: "monday"` and the caller's IANA timezone or UTC offset. The API response contains week start/end, task arrays, and total/open/completed counts.
- Redis caches task list/search and weekly-summary responses for 300 seconds. Keys include the workspace ID; weekly keys also include the timezone.
- Cache hits set `X-Cache: HIT`; misses or Redis read failures set `X-Cache: MISS` and load from MongoDB. Redis cache write and invalidation failures are logged and do not replace the MongoDB response path. Task mutations scan and unlink `workspace:<id>:tasks:*` keys.

### Distributed reminders and mobile alarms

- A task's `reminderConfig` supports `EMAIL`, `WHATSAPP`, and `MOBILE_ALARM`. User preferences and the configured lead time determine whether a delayed job is eligible; the default lead time is 15 minutes.
- BullMQ uses deterministic job IDs (`task-reminder-<taskId>`), schedules at due time minus the user's lead time, and configures three attempts with exponential backoff starting at 5 seconds. The worker runs with concurrency 5 and skips deleted, completed, stale-date, or inactive-workspace jobs.
- Email (Nodemailer/SMTP) and WhatsApp (Meta Cloud API or Twilio) are dispatched concurrently with `Promise.allSettled`; per-channel states are persisted. If a requested delivery fails, the worker throws so BullMQ can retry. Missing provider credentials produce a logged `SKIPPED`/dry-run outcome rather than sending.
- When `MOBILE_ALARM` is requested and enabled, the email can include an `.ics` attachment with an RFC 5545 `VALARM` trigger at the user's lead time. The task ICS endpoint generates the same type of calendar event; when the user's mobile-alarm preference is enabled, the calendar feed can include up to 2,000 future in-progress tasks created by the requesting user across their active workspaces.
- The frontend polls upcoming alarms every 60 seconds while mobile alarms are enabled, checks the configured lead-time window, and offers snooze (5 minutes), dismiss, and mark-completed actions. It uses a synthesized Web Audio chime and `navigator.vibrate` where supported. This is not a guaranteed OS alarm or background push service; the browser may suspend polling when the page is inactive.
- The API has a notification-settings write endpoint but no read endpoint. After a full reload, the frontend initializes its local preferences to defaults; it cannot rehydrate previously saved values from the current API contract.

## API reference

All paths below are mounted on this API server. Auth routes use `/api/auth`; workspace routes use `/api/workspaces`; calendar uses `/api/calendar`; task routes are available under both `/api/tasks` and the compatibility alias `/api/v1/tasks`. Protected requests use `Authorization: Bearer <accessToken>`; task operations use `x-workspace-id` (default workspace fallback applies when omitted).

Successful JSON responses generally use `{ "success": true, "data": ... }`. Zod body validation returns `400` with `{ "success": false, "message": "Validation failed", "errors": [{ "field": "...", "message": "..." }] }`. Authorization failures return `403`; missing resources return `404`.

### Authentication

| Method | Endpoint | Access | Request / response |
| --- | --- | --- | --- |
| `POST` | `/api/auth/register` | Public; login rate limit does not apply | Body: `{ name, email, password }`; returns `201` session `{ accessToken, user: { id, name, email, defaultWorkspaceId } }` and sets refresh cookie. Duplicate email: `409`. |
| `POST` | `/api/auth/login` | Public; 10 attempts / 15 min | Body: `{ email, password }`; returns session and refresh cookie. Invalid credentials: `401`; rate limit: `429`. |
| `POST` | `/api/auth/forgot-password` | Public; 5 attempts / 15 min | Body: `{ email }`; always returns the same `200` response to prevent account enumeration. In non-production without `SMTP_HOST`, includes a `devResetUrl` for local testing. |
| `GET` | `/api/auth/reset-password/verify?token=...` | Public | Optional pre-check; returns `{ success: true, valid: true }` for an unexpired link, otherwise `400`. |
| `POST` | `/api/auth/reset-password` | Public; 5 attempts / 15 min | Body: `{ token, password }`; password must be 8–128 characters with uppercase, lowercase, and numeric characters. Success clears the reset token and all refresh sessions. |
| `POST` | `/api/auth/refresh` | Refresh cookie | Rotates refresh cookie and returns a new access token and user summary. Invalid/reused token: `401`; reuse revokes all refresh sessions for that user. |
| `POST` | `/api/auth/logout` | Refresh cookie optional | Revokes the presented refresh token when valid and clears the cookie. |
| `PATCH` | `/api/auth/notifications` | Authenticated | Optional `phoneNumber` and/or `notificationPreferences` (`email`, `whatsapp`, `mobileAlarm`, `leadTimeMinutes`). WhatsApp requires an E.164 phone number. Returns the saved settings and reschedules eligible tasks. There is no GET preferences endpoint. |

### Workspaces and membership

| Method | Endpoint | Roles / behavior |
| --- | --- | --- |
| `GET` | `/api/workspaces` | Any authenticated member; returns active workspaces and membership roles. |
| `POST` | `/api/workspaces` | Any authenticated user; body `{ name }`; creates workspace with requester as `OWNER`. |
| `DELETE` | `/api/workspaces/:id` | `OWNER`; soft-deletes the workspace and updates affected users' default workspace. |
| `POST` | `/api/workspaces/:id/members` | `OWNER`, `ADMIN`; body `{ email, role }`, where role is `ADMIN`, `MEMBER`, or `VIEWER`; invited user must already exist. |
| `PATCH` | `/api/workspaces/:id/members/:userId` | `OWNER`; body `{ role }` (`ADMIN`, `MEMBER`, `VIEWER`). Owner role cannot be changed. |
| `DELETE` | `/api/workspaces/:id/members/:userId` | `OWNER`, `ADMIN`; removes a non-owner member. |

### Tasks and weekly summary

| Method | Endpoint | Roles / behavior |
| --- | --- | --- |
| `GET` | `/api/tasks` | `OWNER`, `ADMIN`, `MEMBER`, `VIEWER`; optional `?search=<text>` performs workspace-scoped text search. |
| `POST` | `/api/tasks` | `OWNER`, `ADMIN`, `MEMBER`; creates a workspace task. Requires title and `dateTime` or `scheduledAt` as ISO datetime; optional priority, status, description, reminder config. |
| `GET` | `/api/tasks/weekly-summary` | All four roles; `?timezone=<IANA zone>` or `?timezoneOffset=<offset>`; Monday–Sunday workspace-scoped grouping. |
| `GET` | `/api/tasks/upcoming-alarms` | All four roles; returns in-progress tasks in the next hour for the selected workspace. |
| `GET` | `/api/tasks/:id` | `OWNER`, `ADMIN`, `MEMBER`; Viewer is not included in this route's detail-role list. |
| `PUT`, `PATCH` | `/api/tasks/:id` | `OWNER`, `ADMIN`, `MEMBER`; partial task updates are accepted by the update schema. |
| `PATCH` | `/api/tasks/:id/status` | `OWNER`, `ADMIN`, `MEMBER`; body `{ status: "In Progress" \| "Completed" }`. |
| `DELETE` | `/api/tasks/:id` | `OWNER`, `ADMIN`, `MEMBER`; a `MEMBER` may delete only tasks they created. |

Task enums are `priority: Low|Medium|High`, `status: In Progress|Completed`, and reminder channels `EMAIL|WHATSAPP|MOBILE_ALARM`. The frontend serializes task date/time inputs as ISO-8601 UTC strings.

### Calendar and alarm events

| Method | Endpoint | Access / behavior |
| --- | --- | --- |
| `GET` | `/api/tasks/:id/alarm.ics` | Workspace read roles; returns a private, no-store `text/calendar` attachment with a `VALARM`. |
| `GET` | `/api/calendar/feed/:userId.ics` | Authenticated; the route only allows the caller's own user ID and, when mobile alarms are enabled, returns up to 2,000 future in-progress tasks created by that user across active workspaces, inline as `text/calendar`. |

The feed is not a bearerless subscription URL. Do not paste it into a third-party calendar client expecting it to reuse the browser session; use authenticated task-level downloads unless a separate calendar-token capability is deployed.

## Local setup

### Prerequisites

- Node.js 20 or newer and npm.
- MongoDB 5.0 or newer (for `$dateTrunc`) reachable by the backend.
- Redis reachable by the backend and reminder worker.
- SMTP and/or WhatsApp provider credentials to deliver real external reminders. The app can run without provider credentials, but delivery providers log skipped/dry-run outcomes.

### 1. Configure and run MongoDB and Redis

Start local MongoDB and Redis, or provision compatible hosted services. The defaults in the backend example are `mongodb://127.0.0.1:27017/todo` and `redis://127.0.0.1:6379`.

### 2. Configure and run the Express API

```powershell
cd D:\Assesment\todo-express5-backend
npm install
Copy-Item .env.example .env
# Edit .env with local connection strings and secrets.
npm run dev
```

The API listens on port `5000` by default; `GET /health` checks server readiness.

### 3. Run the BullMQ worker in a separate terminal

```powershell
cd D:\Assesment\todo-express5-backend
npm run worker
```

The worker requires the same MongoDB and Redis configuration as the API. Run one or more worker processes according to deployment capacity; each process starts with concurrency 5.

### 4. Configure and run the React client

```powershell
cd D:\Assesment\todo-react-frontend
npm install
npm run dev
```

The client uses `http://localhost:5000/api` by default. Override with a Vite environment variable when needed:

```dotenv
VITE_API_BASE_URL=http://localhost:5000/api
```

The frontend does not currently have a committed `.env.example`; `VITE_API_BASE_URL` is the only frontend-specific setting documented here. Never put secrets in `VITE_*` variables because they are delivered to the browser.

| Frontend variable | Purpose | Default |
| --- | --- | --- |
| `VITE_API_BASE_URL` | Backend API base URL used by Axios | `http://localhost:5000/api` |

### Environment reference

The backend's committed `.env.example` is the canonical template. Values below describe supported variables; fill credentials only in local/deployment secret storage, not in source control.

| Backend variable | Purpose | Local/default guidance |
| --- | --- | --- |
| `PORT` | Express listen port | `5000` |
| `MONGODB_URI` | MongoDB connection | `mongodb://127.0.0.1:27017/todo` |
| `REDIS_URL` | Cache and BullMQ connection | `redis://127.0.0.1:6379` |
| `FRONTEND_URL` | Allowed CORS origin(s), comma-separated | `http://localhost:5173` |
| `TASK_APP_URL` | Link target in email/ICS task events | Usually the frontend origin |
| `JWT_ACCESS_SECRET` | Access JWT signing secret | Random, at least 32 bytes |
| `JWT_REFRESH_SECRET` | Refresh JWT signing secret | Different random secret, at least 32 bytes |
| `JWT_ACCESS_EXPIRES_IN` | Access token lifetime | `15m` |
| `JWT_REFRESH_EXPIRES_IN` | Refresh token lifetime | `7d` |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` | Email provider | Optional for local testing; required for real email |
| `WHATSAPP_PROVIDER` | WhatsApp provider selector | `meta` (default) or `twilio` |
| `WHATSAPP_API_TOKEN`, `WHATSAPP_PHONE_ID`, `WHATSAPP_API_VERSION`, `WHATSAPP_TEMPLATE_NAME`, `WHATSAPP_TEMPLATE_LANGUAGE`, `WHATSAPP_FROM_NUMBER` | Meta Cloud/Twilio WhatsApp integration | Configure credentials and approved template values for selected provider |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `WHATSAPP_TEMPLATE_SID` | Twilio-only values | Required as applicable when provider is `twilio` |
| `LEGACY_MIGRATION_OWNER_NAME`, `LEGACY_MIGRATION_OWNER_EMAIL`, `LEGACY_MIGRATION_OWNER_PASSWORD` | Optional owner details for legacy task migration | Only needed when creating a new migration owner |

For frontend values, see the Vite snippet above. `VITE_API_BASE_URL` is public configuration, never a secret.

### Available commands

| Project | Command | Purpose |
| --- | --- | --- |
| Backend | `npm run dev` | Watch/restart Express API |
| Backend | `npm start` | Start Express API |
| Backend | `npm run worker` | Start BullMQ reminder worker |
| Backend | `npm run migrate:legacy-tasks` | Run the legacy-task workspace migration |
| Frontend | `npm run dev` | Start Vite development server |
| Frontend | `npm run build` | Create production frontend bundle |
| Frontend | `npm run lint` | Run ESLint |
| Frontend | `npm run preview` | Preview the production bundle |

## Manual QA and verification

| Area | Verification | Expected result |
| --- | --- | --- |
| Workspace isolation | Sign in as members of separate workspaces; create tasks and query `/api/tasks` and `/api/tasks/weekly-summary` with each workspace header. | Each response contains only data for the selected tenant; workspace changes update the client header and data view. |
| RBAC — Viewer | Attempt `POST`, `PUT`, `PATCH`, and `DELETE /api/tasks` operations as `VIEWER`; try `GET /api/tasks/:id`. | Writes return `403`; the individual detail route is not granted to Viewer. List/summary/upcoming/ICS read routes remain allowed. |
| RBAC — Member delete | As `MEMBER`, delete a task created by another member and one created by self. | Other-member deletion returns `403`; own-task deletion succeeds. |
| RBAC — workspace controls | As Admin, change a member role or delete workspace; as Owner, invite/change role/remove non-owner. | Admin cannot change roles or delete workspace; Owner can perform the listed actions; owner membership cannot be changed/removed. |
| Cache miss and hit | Request `/api/tasks` or the same `/api/tasks/weekly-summary?timezone=Asia/Kolkata` twice without mutating data. | First request reports `X-Cache: MISS`; a subsequent matching cached request reports `HIT` within the 300-second TTL. |
| Cache invalidation/fallback | Mutate a task in one workspace, then read the same list/summary; repeat while Redis is unavailable. | Mutation invalidates that workspace's task keys. Redis failure logs a warning, returns data from MongoDB and reports a cache miss. |
| Week boundaries/timezone | Create tasks near Sunday/Monday midnight in a chosen IANA timezone; request summary with that timezone. | MongoDB groups dates into Monday-start weeks in the requested timezone, returning week start/end and correct counts. |
| Zod validation | Submit missing/invalid task title, datetime, priority, notification phone, or workspace member role. | Invalid bodies return `400` and field-specific `{ field, message }` issue entries. |
| Scheduled reminders | Configure worker, Redis, SMTP and/or WhatsApp; use an in-progress task whose due time is later than the selected lead time; verify scheduled job/logs and delivery. | Queue job is scheduled at due time minus lead time; delivery attempts are recorded per channel; a configured 15-minute preference yields a `T-15m` job. |
| Retry behavior | Force a provider failure and inspect worker logs/job state. | The job retries up to three attempts with exponential backoff from 5 seconds; successful channels are not resent when already marked sent. |
| ICS alarms | Download `/api/tasks/:id/alarm.ics` with valid auth; inspect `.ics` or email attachment. | Calendar event contains `VALARM` with configured lead-time trigger. External calendar subscription still requires a feed-auth mechanism beyond the current bearer-protected URL. |
| Browser alarm | Keep the signed-in client open with `mobileAlarm` enabled and a task within lead time; verify sound permission, vibration support, snooze, dismiss, complete. | The banner appears and supported browser APIs are invoked. Background delivery is not guaranteed if the browser suspends the page. |

## Architecture diagram maintenance

The diagram source is [`docs/architecture.mmd`](./docs/architecture.mmd). With Node/npm available, regenerate the vector and high-resolution raster exports from this repository root:

```powershell
npx -y @mermaid-js/mermaid-cli -i docs/architecture.mmd -o docs/architecture.svg -b white
npx -y @mermaid-js/mermaid-cli -i docs/architecture.mmd -o docs/architecture.png --size 3111 -s 2 -b white
```

The Mermaid CLI version used for this export does not recognize the `-w` option; `--size 3111` with scale `2` produces an approximately 2,400-pixel-wide PNG for this diagram's tall aspect ratio.

## License and project links

Add the project license and replace the demo, walkthrough, and design placeholders at the top of this README before publishing or sharing a client-facing portfolio.
