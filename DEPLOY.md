# Deploying NetXaura

Frontend is on Netlify: **https://gleeful-macaron-f159ee.netlify.app**
This guide deploys the **backend** to Railway and points the frontend at it.

> The backend is **single-worker by design** — pending-transfer and WebSocket
> state live in process memory (see README "Known limitations"). Keep it at
> **1 replica**. `backend/railway.json` pins `numReplicas: 1`.

## 1. Deploy the backend to Railway

1. Push this repo to GitHub (already remote: `karthiik1/netXaura`).
2. In Railway: **New Project → Deploy from GitHub repo →** pick `netXaura`.
3. Open the service **Settings → Source** and set **Root Directory = `backend`**.
   Railway then builds `backend/Dockerfile` with `backend/` as the build
   context and reads `backend/railway.json`.
4. Add the environment variables below (**Variables** tab).
5. Under **Settings → Networking**, click **Generate Domain** to get a public
   HTTPS URL, e.g. `https://netxaura-production.up.railway.app`.

### Required environment variables

| Variable | Value | Notes |
|---|---|---|
| `CORS_ORIGINS` | `https://gleeful-macaron-f159ee.netlify.app` | Must match the Netlify origin exactly (no trailing slash). Add `,http://localhost:5173` if you also want local dev to hit prod. |
| `DATABASE_URL` | `sqlite+aiosqlite:///./preview.db` | Zero-setup default (see persistence note). |

Railway injects `PORT` automatically; the Dockerfile binds it. The other
knobs (`TRANSFER_TTL_SECONDS`, `WORKSPACE_TTL_HOURS`, WS rate limits, …) fall
back to the defaults in `app/config.py` — override only if needed.

### Database persistence (pick one)

- **Ephemeral SQLite (default).** Simplest. Data resets on every redeploy/restart.
  Fine for a demo — workspaces auto-expire in 2h anyway.
- **Persistent SQLite.** Add a **Volume** mounted at `/app` (or a subdir) and set
  `DATABASE_URL=sqlite+aiosqlite:////data/preview.db` to point at the mount.
- **Managed MySQL.** Add Railway's **MySQL** service, then set
  `DATABASE_URL=mysql+asyncmy://<user>:<pass>@<host>:<port>/<db>` from its
  connection variables. The app + migrations already support MySQL natively.

The container runs `alembic upgrade head` on boot, so the schema is created
automatically whichever DB you choose. Healthcheck path is `/health`.

## 2. Point the Netlify frontend at the backend

The current Netlify build uses the default `VITE_API_URL=http://localhost:8000`,
so the live site tries to reach a backend on *the visitor's own machine*. Fix it:

1. Netlify → your site → **Site configuration → Environment variables**, add:
   - `VITE_API_URL` = `https://<your-railway-domain>`
   - `VITE_WS_URL`  = `wss://<your-railway-domain>`  ← `wss`, not `ws` (HTTPS page)
2. **Trigger a redeploy** (Deploys → Trigger deploy → Clear cache and deploy).
   Vite env vars are baked in at build time, so a rebuild is required.

## 3. Verify

- `curl https://<your-railway-domain>/health` → `{"status":"ok"}`
- Open the Netlify site in two browser tabs, create a workspace in one, join
  with the code in the other, and send a tab. Check the browser console has no
  CORS or mixed-content (ws:// blocked) errors.
