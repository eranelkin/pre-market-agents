# How to Run Pre-Market Advisor on a New Mac

---

## Contents

- [Before You Start — What You'll Need](#before-you-start--what-youll-need)
- [Option A — Developer Mode (Hot Reload, Fastest Iteration)](#option-a--developer-mode-hot-reload-fastest-iteration)
- [Option B — Docker (Recommended for Fresh Setup, Easiest)](#option-b--docker-recommended-for-fresh-setup-easiest)
- [Option C — Manual Setup (No Docker)](#option-c--manual-setup-no-docker)
- [Option D — Bare Minimum (No Database, Quick Test Only)](#option-d--bare-minimum-no-database-quick-test-only)
- [Test Mode](#test-mode)
- [End-to-End Pipeline Test](#end-to-end-pipeline-test)
- [Audit Log](#audit-log)
- [Troubleshooting](#troubleshooting)

---

## Before You Start — What You'll Need

This app uses AI to analyze stocks. You need **at least one AI API key** to make it work.

Get one (or more) from:

| Provider | Where to get the key | Cost |
|---|---|---|
| **Anthropic** (recommended) | https://console.anthropic.com | Paid, ~$5 to start |
| **Google Gemini** | https://aistudio.google.com/apikey | Free tier available |
| **Groq** | https://console.groq.com | Free tier available |
| OpenAI | https://platform.openai.com/api-keys | Paid |

You only need one. Start with Google Gemini or Groq if you want free.

---

## Option A — Developer Mode (Hot Reload, Fastest Iteration)

> Use this when you're actively developing and want instant feedback on every code change.
> Requires Python `.venv` and `frontend/node_modules` to already be installed.

Infrastructure (database + Redis) runs in Docker. Backend and frontend run locally with auto-reload — no rebuild needed on code changes.

### 1. Install Docker Desktop

Go to https://www.docker.com/products/docker-desktop and download the Mac version.
Launch Docker Desktop and wait until you see "Docker Desktop is running" in the menu bar.

### 2. Set Up Your API Keys

Inside the project folder, copy `.env.example` to `.env` and fill in your keys:

```
ANTHROPIC_API_KEY=paste-your-key-here
GOOGLE_API_KEY=paste-your-key-here
GROQ_API_KEY=paste-your-key-here
```

### 3. Set the Frontend API URL

```
echo "NEXT_PUBLIC_API_URL=http://localhost:3301" > frontend/.env.local
```

### 4. Start Infrastructure (once per session)

```
make dev-infra
make dev-migrate
```

Wait for "Infrastructure ready" to appear.

### 5. Start the Backend (Terminal 2)

```
make dev-backend
```

Backend is running at `http://localhost:3301`. Any change to a `.py` file in `backend/` reloads it automatically.

### 6. Start the Frontend (Terminal 3)

```
make dev-frontend
```

Frontend is running at `http://localhost:3300`. Any change to a `.tsx` or `.ts` file updates the browser instantly.

### Open the App

```
http://localhost:3300
```

### To stop:

`Ctrl + C` in terminals 2 and 3. Then:

```
make dev-infra-down
```

---

## Option B — Docker (Recommended for Fresh Setup, Easiest)

This runs everything automatically. One command starts the whole app.

### 1. Install Docker Desktop

Go to https://www.docker.com/products/docker-desktop and download the Mac version.
Open the downloaded file and drag Docker to your Applications folder.
Launch Docker Desktop and wait until you see "Docker Desktop is running" in the menu bar.

### 2. Set Up Your API Keys

Inside the project folder, find the file called `.env.example`.
Make a copy of it and rename the copy to `.env` (no .example at the end).

Open `.env` in any text editor (TextEdit works) and fill in the keys you have:

```
ANTHROPIC_API_KEY=paste-your-key-here
GOOGLE_API_KEY=paste-your-key-here
GROQ_API_KEY=paste-your-key-here
```

Leave the ones you don't have blank. Save the file.

### 3. Start the App

Open Terminal, navigate to the project folder, and run:

```
docker-compose up --build
```

The first time this runs it will download things and may take 3–5 minutes.
You'll know it's ready when you see lines mentioning "Uvicorn running" and "ready on port 3300".

### 4. Open the App

Open your browser and go to:
```
http://localhost:3300
```

### To stop the app:
Press `Ctrl + C` in the Terminal where it's running.

### To start it again next time:
```
docker-compose up
```

> Note: After changing any code, run `docker-compose up --build` to rebuild the images.

---

## Option C — Manual Setup (No Docker)

Use this if you can't install Docker or prefer not to.

### 1. Install Homebrew

Homebrew is a tool that makes installing software on Mac easy.
Open Terminal and paste this, then press Enter:

```
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

Follow the on-screen instructions. It may ask for your Mac password.

### 2. Install Python

```
brew install python@3.11
```

### 3. Install Node.js

```
brew install node
```

### 4. Install PostgreSQL (the database)

```
brew install postgresql@15
brew services start postgresql@15
```

### 5. Create the Database

```
createdb premarket_advisor
```

### 6. Add the Database URL to Your .env File

Open your `.env` file and add this line:

```
DATABASE_URL=postgresql+asyncpg://localhost/premarket_advisor
CORS_ORIGINS=http://localhost:3300
```

### 7. Set the Frontend API URL

```
echo "NEXT_PUBLIC_API_URL=http://localhost:3301" > frontend/.env.local
```

### 8. Install Python Packages

In Terminal, from the project folder:

```
pip3 install -r requirements.txt
```

### 9. Set Up the Database Tables

```
alembic upgrade head
```

### 10. Start the Backend

Open a Terminal window and run:

```
uvicorn backend.main:app --host 0.0.0.0 --port 3301 --reload
```

Keep this window open.

### 11. Install Frontend Packages

Open a **second** Terminal window, go to the frontend folder:

```
cd frontend
npm install
```

### 12. Start the Frontend

Still in the frontend folder:

```
PORT=3300 npm run dev
```

Keep this window open too.

### 13. Open the App

Open your browser and go to:
```
http://localhost:3300
```

---

## Option D — Bare Minimum (No Database, Quick Test Only)

> Not recommended for real use. Results will not be saved between sessions.

This is only useful if you just want to quickly see if the AI analysis works.

1. Complete steps 1–3 from Option C (Homebrew, Python, Node)
2. Set up your `.env` with at least one API key
3. Install Python packages: `pip3 install -r requirements.txt`
4. Start the backend with SQLite (in-memory, no Postgres needed):
   ```
   DATABASE_URL=sqlite+aiosqlite:///./test.db uvicorn backend.main:app --port 3301
   ```
5. Start the frontend as in steps 11–12 above

---

## Test Mode

Test mode is a global toggle visible in the **NavBar** on every page (amber when on). It isolates the entire UI into a separate config so you can run test pipelines, edit stub prompts, and change active variants without touching your production setup.

### What test mode affects

| Area | Production (toggle off) | Test mode (toggle on) |
|---|---|---|
| **Run Analysis** | Uses `agents_config.yaml` and `prompts/*.md` | Uses `agents_config.test.yaml` and `prompts/test/*.md` |
| **Models tab** | Shows/edits active variants from `agents_config.yaml` | Shows/edits active variants from `agents_config.test.yaml` |
| **Prompts tab** | Reads/writes `prompts/*.md` | Reads/writes `prompts/test/*.md` |

Editing a prompt in test mode **never touches production files**. Turning the toggle off immediately switches back. State persists across page navigation and browser refresh.

---

## End-to-End Pipeline Test

> Use this to validate the full pipeline works correctly without spending real API budget.
> Requires Option A (Developer Mode) to already be set up and running.

This runs all 5 agents with minimal stub prompts against 3 purpose-built test stocks, each designed to trigger a different code path including both CEO override rules. No backend restart needed — just flip the toggle in the NavBar.

### 1. Enable Test Mode

Click the **Test mode** toggle in the NavBar (top of every page). It turns amber when on.

An amber banner appears on the Models and Prompts pages confirming which config is active:
- Models: *"Editing test config — changes save to agents_config.test.yaml"*
- Prompts: *"Editing test prompts — changes save to prompts/test/"*
- Run Analysis dialog: *"Test mode — uses stub prompts & agents_config.test.yaml. Fast, free, no real analysis."*

### 2. Upload the Test Input File

Click **Run Analysis**, then upload:

```
input_examples/test_stocks.json
```

Click **Run**. The pipeline completes in seconds using Groq (free tier) with stub prompts.

### 3. Expected Results

| Ticker | Expected Result | What it tests |
|---|---|---|
| **NORM** | BUY | Happy path — all 5 agents run, CEO scores normally, no overrides |
| **EXRK** | HOLD + override flag | `short_interest=42%` → `risk_level=extreme` → CEO caps final score at 50 |
| **WEAK** | SELL + override flag | `rsi=18` → `tech_score=20` and `eps_growth=-45%` → `fund_score=20` → CEO forces SELL minimum |

If all three results appear with the correct recommendations and EXRK/WEAK show override flags, the full pipeline is working correctly.

### 4. Switch Back to Production Mode

Click the **Test mode** toggle again to turn it off. The next run, prompt edit, and variant toggle will all use the real `agents_config.yaml` and your production prompts. No restart required.

> **Note:** You can also start the backend in permanent test mode (useful for a full dev session focused on testing) by running `make dev-backend-test` instead of `make dev-backend`. The UI toggle works on top of either backend mode.

---

## Audit Log

The **Audit** tab lets you inspect every LLM call made during any run — the exact prompt sent, the raw model response, and the parsed output. Click any run in the list to open the drawer, then click any cell in the matrix to see the full detail for that agent × ticker combination.

### Production / Test tabs

The audit list is split into two inner tabs:

| Tab | Shows |
|---|---|
| **Production** | Runs started with Test mode **off** |
| **Test runs** | Runs started with Test mode **on** |

The tab counter updates automatically as runs complete. Switching tabs clears the open drawer.

### Agent matrix

Each run opens a heatmap with one row per stock and one column per agent. Columns are built dynamically from whatever agents ran — the 5 standard agents (Technical, Fundamental, Sentiment, Risk, Macro) plus the CEO, and any custom or sub-agents you have configured appear automatically to the right of the standard columns.

Each cell shows:
- A **green / amber / red dot** — green = parsed OK, amber = fallback model used, red = parse failed
- **Latency** in ms (green < 2 s, yellow 2–5 s, red > 5 s)
- A **"web"** label when the agent used a web search tool

Click any cell to open the detail view with three sub-tabs: **Prompt**, **Response**, and **Parsed Output**.

---

## Troubleshooting

**"Port already in use"**
Something else is using that port. Restart your Mac and try again.

**"API key not found" or no results from AI**
Open your `.env` file and make sure the key is correctly pasted with no spaces around the `=` sign.

**Docker says "Cannot connect to the Docker daemon"**
Docker Desktop isn't running. Open it from your Applications folder first.

**"Module not found" or Python errors**
Make sure you ran `pip3 install -r requirements.txt` from the project root folder.

**Database errors on first run**
Run `alembic upgrade head` to create the database tables before starting the backend.
