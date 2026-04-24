# FitMe Backend (Express)

Node.js/Express API for authentication, users, workouts, AI coaching, meal planning, and nutrition — all AI features powered by Google Gemini server-side.

## Tech Stack

- Node.js & Express.js
- MongoDB & Mongoose
- JWT Authentication
- Google Gemini AI (`@google/generative-ai`)
- express-rate-limit for AI endpoint throttling

## Quick Start

```bash
npm install
cp env.example .env
# Edit .env with your MONGODB_URI, JWT_SECRET, GEMINI_API_KEY
npm run dev
```

Server: `http://localhost:5000`

## API Endpoints

### Authentication
- `POST /api/auth/register`
- `POST /api/auth/login`
- `POST /api/auth/refresh`
- `GET  /api/auth/me`
- `PUT  /api/auth/change-password`
- `POST /api/auth/logout`
- `GET  /api/auth/verify`
- `POST /api/auth/send-otp`
- `POST /api/auth/verify-otp`
- `POST /api/auth/resend-otp`
- `POST /api/auth/forgot-password/request`
- `POST /api/auth/forgot-password/confirm`

### User Management
- `PUT    /api/user/profile`
- `PUT    /api/user/profile-photo`
- `DELETE /api/user/profile-photo`
- `GET    /api/user/stats`
- `PUT    /api/user/email`
- `GET    /api/user/preferences`
- `DELETE /api/user/account`

### Workouts
- `POST   /api/workouts/generate` — AI workout plan generation
- `POST   /api/workouts/save`
- `GET    /api/workouts/saved`
- `GET    /api/workouts/:planId`
- `DELETE /api/workouts/:planId`
- `PUT    /api/workouts/:planId/activate`
- `POST   /api/workouts/custom`
- `POST   /api/workouts/complete`
- `GET    /api/workouts/statistics`
- `GET    /api/workouts/weekly-summary`

### AI Coach
- `POST /api/aicoach/chat` — AI chat (10 req/min)
- `GET  /api/aicoach/suggestions` — personalized suggestions
- `GET  /api/aicoach/health` — service health check

### Meal Plans
- `POST   /api/mealplan/generate` — AI meal plan generation (5 req/min)
- `GET    /api/mealplan` — list user meal plans
- `GET    /api/mealplan/:planId`
- `DELETE /api/mealplan/:planId`
- `POST   /api/mealplan/regenerate/:planId` — regenerate (3 req/min)
- `POST   /api/mealplan/nutrition/analyze` — nutrition analysis (30 req/min)

### Health
- `GET /api/health`

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | Server port | 5000 |
| `NODE_ENV` | Environment | development |
| `MONGODB_URI` | MongoDB connection string | required |
| `JWT_SECRET` | JWT signing secret | required |
| `JWT_EXPIRE` | JWT expiration | 7d |
| `CLIENT_URL` | Frontend URL for CORS | http://localhost:5173 |
| `GEMINI_API_KEY` | Google Gemini API key | required for AI features |
