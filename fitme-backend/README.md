# fitme-backend

Node.js/Express REST API for FitMe. Auth, workouts, meal plans, nutrition, and AI coaching powered by Google Gemini.

## Stack

Node.js, Express, MongoDB, Mongoose, JWT, Google Gemini

## Setup

```bash
npm install
cp env.example .env
npm run dev
```

Server runs at `http://localhost:5000`

## Environment Variables

```env
PORT=5000
NODE_ENV=development
MONGODB_URI=your-mongodb-uri
JWT_SECRET=your-jwt-secret
JWT_EXPIRE=7d
CLIENT_URL=http://localhost:5173
GEMINI_API_KEY=your-gemini-api-key
```

> `GEMINI_API_KEY` is optional. Falls back to demo mode if not set.
