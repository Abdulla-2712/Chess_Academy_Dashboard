# Chess Trainer — Group Management System

A full-stack web application for chess trainers to manage coaching groups, track daily sessions, and calculate earnings/payouts.

## Tech Stack

- **Backend**: Node.js + Express
- **Database**: PostgreSQL
- **Frontend**: Plain HTML/CSS/JS (mobile-first)
- **Auth**: JWT (stored in localStorage)

## Local Development

### Prerequisites

- Node.js 18+
- PostgreSQL 14+

### Setup

1. **Clone & install dependencies:**
   ```bash
   cd chess-trainer
   npm install
   ```

2. **Configure environment:**
   ```bash
   cp .env.example .env
   ```
   Edit `.env` and set your PostgreSQL connection string:
   ```
   DATABASE_URL=postgresql://user:password@localhost:5432/chess_trainer
   JWT_SECRET=pick-a-strong-random-secret
   PORT=3000
   ```

3. **Create the database:**
   ```bash
   createdb chess_trainer
   ```

4. **Run migrations & seed:**
   ```bash
   npm run setup
   ```

5. **Start the server:**
   ```bash
   npm run dev
   ```

6. Open http://localhost:3000 in your browser.

## Deploy to Railway

### One-Click Deploy

1. Push this repo to GitHub.
2. Go to [railway.app](https://railway.app) → New Project → Deploy from GitHub repo.
3. Add a **PostgreSQL** service in the same project.
4. Railway will auto-set the `DATABASE_URL` env var. Add these additional env vars:
   - `JWT_SECRET` — pick a strong random secret
5. Railway will auto-detect the Node.js app and use `railway.json` for deployment.
6. The start command (`npm run setup && npm start`) will automatically run migrations and seed levels on first deploy.

### Manual Deploy

```bash
# Install Railway CLI
npm i -g @railway/cli

# Login
railway login

# Init project
railway init

# Add PostgreSQL
railway add

# Set env vars
railway variables set JWT_SECRET=your-secret-here

# Deploy
railway up
```

## Pricing Structure

| Level | Per Session | Total (8 sessions) |
|-------|-----------|-------------------|
| 1     | 100 EGP   | 800 EGP           |
| 2     | 115 EGP   | 920 EGP           |
| 3     | 130 EGP   | 1,040 EGP         |
| 4     | 145 EGP   | 1,160 EGP         |
| 5     | 160 EGP   | 1,280 EGP         |
| 6     | 175 EGP   | 1,400 EGP         |
| 7     | 190 EGP   | 1,520 EGP         |
| 8     | 205 EGP   | 1,640 EGP         |
| 9     | 220 EGP   | 1,760 EGP         |
| 10    | 235 EGP   | 1,880 EGP         |
| 11    | 250 EGP   | 2,000 EGP         |
| 12    | 265 EGP   | 2,120 EGP         |
| 13    | 280 EGP   | 2,240 EGP         |

## API Endpoints

### Auth
- `POST /api/auth/register` — `{ name, email, password }`
- `POST /api/auth/login` — `{ email, password }`

### Groups
- `GET /api/groups` — list all groups
- `GET /api/groups/:id` — get group with sessions
- `POST /api/groups` — create group (auto-generates 8 sessions)
- `PATCH /api/groups/:id` — update group (name, time_slot, notes)
- `DELETE /api/groups/:id` — delete group

### Sessions
- `GET /api/sessions/today` — today's sessions
- `PATCH /api/sessions/:id/status` — update status + create earnings
- `PATCH /api/sessions/:id/notes` — update notes
- `POST /api/sessions/substitute` — add substitute session

### Earnings
- `GET /api/earnings` — full breakdown (confirmed, expected, deductions)

### Levels
- `GET /api/levels` — list all 13 levels
