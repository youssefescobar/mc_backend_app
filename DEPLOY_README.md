# Cloud Run Deployment Guide — Pending Handoff

This document is for the colleague with **Google Cloud credentials** to complete the production deployment.
The backend code is fully up to date on GitHub (`master` branch). Cloud Run is still running **old code** — it needs one redeploy to pick up all the recent fixes.

---

## What Changed (and Why It Matters)

The following backend fixes are committed to `master` but **not yet live on Cloud Run**:

| File | What changed | Impact if NOT deployed |
|---|---|---|
| `models/message_model.js` | Added `'meetpoint'` to the message `type` enum | Meetpoint chat messages are silently rejected by Mongoose → never appear in group chat |
| `sockets/socket_manager.js` | Added `socket.join(\`user_${userId}\`)` in `register-user` handler | `notification_refresh` socket events are emitted to `user_<id>` room, but sockets never join it → pilgrims never get real-time notification badge updates |
| `controllers/group_controller.js` | Meetpoint chat message creation isolated in its own `try/catch` | A failure in chat message creation was rolling back the entire response — pilgrims saw an error even though the meetpoint was set |

---

## Prerequisites

1. **Google Cloud SDK installed** — confirm with:
   ```
   gcloud version
   ```
   If not installed: https://cloud.google.com/sdk/docs/install

2. **Authenticated** with the correct account:
   ```
   gcloud auth login
   ```
   Then set the project:
   ```
   gcloud config set project munawware-care
   ```

3. **`.env` file present** at `mc_backend_app/.env` — the redeploy script reads it to inject environment variables into Cloud Run. It should already be there; do not commit it to git.

---

## How to Redeploy (One Command)

Open **PowerShell** in the `mc_backend_app/` folder and run:

```powershell
powershell -ExecutionPolicy Bypass -File redeploy_cloudrun.ps1
```

That script automatically:
1. Reads `.env` and converts it to Cloud Run's YAML format
2. Deletes the existing service (fresh deploy avoids stale config)
3. Deploys from source using `gcloud run deploy`
4. Cleans up the temp YAML file

**Expected output:**
```
[1/3] Generated env file: _cloudrun_env.yaml (N variables)
[2/3] Deleting existing service 'mcbackendapp'...
[3/3] Deploying 'mcbackendapp' from source...
...
Done. Service URL: https://mcbackendapp-199324116788.europe-west8.run.app
```

> The deploy takes **5–15 minutes** because it builds the container from source.

---

## Cloud Run Service Details

| Key | Value |
|---|---|
| Service name | `mcbackendapp` |
| Project | `munawware-care` |
| Region | `europe-west8` (Milan) |
| URL | `https://mcbackendapp-199324116788.europe-west8.run.app` |
| Min instances | 1 (always warm — required for Socket.io) |
| Max instances | 1 (session-affinity for persistent socket connections) |

---

## Verify the Deploy Worked

After deployment completes, test these three things:

### 1. Health check
```
curl https://mcbackendapp-199324116788.europe-west8.run.app/
```
Should return a JSON response (not a 502/503).

### 2. Meetpoint chat message
- Log in as a moderator in the app
- Set a meetpoint for a group
- Open the group chat as a pilgrim
- **Expected:** A red urgent meetpoint card appears in the chat

### 3. Notification badge
- With a pilgrim logged in and app open, set a meetpoint as a moderator
- **Expected:** The pilgrim's notification bell badge increments in real time (without refreshing)

---

## If Something Goes Wrong

**Check Cloud Run logs:**
```powershell
gcloud run services logs read mcbackendapp --region europe-west8 --project munawware-care --limit 100
```

**Re-run the script** — it's idempotent (delete + fresh deploy), so running it again is safe.

**Test locally first:**
```
cd mc_backend_app
npm run dev
```
Local server runs on `http://localhost:5000`. To point the Flutter app at it temporarily, change `baseUrl` in `Flutter_Munawwara/lib/core/services/api_service.dart` to your local IP (`http://192.168.x.x:5000/api`).

---

## Flutter App

No Flutter changes are needed for the redeploy — the app already points to the Cloud Run URL:
```dart
// Flutter_Munawwara/lib/core/services/api_service.dart
static const String baseUrl =
    'https://mcbackendapp-199324116788.europe-west8.run.app/api';
```

All Flutter fixes are already built and pushed (`main` branch). Just rebuild/reinstall the app after the Cloud Run deployment.
