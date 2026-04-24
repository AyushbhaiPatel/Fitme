# FitMe

Full-stack fitness app: React (Vite) frontend, Node/Express API for auth, workouts, AI coaching, and meal planning — all powered by Google Gemini server-side.

## Layout

- `backend/` — Express API (auth, workouts, AI coach, meal plans, nutrition)
- `frontend/` — React client (Vite)
- `docker-compose.yml` — optional all-in-one run

**Needs:** Node 16+, MongoDB.

## Setup

```bash
git clone <your-repo-url> && cd fitme

cd backend && npm install
cd ../frontend && npm install

cp backend/env.example backend/.env
cp frontend/env.example frontend/.env
```

Fill `.env` files — the backend needs `MONGODB_URI`, `JWT_SECRET`, and `GEMINI_API_KEY`. The frontend only needs `VITE_API_URL`.

## Run (dev)

```bash
# terminal 1 — API :5000
cd backend && npm run dev

# terminal 2 — UI :5173
cd frontend && npm run dev
```

Or: `docker-compose up --build`

If Gemini isn't configured or is rate-limited, the app falls back to demo workout plans and estimated nutrition data. Set `CLIENT_URL` on the backend if the UI isn't on `http://localhost:5173`.
