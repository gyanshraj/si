# VAH Health 🏃‍♂️

**Stake-to-Earn Student Health & Accountability Platform**

VAH Health lets students put real money (an escrow deposit) on the line and earn refunds by consistently logging verified daily health activity — steps, workouts, sleep, nutrition, and more. The 15-column daily matrix tracker keeps students accountable through transparent progress visibility.

---

## Features

- 🔐 **User Auth** — Register / Login / Demo account (no sign-up required)
- 💰 **Stake-to-Earn** — Escrow deposit system; earn refunds by completing daily goals
- 📊 **15-Column Daily Matrix** — Steps, calories, weight, water, food, protein, carbs, fat, workout, sleep, HR, mood, sedentary hours, goal %, refund earned
- 📱 **Responsive UI** — Works on desktop and mobile
- 🗄️ **SQLite backend** — Zero-dependency, file-based persistence via Node's built-in `node:sqlite`
- 🔄 **Automatic state sync** — App state saved to server on every change
- 🚀 **One-command deploy** — Render (backend) + Netlify (frontend)

---

## Tech Stack

| Layer     | Technology                                          |
|-----------|-----------------------------------------------------|
| Frontend  | Vanilla HTML + CSS + JavaScript (no framework)      |
| Backend   | Node.js `http` module (no Express)                  |
| Database  | SQLite via Node's built-in `node:sqlite`            |
| Auth      | SHA-256 password hash + in-memory session tokens    |
| Hosting   | Render (API) + Netlify (static frontend)            |

**Minimum Node.js version: `22.5.0`** (required for `node:sqlite`)

---

## Folder Structure

```
si/
├── README.md            ← You are here
├── DEPLOYMENT.md        ← Render + Netlify deployment guide
├── .gitignore
├── package.json
├── render.yaml          ← Render Blueprint config
├── netlify.toml         ← Netlify config
│
├── server/
│   └── server.js        ← Node HTTP server + REST API + SQLite
│
├── public/              ← Static files served by the Node server
│   ├── main.html        ← Single-page app shell
│   ├── style.css        ← All styles
│   ├── app.js           ← All client-side logic
│   └── api-config.js    ← API base URL override (edit for production)
│
└── data/                ← Runtime data (gitignored)
    └── .gitkeep
```

---

## API Endpoints

| Method | Path                   | Auth | Description                        |
|--------|------------------------|------|------------------------------------|
| POST   | `/api/auth/register`   | —    | Create a new account               |
| POST   | `/api/auth/login`      | —    | Login, returns session token       |
| POST   | `/api/demo`            | —    | Login as demo user (Alex Patel)    |
| GET    | `/api/state`           | ✅   | Fetch saved app state              |
| PUT    | `/api/state`           | ✅   | Overwrite saved app state          |

Authenticated endpoints require an `Authorization: Bearer <token>` header.

---

## Environment Variables

| Variable        | Default                        | Description                             |
|-----------------|--------------------------------|-----------------------------------------|
| `PORT`          | `3000`                         | Port the HTTP server listens on         |
| `DATABASE_FILE` | `data/vah-health.db`           | Absolute path to the SQLite database    |

---

## Local / Offline Testing Guide

This guide lets you run and test the entire application **without any internet connection or cloud accounts**.

### Prerequisites

1. **Node.js ≥ 22.5.0** — check with:
   ```bash
   node --version
   ```
   If not installed, download from [nodejs.org](https://nodejs.org) (LTS ≥ 22).

2. **Clone the repository** (if you haven't already):
   ```bash
   git clone https://github.com/<your-org>/si.git
   cd si
   ```

---

### Step 1 — Install Dependencies

```bash
npm install
```

> This project has **no third-party runtime dependencies** — `npm install` only registers the project manifest. The SQLite driver is built into Node ≥ 22.

---

### Step 2 — Start the Server

```bash
npm start
```

Expected output:
```
VAH Health is running at http://localhost:3000
```

The server will automatically:
- Create `data/vah-health.db` on first run
- Migrate any legacy `data/data.json` users (if present)

> **Tip:** Keep this terminal open. Open a second terminal for the curl commands below.

---

### Step 3 — Open the App in a Browser

Navigate to:
```
http://localhost:3000
```

You should see the VAH Health landing page with **Login** / **Get Started** buttons.

---

### Step 4 — Test via Browser (Happy Path)

1. Click **Get Started** → fill in name, email, password → **Register**
2. You'll be taken to the dashboard
3. Click **Add Today's Log** → fill in any health data → **Save**
4. Refresh the page — your data should persist (saved to SQLite via the API)
5. Click **Logout**, then **Login** with the same credentials
6. Confirm your logs are still there

---

### Step 5 — Test via curl (API Testing)

Open a **second terminal**. Run these commands to test each endpoint directly.

#### 5a. Register a new user
```bash
curl -s -X POST http://localhost:3000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"name":"Test User","email":"test@example.com","password":"password123"}' | jq .
```

Expected response:
```json
{
  "token": "<64-char hex token>",
  "user": { "name": "Test User (Student)", "email": "test@example.com" },
  "state": null
}
```

#### 5b. Login with existing credentials
```bash
curl -s -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"password123"}' | jq .
```

Save the token for the next steps:
```bash
TOKEN="<paste token here>"
```

#### 5c. Start a demo session (no registration needed)
```bash
curl -s -X POST http://localhost:3000/api/demo | jq .
```

#### 5d. Read saved state (authenticated)
```bash
curl -s http://localhost:3000/api/state \
  -H "Authorization: Bearer $TOKEN" | jq .
```

#### 5e. Save app state
```bash
curl -s -X PUT http://localhost:3000/api/state \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"state":{"logs":[],"escrowAmount":2000}}' | jq .
```

#### 5f. Verify state was persisted
```bash
curl -s http://localhost:3000/api/state \
  -H "Authorization: Bearer $TOKEN" | jq .
```

---

### Step 6 — Test Static File Serving

```bash
# Home page → 200
curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/

# CSS file → 200
curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/style.css

# JS file → 200
curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/app.js

# Non-existent file → 404
curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/nonexistent.txt
```

---

### Step 7 — Test Validation & Error Cases

```bash
# Missing password → 400
curl -s -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com"}' | jq .

# Wrong password → 401
curl -s -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"wrongpass"}' | jq .

# Duplicate registration → 409
curl -s -X POST http://localhost:3000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"name":"Test User","email":"test@example.com","password":"password123"}' | jq .

# No auth token → 401
curl -s http://localhost:3000/api/state | jq .
```

---

### Step 8 — Inspect the Database (Optional)

If you have `sqlite3` installed (`brew install sqlite3` on macOS):

```bash
sqlite3 data/vah-health.db

# Inside sqlite3 prompt:
.tables
SELECT email, name FROM users;
SELECT email, length(state_json) AS state_size FROM users;
.quit
```

---

### Stopping the Server

Press **Ctrl+C** in the server terminal.

---

## Production Deployment

See [DEPLOYMENT.md](DEPLOYMENT.md) for the full guide.

**Quick summary:**
1. Push to GitHub
2. Create a **Render Blueprint** from `render.yaml` → copy your backend URL
3. Edit `public/api-config.js`:
   ```js
   window.VAH_API_BASE = 'https://your-render-url.onrender.com/api';
   ```
4. Deploy the repo to **Netlify** — it publishes the `public/` folder automatically

---

## Contributing

1. Fork the repo
2. Create a feature branch: `git checkout -b feature/my-feature`
3. Commit: `git commit -m 'feat: add my feature'`
4. Push: `git push origin feature/my-feature`
5. Open a Pull Request

---

## License

MIT
