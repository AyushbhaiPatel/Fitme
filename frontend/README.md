# Frontend (React + Vite)

React client for FitMe. All AI features (workouts, meal plans, coaching) are handled server-side by the Express backend.

## Setup

```bash
npm install
cp env.example .env
# Set VITE_API_URL to your Express backend, e.g. http://localhost:5000/api
npm run dev
```

Default dev server: http://localhost:5173

## Environment

| Variable | Description | Default |
|----------|-------------|---------|
| `VITE_API_URL` | Express backend URL | http://localhost:5000/api |

No Gemini API key or FastAPI URL needed on the frontend.

## Scripts

```bash
npm run dev       # start Vite dev server
npm run build     # production build
npm run preview   # preview production build locally
npm run lint      # run eslint
```

## Architecture

- `src/services/api.js` — single axios instance pointing to Express
- `src/services/mealPlanAPI.js` — meal plan API calls via Express
- `src/services/mealPlanPersistence.js` — local storage persistence for meal plans
- Auth tokens stored in localStorage (`fitme_token`, `fitme_refresh_token`)
- `AuthContext` manages auth state and token refresh
