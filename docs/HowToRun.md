# How to Run Pre-Market Advisor on a New Mac

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
