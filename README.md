# Pre-Market Stock Advisor

A daily AI-powered tool that analyzes a list of stocks before the market opens and ranks them with buy/hold/sell recommendations. Upload a stock file, let the AI agents run, and review the ranked results on the dashboard.

---

## What's Inside

| Service | What it does | Port |
|---|---|---|
| **Frontend** | Next.js web dashboard | `3300` |
| **Backend** | FastAPI AI pipeline + REST API | `3301` |
| **PostgreSQL** | Stores all run results | internal |
| **Redis** | Real-time progress events (optional) | internal |

---

## Prerequisites

Make sure you have these installed before starting:

- **Python 3.11+** — [python.org](https://www.python.org/downloads/)
- **Node.js 20+** — [nodejs.org](https://nodejs.org/)
- **PostgreSQL 15** — [postgresql.org](https://www.postgresql.org/download/) (or use Docker)
- **Docker + Docker Compose** — only needed if you want to run everything in containers

---

## Option A — Run with Docker (easiest)

This starts all four services (frontend, backend, PostgreSQL, Redis) with one command.

### 1. Copy the environment file

```bash
cp .env.example .env   # if .env.example exists, otherwise .env is already there
```

Open `.env` and fill in at least one AI provider key:

```
GROQ_API_KEY=your_key_here        # free tier — recommended for testing
GOOGLE_API_KEY=your_key_here      # free tier — Gemini Flash
ANTHROPIC_API_KEY=your_key_here   # paid
OPENAI_API_KEY=your_key_here      # paid
```

You only need **one** key to get started. Groq is free and works great for testing.

### 2. Start everything

```bash
docker compose up --build
```

Wait for the log line that says `Application startup complete` from the backend container.

### 3. Open the app

- Dashboard: http://localhost:3300
- API docs: http://localhost:3301/docs

### Stop everything

```bash
docker compose down
```

To also delete the database volume:

```bash
docker compose down -v
```

---

## Option B — Run Locally (without Docker)

You need PostgreSQL running on your machine. Redis is optional — the app works without it.

### 1. Set up the environment file

```bash
# Copy and edit the env file
cp .env .env.local   # or just edit .env directly
```

Set your database URL and at least one AI key:

```
DATABASE_URL=postgresql+asyncpg://youruser:yourpassword@localhost:5432/premarket_advisor
GROQ_API_KEY=your_key_here
```

### 2. Create the database

```bash
psql -U youruser -c "CREATE DATABASE premarket_advisor;"
```

### 3. Install backend dependencies

```bash
# From the project root
python -m venv .venv
source .venv/bin/activate        # on Windows: .venv\Scripts\activate
pip install -r requirements.txt
```

### 4. Run database migrations

```bash
alembic upgrade head
```

### 5. Start the backend

```bash
uvicorn backend.main:app --host 0.0.0.0 --port 3301 --reload
```

The API is now running at http://localhost:3301. You can explore all endpoints at http://localhost:3301/docs.

### 6. Install frontend dependencies

Open a new terminal tab:

```bash
cd frontend
npm install
```

### 7. Set the API URL for the frontend

The file `frontend/.env.local` should already contain:

```
NEXT_PUBLIC_API_URL=http://localhost:3301
```

If it doesn't exist, create it with that line.

### 8. Start the frontend

```bash
cd frontend
npm run dev
```

The dashboard is now running at http://localhost:3300.

---

## Using the App

### Step 1 — Configure a model

Go to http://localhost:3300/models and add at least one AI model.

- Click **+ Add Model**
- Pick a preset from the **Free** tab (e.g., "LLaMA 3.3 70B via Groq")
- Enter your API key if prompted
- Click **Add Model**

The model row will show a green **Ready** badge once the key is valid.

### Step 2 — Run an analysis

Go to http://localhost:3300 (home page).

- Drag and drop a stock file onto the upload area (JSON or YAML)
- Click **Run Analysis**
- Watch the live progress bar as agents analyze each stock

Sample stock files are in `input_examples/`:
- `sample_stocks.json`
- `sample_stocks.yaml`

### Step 3 — Review results

When the run completes you are taken to the results page showing:

- Ranked table of all stocks with scores and recommendations
- Top 3 picks highlighted
- Click any stock row to see the per-agent breakdown

---

## Where API Keys Are Stored

API keys are written to the `.env` file on disk only — they are never stored in the database. The app reads them from the environment at startup and when you add a model through the UI.

---

## Project Structure (quick reference)

```
preMarket-Agents/
├── .env                    ← your API keys and config (never commit this)
├── agents_config.yaml      ← AI model configuration (edit to add/change models)
├── prompts/                ← AI agent prompt files (editable without restart)
├── input_examples/         ← sample stock files to test with
├── backend/                ← FastAPI app
│   ├── main.py
│   ├── agents/             ← 5 AI analysis agents
│   ├── api/routes/         ← REST endpoints
│   ├── providers/          ← Anthropic / OpenAI / Google / Groq adapters
│   └── database/           ← SQLAlchemy models + Alembic migrations
├── frontend/               ← Next.js 14 dashboard
│   ├── app/                ← pages (home, results, compare, models)
│   └── components/         ← UI components
├── docker-compose.yml
├── Dockerfile.backend
└── Dockerfile.frontend
```

---

## Common Issues

**Backend fails with "relation does not exist"**
Run migrations: `alembic upgrade head`

**"No active model variant" error when running analysis**
Go to `/models` and activate at least one model variant using the toggle switch.

**Frontend shows "Failed to fetch"**
Make sure the backend is running and `NEXT_PUBLIC_API_URL` in `frontend/.env.local` points to the correct port (`3301`).

**Groq / Gemini key not picked up after adding via UI**
The key is written to `.env` and injected into the running process immediately — no restart needed. Click the **Ready** badge to run a live connection test.

**Docker build fails on Apple Silicon (M1/M2/M3)**
Add `platform: linux/amd64` under the backend service in `docker-compose.yml`, or build natively — the Python image supports ARM.
