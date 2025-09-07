# FitMe

Full-stack AI fitness app. Workout plans, meal planning, nutrition tracking, and an AI coach powered by Google Gemini.

## Setup

```bash
git clone <your-repo-url> && cd fitme

cd fitme-backend && npm install
cd ../fitme-frontend && npm install

cp fitme-backend/env.example fitme-backend/.env
cp fitme-frontend/env.example fitme-frontend/.env
```

Fill in `fitme-backend/.env` with your `MONGODB_URI`, `JWT_SECRET`, and `GEMINI_API_KEY`.

## Run

```bash
# Terminal 1
cd fitme-backend && npm run dev

# Terminal 2
cd fitme-frontend && npm run dev
```

Or with Docker:

```bash
docker-compose up --build
```

---

Built with ❤️ by [Ayush](https://github.com/AyushbhaiPatel)
