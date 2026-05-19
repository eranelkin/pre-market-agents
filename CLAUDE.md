# Pre-Market Stock Advisor — Project Compass

Full spec: `pre_market_stocks_agent.md`

---

## What This System Does

Batch pipeline that runs **once per day, ~30 min before market open**. Takes a user-supplied JSON/YAML file of stocks with pre-computed indicators, runs them through a parallel multi-agent AI analysis pipeline, and produces a ranked investment recommendation table.

Not a real-time or trading system. A daily decision-support tool.

---

## Architecture in One View

```
INPUT FILE (JSON/YAML — user supplies)
     │
     ▼
VARIANT RUNNER  ←── reads agents_config.yaml
     │
     ├─► Pipeline [Model A] → Results A  ┐
     ├─► Pipeline [Model B] → Results B  ├─ all run concurrently (asyncio.gather)
     └─► Pipeline [Model C] → Results C  ┘
                    │
              (if N > 1 variant)
                    ▼
         COMPARISON COMPONENT
         per-stock: rank diff, recommendation agreement, confidence delta
                    │
                    ▼
         FRONTEND DASHBOARD  (Next.js 14)
```

**Single-variant run (most common):** Variant Runner fires one pipeline → no comparison step.

---

## Pipeline Internals (per variant)

```
Orchestrator
  └─► splits stocks into chunks of CHUNK_SIZE
  └─► asyncio.gather(*chunks)         ← LEVEL 1 parallelism
        └─► each chunk: asyncio.gather(*5_agents)  ← LEVEL 2 parallelism
  └─► merger: all chunk results → unified YAML
  └─► CEO component: scores, ranks, applies override rules → final results
```

---

## Key Architecture Decisions

### 1. `agents_config.yaml` — Single Source of Truth
**No model assignments in code.** All provider/model/agent config lives in `agents_config.yaml` at project root. Adding a new model = add an entry. Zero code changes.

```yaml
providers:
  anthropic:
    api_key_env: ANTHROPIC_API_KEY
    supports_tool_use: true
    supports_built_in_search: false
  google:
    api_key_env: GOOGLE_API_KEY
    supports_tool_use: true
    supports_built_in_search: true    # Gemini grounding
  groq:
    api_key_env: GROQ_API_KEY
    supports_tool_use: false
    supports_built_in_search: false

model_variants:
  - id: claude_sonnet
    provider: anthropic
    model: claude-sonnet-4-6
  - id: gemini_flash
    provider: google
    model: gemini-1.5-flash
  - id: llama_groq
    provider: groq
    model: llama-3.1-70b-versatile

agents:
  technical:
    prompt_file: prompts/technical_prompt.md
    default_variant: claude_sonnet
    fallback_variant: gemini_flash
    enable_web_search: false
    enable_deep_search: false
    max_tokens: 2000
    timeout_seconds: 45

pipeline:
  chunk_size: 5
  active_variants: [claude_sonnet]    # 1 = single run, N = multi-variant + compare
```

### 2. Provider Plugin Layer (`providers/`)
`BaseProvider` abstract interface. One file per provider. `ProviderRegistry` loads them at startup from config. Adding a new provider = implement `BaseProvider`, add one file, register in config.

### 3. Web Search — Two Modes
- **Tool-use search**: Calls Tavily/Brave/SerpAPI as an LLM tool. Agent decides when to call it. Requires provider `supports_tool_use: true`.
- **Built-in search**: Provider handles natively (Gemini grounding). Activated automatically when `enable_web_search: true` and provider `supports_built_in_search: true`.
- If provider supports neither → web search silently skipped, logged as warning.
- Default search API: **Tavily** (`SEARCH_PROVIDER=tavily` in `.env`).

### 4. Prompts Are Files, Not Code
`prompts/*.md` — loaded at startup by `PromptManager`. Hot-reloadable via `/api/v1/prompts/reload`. Simple stub prompts ship with the codebase; real prompts will be supplied later.

### 5. Concurrency Model — `asyncio` Only, No Queue
AI API latency (2–8s) is the bottleneck, not CPU. `asyncio.gather()` handles it with zero infrastructure overhead. No Celery/Redis queue needed at this scale.

### 6. Redis Is Optional
`redis_client.py` provides run-state cache with graceful fallback to PostgreSQL polling if `REDIS_URL` is unset. Local dev needs zero Redis setup.

### 7. CEO Scoring Weights
```
Technical:   30%
Fundamental: 25%
Sentiment:   20%
Risk:        15%  ← risk_score is INVERTED (higher = lower risk = better)
Macro:       10%
```

Override rules (non-negotiable):
- `risk_level = extreme` → cap `final_score` at 50
- `fund_score < 30 AND tech_score < 30` → recommendation = SELL minimum
- Earnings catalyst + improving sentiment → +5; deteriorating → −5

---

## Tech Stack

| Layer | Technology |
|---|---|
| Backend | Python 3.11+, FastAPI |
| Concurrency | `asyncio.gather()` two-level |
| AI providers | Anthropic, OpenAI, Google (Gemini), Groq — extensible |
| Primary models | `claude-sonnet-4-6` (reasoning), `gpt-4o` (language) |
| Dev/free models | `gemini-1.5-flash`, `llama-3.1-70b-versatile` (Groq) |
| ORM | SQLAlchemy 2.0 async + Alembic |
| Database | PostgreSQL 15 (persistent) + Redis 7 (optional, run-state) |
| Validation | Pydantic v2 + `pydantic-settings` |
| Search | Tavily API (default) — configurable |
| Logging | `structlog` JSON |
| Frontend | Next.js 14 App Router, TypeScript, shadcn/ui, Tailwind, Recharts |
| Containers | Docker + docker-compose |

---

## Project Structure

```
pre-market-advisor/
├── CLAUDE.md                           ← you are here
├── pre_market_stocks_agent.md          ← full original spec
├── agents_config.yaml                  ★ master runtime config
├── .env.example
├── backend/
│   ├── main.py
│   ├── config.py                       pydantic-settings loader
│   ├── database/
│   │   ├── connection.py
│   │   ├── redis_client.py
│   │   ├── models.py                   ORM: Session, Run, Batch, AgentResult, FinalResult, ComparisonResult
│   │   └── migrations/
│   ├── providers/                      ★ plugin layer
│   │   ├── base_provider.py
│   │   ├── registry.py
│   │   ├── anthropic_provider.py
│   │   ├── openai_provider.py
│   │   ├── google_provider.py
│   │   └── groq_provider.py
│   ├── tools/                          ★ web/deep search
│   │   ├── base_tool.py
│   │   ├── web_search_tool.py
│   │   └── deep_search_tool.py
│   ├── orchestrator/
│   │   ├── orchestrator.py             two-level parallel pipeline
│   │   ├── variant_runner.py           ★ runs N pipelines, triggers compare
│   │   ├── chunker.py
│   │   └── merger.py
│   ├── agents/
│   │   ├── base_agent.py
│   │   ├── technical_agent.py
│   │   ├── fundamental_agent.py
│   │   ├── sentiment_agent.py
│   │   ├── risk_agent.py
│   │   └── macro_agent.py
│   ├── ceo/
│   │   ├── chief_evaluator.py
│   │   └── scoring_rubric.py
│   ├── compare/                        ★ multi-variant comparison
│   │   ├── comparator.py
│   │   └── comparison_schema.py
│   ├── schemas/
│   │   ├── input_schema.py
│   │   ├── agent_schema.py
│   │   ├── result_schema.py
│   │   └── comparison_schema.py
│   ├── api/
│   │   ├── routes/
│   │   │   ├── run.py
│   │   │   ├── results.py
│   │   │   ├── compare.py              ★ GET /compare/{session_id}
│   │   │   ├── models.py               ★ GET/PATCH model config + reload
│   │   │   └── health.py
│   │   └── dependencies.py
│   ├── prompts/                        ★ files, not Python strings
│   │   ├── technical_prompt.md
│   │   ├── fundamental_prompt.md
│   │   ├── sentiment_prompt.md
│   │   ├── risk_prompt.md
│   │   ├── macro_prompt.md
│   │   └── ceo_prompt.md
│   └── utils/
│       ├── llm_client.py               delegates to ProviderRegistry
│       ├── prompt_manager.py           ★ loads + hot-reloads prompt files
│       ├── yaml_utils.py
│       ├── id_generator.py
│       └── logger.py
├── frontend/
│   ├── app/
│   │   ├── page.tsx                    home: upload + run trigger + history
│   │   ├── results/[runId]/page.tsx    per-run ranked results
│   │   └── compare/[sessionId]/page.tsx ★ multi-variant comparison
│   └── components/
│       ├── RunTrigger.tsx
│       ├── ModelVariantSelector.tsx    ★ which variants to run
│       ├── PipelineStatus.tsx
│       ├── ResultsTable.tsx
│       ├── TopPicksSpotlight.tsx
│       ├── AgentBreakdown.tsx
│       ├── ComparisonTable.tsx         ★ side-by-side model comparison
│       └── StatusBadge.tsx
├── input_examples/
│   ├── sample_stocks.json
│   └── sample_stocks.yaml             10 stocks designed to hit every override rule
├── docker-compose.yml
├── Dockerfile.backend
├── Dockerfile.frontend
├── alembic.ini
├── requirements.txt
└── pyproject.toml
```

---

## Database Schema (5 tables)

| Table | Purpose |
|---|---|
| `sessions` | Groups N runs from the same input file (one per model variant) |
| `runs` | One pipeline execution — has `session_id` + `model_variant_id` |
| `batches` | One chunk within a run |
| `agent_results` | Per-ticker per-agent output, with `provider_used`, `model_used`, `was_fallback` |
| `final_results` | CEO-ranked output per ticker per run |
| `comparison_results` | Cross-variant comparison per ticker per session |

---

## API Endpoints

| Method | Path | Description |
|---|---|---|
| GET | `/health` | System health + DB check |
| POST | `/api/v1/run` | Upload file → start pipeline → return session_id immediately |
| GET | `/api/v1/run/{run_id}/status` | Poll run status + chunk progress |
| GET | `/api/v1/run/{run_id}/results` | Final ranked results for one variant |
| GET | `/api/v1/run/{run_id}/results/export` | Download CSV |
| GET | `/api/v1/runs` | Historical runs (paginated) |
| GET | `/api/v1/run/{run_id}/agents/{ticker}` | Per-ticker agent breakdown |
| GET | `/api/v1/compare/{session_id}` | ★ Cross-variant comparison results |
| GET | `/api/v1/models` | ★ Current model config (from agents_config.yaml) |
| POST | `/api/v1/models/reload` | ★ Hot-reload agents_config.yaml without restart |
| POST | `/api/v1/prompts/reload` | ★ Hot-reload prompt files without restart |

---

## Implementation Phases

| # | Phase | Status |
|---|---|---|
| 1 | Database & Models (PostgreSQL + SQLAlchemy + Alembic, all 6 tables) | ✅ done |
| 2 | Schemas (Pydantic v2 — all input/output/comparison models) | ✅ done |
| 3 | `agents_config.yaml` + ConfigLoader | ✅ done |
| 4 | Provider Registry (`BaseProvider` + Anthropic, OpenAI, Google, Groq) | ✅ done |
| 5 | Web Search Tools (Tavily tool-use + Gemini grounding) | ✅ done |
| 6 | Prompt Manager (file loader + hot-reload) + stub prompt files | ✅ done |
| 7 | LLMClient (delegates to ProviderRegistry, injects tools, handles fallback) | ✅ done |
| 8 | Base Agent (config-driven, prompt files, tool injection, YAML parse + repair) | ✅ done |
| 9 | 5 Individual Agents (technical, fundamental, sentiment, risk, macro) | ✅ done |
| 10 | Chunker & Merger | ✅ done |
| 11 | Orchestrator (two-level parallel, variant-aware) | ✅ done |
| 12 | Variant Runner (N parallel pipelines + comparison trigger) | ✅ done |
| 13 | CEO Component (scoring, override rules, ranking) | ✅ done |
| 14 | Comparison Component (cross-variant diff) | ✅ done |
| 15 | FastAPI Routes (all endpoints including compare + model/prompt reload) | ✅ done |
| 16 | Frontend (dashboard + model selector + comparison page) | ✅ done |
| 17 | Docker + E2E Test (10 stocks, 2 variants, all override rules) | ✅ done |

---

## Development Rules

- **No model IDs in code** — always via `agents_config.yaml`
- **No prompt strings in code** — always via `prompts/*.md` files
- **All I/O async** — `async def` + `await` everywhere, never `time.sleep()`
- **Agent failures are isolated** — one agent crashing never kills the chunk
- **Provider failures fall back** — per `fallback_variant` in config, not hardcoded
- **Every AI response Pydantic-validated** before DB write
- **risk_score is INVERTED** — higher = lower risk = better (document in every place it appears)
- **Redis optional** — code never crashes if `REDIS_URL` is absent

---

## Environment Variables (key ones)

```bash
# AI Providers (add only the ones you use)
ANTHROPIC_API_KEY=
OPENAI_API_KEY=
GOOGLE_API_KEY=
GROQ_API_KEY=

# Search
SEARCH_PROVIDER=tavily          # tavily | brave | serpapi
TAVILY_API_KEY=
BRAVE_API_KEY=

# Database
DATABASE_URL=postgresql+asyncpg://user:password@localhost:5432/premarket_advisor
REDIS_URL=                      # optional — omit to disable

# App
APP_ENV=development
LOG_LEVEL=INFO
CORS_ORIGINS=http://localhost:3000
```
