# Innospace Bookings

A small **Next.js microservice** that replaces Formspark for the Innospace Tirana
booking form. It:

1. **Receives** booking submissions (`POST /api/bookings`).
2. **Stores** them in a **SQLite** database (`data/bookings.db`).
3. **Shows a dashboard** (`/dashboard`, login-protected) to browse, search, and
   confirm/cancel bookings.
4. **Emails** the customer a branded confirm/cancel notice (via
   [Resend](https://resend.com)) when you action a booking.

- **Repo:** <https://github.com/IgliHoxha/innospace-bookings>
- **Stack:** Next.js 15 (App Router) · React 19 · TypeScript · better-sqlite3 · Resend
- **Hosting:** Fly.io (Docker) behind `booking.innospacetirana.com`

---

## Quick start (local)

```bash
cp .env.example .env          # fill in values (see below)
npm install
npm run dev                   # http://localhost:4000
```

Or with Docker (matches production):

```bash
docker compose up -d --build  # http://localhost:4000
```

- Dashboard: <http://localhost:4000/dashboard>
- API: `POST http://localhost:4000/api/bookings`

### Scripts

| Command | Does |
| --- | --- |
| `npm run dev` / `start` | Dev / production server on port 4000. |
| `npm run build` | Production build. |
| `npm run lint` / `format` | ESLint / Prettier. |
| `npm run typecheck` | TypeScript check. |
| `make fmt` / `make check` | Format+fix / CI-style verify. |

---

## Environment variables (`.env`)

| Var | Purpose |
| --- | --- |
| `RESEND_API_KEY` | Resend API key. If empty, emails are skipped (bookings still stored). |
| `EMAIL_FROM` | Verified Resend sender (e.g. `bookings@innospacetirana.com`). |
| `DASHBOARD_USERNAME` / `DASHBOARD_PASSWORD` | Seed the first admin user into the DB on a fresh database. |
| `AUTH_SECRET` | Long random string signing the login cookie (`openssl rand -hex 32`). |
| `ALLOWED_ORIGINS` | Comma-separated origins allowed to POST. `*` allows any. |
| `DATA_FILE` | SQLite path. Defaults to `./data/bookings.db`. |
| `PRICE_*` | Pricing packages surfaced in confirmation emails. |

---

## Data & auth

- **SQLite** (`better-sqlite3`) — one file on a persistent disk, WAL mode.
  `bookings` table plus a `users` table.
- **Login** is verified against the `users` table (scrypt-hashed passwords). The
  first admin is **seeded once** from `DASHBOARD_USERNAME`/`DASHBOARD_PASSWORD`;
  after that the database is the source of truth.
- The DB must live on a **persistent disk** (Fly volume / VPS disk), not a
  serverless filesystem.

---

## API

- `POST /api/bookings` — public; the website posts a booking here (CORS-limited
  to `ALLOWED_ORIGINS`). Accepts the structured payload or the legacy
  `{ message, _email }` shape. `201` on success.
- `GET /api/bookings` — protected; returns all bookings, newest first.
- `PATCH /api/bookings/:id` — protected; `{ status, emailBody? }`. On
  confirm/cancel, emails the customer (uses `emailBody` if provided).
- `POST` / `DELETE /api/login` — sign in (sets cookie) / sign out.

---

## Email templates

`src/lib/templates.ts` holds the confirm/cancel bodies (shared by the mailer and
the dashboard preview, so the preview matches what's sent). Each booking row in
the dashboard has an editable Confirm/Cancel email; your edits are sent verbatim.

---

## Deploy (Fly.io)

Config in [`fly.toml`](fly.toml) — Docker image, a volume at `/app/data`, env
vars. Secrets via `fly secrets set`.

```bash
fly launch --copy-config --no-deploy   # first time only
fly volumes create bookings_data --region fra --size 1
fly secrets set RESEND_API_KEY=re_xxx DASHBOARD_PASSWORD='…' AUTH_SECRET="$(openssl rand -hex 32)"
fly deploy
fly certs add booking.innospacetirana.com
```

Then a Cloudflare `CNAME booking → <app>.fly.dev`. Pushing to `master` also
auto-deploys via GitHub Actions ([.github/workflows/fly-deploy.yml](.github/workflows/fly-deploy.yml)).

> Any Docker host with a persistent volume works too: `docker compose up -d --build`.

---

## Website integration

`_pages/booking.html` posts to `https://booking.innospacetirana.com/api/bookings`
and `assets/js/main.js` sends the structured fields. Rebuild/redeploy the Jekyll
site after changing them.

---

## Backups

The whole DB is one file. Copy it off the volume:

```bash
docker compose cp bookings:/app/data/bookings.db ./backup.db
# or on Fly:  fly ssh sftp get /app/data/bookings.db ./backup.db
```

---

## Project layout

```
src/
  app/
    api/bookings/route.ts        POST (create), GET (list)
    api/bookings/[id]/route.ts   PATCH (status + customer email)
    api/login/route.ts           login / logout
    dashboard/                   protected dashboard
    login/                       login page
  lib/
    db.ts        SQLite storage + users/auth
    email.ts     Resend customer emails
    templates.ts email bodies + pricing (shared with the UI)
    auth.ts      cookie session
    cors.ts · types.ts
data/bookings.db                 the database (git-ignored)
Dockerfile · docker-compose.yml · fly.toml
```
