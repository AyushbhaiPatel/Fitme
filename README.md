# Fitme

Full-stack fitness app: React (Vite) UI, Node/Express API for auth and workouts, FastAPI for AI meal planning and coaching.

## Layout

- `backend/` — Express API  
- `frontend/` — React client  
- `fastapi_backend/` — FastAPI  
- `docker-compose.yml` — optional all-in-one run  

**Needs:** Node 16+, Python 3.8+, MongoDB.

## Setup

```bash
git clone <your-repo-url> && cd fitme

cd backend && npm install
cd ../frontend && npm install
cd ../fastapi_backend && pip install -r requirements.txt

cp backend/env.example backend/.env
cp frontend/env.example frontend/.env
cp fastapi_backend/env.example fastapi_backend/.env
```

Fill `.env` files using the variables in each `env.example` (DB URI, JWT secrets, API URLs, `VITE_GEMINI_API_KEY` / `GEMINI_API_KEY` where used).

## Run (dev)

```bash
# terminal 1 — API :5000
cd backend && npm run dev

# terminal 2 — FastAPI :8000
cd fastapi_backend && uvicorn main:app --host 0.0.0.0 --port 8000 --reload

# terminal 3 — UI :5173
cd frontend && npm run dev
```

Or: `docker-compose up --build`

If Gemini isn’t configured or is rate-limited, the app may show a demo workout; set `CLIENT_URL` on the backend if the UI isn’t on `http://localhost:5173`.
