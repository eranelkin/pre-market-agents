# PRE-MARKET STOCK ADVISOR SYSTEM — MASTER BUILD PROMPT v2
### For use in Claude Code / IDE Agentic Session

---

## ROLE & MISSION

You are a **senior principal software architect** with deep expertise in:
- Multi-agent AI orchestration systems with multi-provider LLM routing
- Financial data pipelines and stock market analysis
- Async backend architecture and API design
- Production-grade system design with observability, traceability, and resilience
- Database selection and schema design for analytical workloads

Your mission is to design and implement a **Pre-Market Stock Advisor System** — a batch pipeline that runs **once per day**, approximately 30 minutes before market open. It is **not** a streaming or real-time trading system. It is a **daily decision-support tool** that ingests a structured list of stocks with technical and fundamental indicators, runs them through a fully parallel multi-agent AI analysis pipeline, and produces a ranked investment recommendation table for the trading day.

---

## SYSTEM OVERVIEW

```
INPUT FILE (JSON/YAML)
      │
      ▼
┌─────────────────────────────────────────────────────────────┐
│                      ORCHESTRATOR                           │
│  • Parses & validates input file                            │
│  • Splits stocks into chunks of N                           │
│  • Assigns: run_id, process_id, batch_id per chunk          │
│  • Launches ALL chunks concurrently (asyncio.gather)        │
└────────┬────────────────────────────────────────────────────┘
         │  ALL chunks fire simultaneously ▼
         │
   ┌─────┴──────────────────────────────────────────────┐
   │          PARALLEL CHUNK LAYER                       │
   │                                                     │
   │  Chunk 1 ──► [Tech][Fund][Sent][Risk][Macro]        │
   │  Chunk 2 ──► [Tech][Fund][Sent][Risk][Macro]        │
   │  Chunk 3 ──► [Tech][Fund][Sent][Risk][Macro]        │
   │  Chunk N ──► [Tech][Fund][Sent][Risk][Macro]        │
   │                                                     │
   │  Within each chunk, all 5 agents run concurrently   │
   │  across all chunks at the same time.                │
   │  Total AI calls = chunks × 5 agents, all async.     │
   └─────┬──────────────────────────────────────────────┘
         │  All chunks complete ▼ (CEO barrier)
         ▼
┌─────────────────────────────────────────────────────────────┐
│                    ORCHESTRATOR (Merger)                    │
│  Collects results from every chunk + every agent            │
│  Builds one unified YAML payload covering all stocks        │
│  Persists all AgentResult rows to PostgreSQL                │
└────────┬────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────┐
│                   DATABASE (Persistence)                    │
│  PostgreSQL — structured relational store                   │
│  Redis      — live run-state cache (optional)               │
│  Saves: run_id, process_id, batch_id, model_id,             │
│         provider_used, was_fallback, agent outputs          │
└────────┬────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────┐
│                    CEO COMPONENT                            │
│  Receives the complete merged YAML (all stocks, all agents) │
│  Scores, ranks, and justifies every stock                   │
│  Uses a dedicated expert-level AI prompt (Claude Sonnet)    │
│  Applies override rules and conflict resolution             │
└────────┬────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────┐
│                   FINAL RESULTS TABLE                       │
│  All input stocks ranked by final composite score           │
│  Per-stock: recommendation, confidence, agent scores,       │
│  key signals, AI rationale, provider used                   │
└─────────────────────────────────────────────────────────────┘
```

---

## ARCHITECTURE DECISIONS & RATIONALE

Before writing a single line of code, understand *why* each component was chosen. These decisions are deliberate and must be respected throughout the entire implementation.

---

### DECISION 1 — Concurrency Model: Full Two-Level Parallelism (No Queue Needed)

**Chosen: `asyncio.gather()` at both the chunk level AND the agent level**

This is the most important performance decision in the system. The bottleneck is AI API latency (2–8 seconds per call), not CPU. `asyncio` is exactly the right tool — it fires all coroutines simultaneously and the Python process yields while waiting for network I/O.

**Two-level parallel execution pattern — implement exactly this:**

```python
# orchestrator/orchestrator.py

async def run_pipeline(self, stocks: list[StockInput], run_id: UUID) -> None:
    chunks = self.chunker.split(stocks, chunk_size=CHUNK_SIZE)

    # ── LEVEL 1: All chunks fire at the same time ──────────────────────────
    chunk_tasks = [self._process_chunk(chunk, run_id, idx) for idx, chunk in enumerate(chunks)]
    all_chunk_results = await asyncio.gather(*chunk_tasks, return_exceptions=True)

    # ── Merge + handle partial failures ────────────────────────────────────
    merged_yaml = self.merger.merge(all_chunk_results)

    # ── CEO barrier: receives everything, then scores ──────────────────────
    final_results = await self.ceo.evaluate(merged_yaml, run_id)
    await self.db.save_final_results(final_results, run_id)


async def _process_chunk(self, chunk: list[StockInput], run_id: UUID, idx: int) -> ChunkResult:
    batch_id = generate_batch_id(run_id, idx)
    await self.db.create_batch(batch_id, run_id, chunk)

    # ── LEVEL 2: All 5 agents fire concurrently within every chunk ─────────
    agent_tasks = [
        self.technical_agent.analyze(chunk, run_id, batch_id),
        self.fundamental_agent.analyze(chunk, run_id, batch_id),
        self.sentiment_agent.analyze(chunk, run_id, batch_id),
        self.risk_agent.analyze(chunk, run_id, batch_id),
        self.macro_agent.analyze(chunk, run_id, batch_id),
    ]
    agent_results = await asyncio.gather(*agent_tasks, return_exceptions=True)

    # ── Graceful degradation: one failed agent never kills the chunk ────────
    safe_results = {}
    for agent_name, result in zip(AGENT_NAMES, agent_results):
        if isinstance(result, Exception):
            log.error("agent_failed", agent=agent_name, batch_id=batch_id, error=str(result))
            safe_results[agent_name] = AgentResult.empty(agent_name)  # null score, continues
        else:
            safe_results[agent_name] = result

    await self.db.save_agent_results(safe_results, batch_id, run_id)
    return ChunkResult(batch_id=batch_id, agent_results=safe_results)
```

**Performance impact with 30 stocks / 6 chunks of 5:**
- Without parallel chunks (old sequential): ~6 × (slowest agent latency) ≈ 48s
- With parallel chunks (this design):  ~1 × (slowest agent latency) ≈ 8s
- CEO component runs once after the barrier: +10–20s
- **Total estimated wall-clock time: ~25–30 seconds for 30 stocks**

**Why no queue (Celery/ARQ/RQ) is needed:**
- A queue adds a broker (Redis/RabbitMQ), worker processes, DLQ management, and task state machinery
- The bottleneck is AI API I/O — `asyncio` handles this with zero infrastructure overhead
- This system runs once per day; queue overhead is pure cost with no benefit at this scale
- If scale ever reaches 500+ stocks across multiple machines, re-evaluate then

---

### DECISION 2 — Backend Stack: Python + FastAPI

**Chosen: Python 3.11+ with FastAPI**

**Why Python:**
- Every major AI SDK (Anthropic, OpenAI) has a first-class async Python client
- `asyncio.gather()` achieves true concurrency for I/O-bound AI calls without threads
- Pydantic v2 (Rust-backed) gives zero-boilerplate schema validation
- Data science ecosystem (pandas, numpy) available if in-process indicator math is needed later

**Why FastAPI over Flask/Django:**
- Native `async def` route handlers — no WSGI adapter
- Auto-generated OpenAPI/Swagger docs from Pydantic schemas
- Clean dependency injection for DB sessions and config
- Best-in-class performance for an I/O-heavy pipeline

---

### DECISION 3 — AI Provider Strategy: Multi-Provider with Automatic Fallback

**Chosen: Anthropic Claude as PRIMARY for reasoning agents, OpenAI GPT-4o as PRIMARY for language agents, cross-provider automatic fallback for both**

**Implement a `LLMClient` abstraction — all agents talk to this, never directly to a provider SDK:**

```python
# utils/llm_client.py

class LLMClient:
    """
    Provider-agnostic client. Routes each agent to its best-fit model.
    Auto-falls back to the other provider on rate limit or API error.
    Records provider_used, model_used, was_fallback on every call.
    """

    AGENT_MODEL_MAP = {
        # Claude Sonnet: best for structured analytical reasoning + complex schemas
        "technical":   {"provider": "anthropic", "model": "claude-sonnet-4-20250514"},
        "fundamental": {"provider": "anthropic", "model": "claude-sonnet-4-20250514"},
        "risk":        {"provider": "anthropic", "model": "claude-sonnet-4-20250514"},
        "ceo":         {"provider": "anthropic", "model": "claude-sonnet-4-20250514"},
        # GPT-4o: stronger on news narrative + macro text comprehension
        "sentiment":   {"provider": "openai", "model": "gpt-4o"},
        "macro":       {"provider": "openai", "model": "gpt-4o"},
    }

    FALLBACK_MAP = {
        "anthropic": {"provider": "openai",    "model": "gpt-4o"},
        "openai":    {"provider": "anthropic", "model": "claude-sonnet-4-20250514"},
    }

    async def complete(self, agent_name: str, prompt: str, max_tokens: int = 2000) -> LLMResponse:
        """
        1. Resolve primary provider/model from AGENT_MODEL_MAP
        2. Call primary with exponential backoff (3 retries)
        3. On RateLimitError or 5xx after retries → switch to FALLBACK_MAP entry
        4. If both fail → raise PipelineAgentError (triggers agent failure isolation)
        5. Always return LLMResponse(content, provider_used, model_used, was_fallback,
                                     tokens_used, latency_ms)
        """
```

**Model IDs:**
```
Anthropic primary : claude-sonnet-4-20250514
OpenAI primary    : gpt-4o
OpenAI fallback   : gpt-4o-mini  (cheaper on retry)
```

All routing is overridable via environment variables — see Environment Configuration.

---

### DECISION 4 — Database: PostgreSQL + Redis (Hybrid)

**Chosen: PostgreSQL 15 (persistent store) + Redis 7 (live run-state cache, optional)**

**Why PostgreSQL over MongoDB:**
- `runs → batches → agent_results → final_results` is a clear relational hierarchy; SQL joins are natural
- Financial scores require `NUMERIC(5,2)` precision — MongoDB BSON doesn't enforce this
- JSONB columns provide MongoDB-style flexibility for `parsed_output` and `signals` where schema varies per agent
- Alembic gives controlled, versioned schema migrations
- SQL queries like "all STRONG_BUY stocks from the last 30 days ranked by confidence" are one-liners

**Why add Redis:**
- Run status (`pending | running | completed`) is polled by the frontend every 2 seconds during execution
- Redis holds `run:{run_id}:status` and `run:{run_id}:progress` as lightweight key-value entries with 24h TTL
- PostgreSQL is the source of truth for history; Redis is the source of truth for the live poll
- Redis is **optional** — if `REDIS_URL` is not set, the system falls back to polling PostgreSQL directly. Local dev needs zero Redis setup.

---

## TECH STACK SUMMARY

| Layer | Technology | Version |
|---|---|---|
| Backend runtime | Python | 3.11+ |
| Web framework | FastAPI | 0.111+ |
| Concurrency | `asyncio` + `asyncio.gather()` (two-level) | stdlib |
| AI — reasoning agents | Anthropic Claude Sonnet | `claude-sonnet-4-20250514` |
| AI — language agents | OpenAI GPT-4o | `gpt-4o` |
| AI — fallback | Cross-provider automatic via `LLMClient` | — |
| Anthropic SDK | `anthropic` | 0.25+ |
| OpenAI SDK | `openai` | 1.30+ |
| Primary database | PostgreSQL | 15+ |
| Run-state cache | Redis | 7+ (optional) |
| ORM + migrations | SQLAlchemy 2.0 async + Alembic | 2.0+ |
| Data validation | Pydantic v2 | 2.0+ |
| Config management | `pydantic-settings` + `.env` | 2.0+ |
| Serialization | `PyYAML` + `orjson` | latest |
| Frontend | Next.js 14 App Router + TypeScript | 14+ |
| UI components | shadcn/ui + Tailwind CSS | latest |
| Charts | Recharts | latest |
| Logging | `structlog` (structured JSON) | latest |
| Testing | `pytest` + `pytest-asyncio` | latest |
| Containers | Docker + docker-compose | latest |

---

## PROJECT STRUCTURE

Build the following directory structure precisely:

```
pre-market-advisor/
├── backend/
│   ├── main.py                         # FastAPI app entry point
│   ├── config.py                       # Settings via pydantic-settings
│   ├── database/
│   │   ├── connection.py               # Async SQLAlchemy engine + session factory
│   │   ├── redis_client.py             # Redis run-state cache (graceful fallback if absent)
│   │   ├── models.py                   # ORM models: Run, Batch, AgentResult, FinalResult
│   │   └── migrations/                 # Alembic migration files
│   ├── orchestrator/
│   │   ├── __init__.py
│   │   ├── orchestrator.py             # ★ Two-level parallel pipeline controller
│   │   ├── chunker.py                  # Splits stock list into chunks of CHUNK_SIZE
│   │   └── merger.py                   # Merges all chunk+agent results → unified YAML
│   ├── agents/
│   │   ├── base_agent.py               # Abstract base: uses LLMClient, parses YAML, validates
│   │   ├── technical_agent.py          # RSI, MACD, MA stack, volume, support/resistance
│   │   ├── fundamental_agent.py        # P/E, EPS growth, revenue, margins, FCF, debt
│   │   ├── sentiment_agent.py          # News sentiment, analyst ratings, social signals
│   │   ├── risk_agent.py               # Beta, implied volatility, drawdown, short interest
│   │   └── macro_agent.py              # Sector momentum, index correlation, catalysts
│   ├── ceo/
│   │   ├── __init__.py
│   │   ├── chief_evaluator.py          # Final scoring, ranking, rationale — uses LLMClient
│   │   └── scoring_rubric.py           # Scoring weights, override rules, thresholds
│   ├── schemas/
│   │   ├── input_schema.py             # Pydantic models for input JSON/YAML
│   │   ├── agent_schema.py             # Pydantic models for per-agent output
│   │   └── result_schema.py            # Pydantic models for final ranked results
│   ├── api/
│   │   ├── routes/
│   │   │   ├── run.py                  # POST /api/v1/run — trigger pipeline
│   │   │   ├── results.py              # GET /api/v1/run/{run_id}/results + export
│   │   │   └── health.py               # GET /health
│   │   └── dependencies.py             # DB session injection, shared dependencies
│   ├── prompts/
│   │   ├── technical_prompt.py         # Prompt builder for Technical agent
│   │   ├── fundamental_prompt.py       # Prompt builder for Fundamental agent
│   │   ├── sentiment_prompt.py         # Prompt builder for Sentiment agent
│   │   ├── risk_prompt.py              # Prompt builder for Risk agent
│   │   ├── macro_prompt.py             # Prompt builder for Macro agent
│   │   └── ceo_prompt.py               # Master evaluator prompt builder
│   └── utils/
│       ├── llm_client.py               # ★ Provider-agnostic AI client (Anthropic + OpenAI)
│       ├── yaml_utils.py               # YAML parse/validate helpers
│       ├── id_generator.py             # run_id, process_id, batch_id generators
│       └── logger.py                   # structlog JSON logger setup
├── frontend/
│   ├── app/
│   │   ├── page.tsx                    # Home dashboard: upload + run trigger + history
│   │   ├── results/[runId]/page.tsx    # Per-run results page
│   │   └── layout.tsx
│   ├── components/
│   │   ├── RunTrigger.tsx              # File upload zone + Run Analysis button
│   │   ├── PipelineStatus.tsx          # Live progress: Parsing→Chunking→Agents→CEO→Done
│   │   ├── ResultsTable.tsx            # Final ranked stock table with expandable rows
│   │   ├── TopPicksSpotlight.tsx       # TOP 3 recommendation cards
│   │   ├── AgentBreakdown.tsx          # Per-agent scores + provider badge (Anthropic/OpenAI)
│   │   └── StatusBadge.tsx             # Run status pill
│   └── lib/
│       └── api.ts                      # Typed fetch wrapper for backend API
├── input_examples/
│   ├── sample_stocks.json
│   └── sample_stocks.yaml
├── docker-compose.yml                  # PostgreSQL + Redis + backend + frontend
├── Dockerfile.backend
├── Dockerfile.frontend
├── alembic.ini
├── requirements.txt
├── pyproject.toml
└── .env.example
```

---

## DATABASE SCHEMA

Implement the following tables using SQLAlchemy 2.0 async ORM. Run all schema changes through Alembic migrations — never use `create_all()` in production code.

### `runs` table
```
run_id           UUID PRIMARY KEY
process_id       VARCHAR  — human-readable: "PREMARKET-20250518-001"
status           ENUM     — pending | running | completed | failed
input_file_name  VARCHAR
total_stocks     INTEGER
chunk_count      INTEGER
model_id         VARCHAR  — primary model: "claude-sonnet-4-20250514"
providers_used   JSONB    — {"technical":"anthropic","sentiment":"openai","ceo":"anthropic"}
started_at       TIMESTAMP WITH TIME ZONE
completed_at     TIMESTAMP WITH TIME ZONE
error_message    TEXT     — nullable
```

### `batches` table
```
batch_id         UUID PRIMARY KEY
run_id           UUID FK → runs.run_id
batch_index      INTEGER  — 0-based chunk number
stocks_in_batch  JSONB    — list of ticker symbols in this chunk
status           ENUM     — pending | running | completed | failed
started_at       TIMESTAMP WITH TIME ZONE
completed_at     TIMESTAMP WITH TIME ZONE
```

### `agent_results` table
```
result_id        UUID PRIMARY KEY
batch_id         UUID FK → batches.batch_id
run_id           UUID FK → runs.run_id
agent_name       VARCHAR  — "technical" | "fundamental" | "sentiment" | "risk" | "macro"
ticker           VARCHAR
provider_used    VARCHAR  — "anthropic" | "openai"
model_used       VARCHAR  — exact model string: "claude-sonnet-4-20250514" | "gpt-4o"
was_fallback     BOOLEAN  — true if primary provider failed and fallback was used
raw_prompt       TEXT     — exact prompt sent to AI (for debugging/audit)
raw_response     TEXT     — exact AI response (for debugging/audit)
parsed_output    JSONB    — structured, Pydantic-validated agent result
tokens_used      INTEGER
latency_ms       INTEGER
created_at       TIMESTAMP WITH TIME ZONE
```

### `final_results` table
```
result_id          UUID PRIMARY KEY
run_id             UUID FK → runs.run_id
ticker             VARCHAR
final_score        NUMERIC(5,2)  — 0.00 to 100.00
rank               INTEGER       — 1 = best
recommendation     ENUM          — strong_buy | buy | hold | sell | strong_sell
confidence         NUMERIC(4,2)  — 0.00 to 1.00
technical_score    NUMERIC(5,2)
fundamental_score  NUMERIC(5,2)
sentiment_score    NUMERIC(5,2)
risk_score         NUMERIC(5,2)  — higher = lower risk (inverted)
macro_score        NUMERIC(5,2)
ceo_rationale      TEXT          — AI-generated plain-English justification
signals            JSONB         — key signals per agent
created_at         TIMESTAMP WITH TIME ZONE
```

---

## INPUT FILE SCHEMA

Accept both JSON and YAML. Auto-detect format by file extension (`.json` or `.yaml`/`.yml`). Validate immediately on upload using Pydantic — return HTTP 422 with field-level errors on invalid input.

**Required schema per stock entry:**
```yaml
stocks:
  - ticker: "AAPL"
    company_name: "Apple Inc."
    sector: "Technology"
    market_cap_b: 2800.5          # billions USD
    technical:
      rsi_14: 58.3
      macd_signal: "bullish_crossover"   # bullish_crossover | bearish_crossover | neutral
      ma_50: 182.4
      ma_200: 171.2
      volume_vs_avg: 1.23         # ratio: 1.0 = average daily volume
      atr_14: 3.2                 # Average True Range
      support_level: 178.0
      resistance_level: 195.0
    fundamental:
      pe_ratio: 28.4
      eps_growth_yoy: 0.12        # 12% year-over-year
      revenue_growth_yoy: 0.08
      gross_margin: 0.44
      debt_to_equity: 1.73
      free_cash_flow_b: 90.2
    sentiment:
      analyst_rating: "buy"       # strong_buy | buy | hold | sell | strong_sell
      analyst_count: 42
      news_sentiment_score: 0.72  # -1.0 (very negative) to 1.0 (very positive)
      social_sentiment: "neutral" # positive | neutral | negative
    risk:
      beta: 1.24
      week_52_high: 199.62
      week_52_low: 143.90
      implied_volatility: 0.26
      short_interest_pct: 0.84
    macro:
      sector_momentum: "positive"  # positive | neutral | negative
      index_correlation: 0.87
      upcoming_catalyst: "earnings_next_week"  # or null
```

---

## LLM CLIENT — IMPLEMENTATION SPEC

Build this before any agent. Every agent and the CEO component depend on it.

```python
# utils/llm_client.py

from dataclasses import dataclass
import time, asyncio
from anthropic import AsyncAnthropic, RateLimitError as AnthropicRateLimit
from openai import AsyncOpenAI, RateLimitError as OpenAIRateLimit

@dataclass
class LLMResponse:
    content: str
    provider_used: str
    model_used: str
    was_fallback: bool
    tokens_used: int
    latency_ms: int

class LLMClient:
    AGENT_MODEL_MAP = {
        "technical":   ("anthropic", "claude-sonnet-4-20250514"),
        "fundamental": ("anthropic", "claude-sonnet-4-20250514"),
        "risk":        ("anthropic", "claude-sonnet-4-20250514"),
        "ceo":         ("anthropic", "claude-sonnet-4-20250514"),
        "sentiment":   ("openai",    "gpt-4o"),
        "macro":       ("openai",    "gpt-4o"),
    }
    FALLBACK_MAP = {
        "anthropic": ("openai",    "gpt-4o"),
        "openai":    ("anthropic", "claude-sonnet-4-20250514"),
    }
    MAX_RETRIES = 3

    def __init__(self, anthropic_key: str, openai_key: str):
        self._anthropic = AsyncAnthropic(api_key=anthropic_key)
        self._openai = AsyncOpenAI(api_key=openai_key)

    async def complete(self, agent_name: str, prompt: str, max_tokens: int = 2000) -> LLMResponse:
        primary_provider, primary_model = self.AGENT_MODEL_MAP[agent_name]
        try:
            return await self._call_with_retry(primary_provider, primary_model, prompt, max_tokens, was_fallback=False)
        except (AnthropicRateLimit, OpenAIRateLimit, Exception):
            fallback_provider, fallback_model = self.FALLBACK_MAP[primary_provider]
            return await self._call_with_retry(fallback_provider, fallback_model, prompt, max_tokens, was_fallback=True)

    async def _call_with_retry(self, provider, model, prompt, max_tokens, was_fallback) -> LLMResponse:
        for attempt in range(self.MAX_RETRIES):
            try:
                t0 = time.monotonic()
                if provider == "anthropic":
                    resp = await self._anthropic.messages.create(
                        model=model, max_tokens=max_tokens,
                        messages=[{"role": "user", "content": prompt}]
                    )
                    content = resp.content[0].text
                    tokens = resp.usage.input_tokens + resp.usage.output_tokens
                else:
                    resp = await self._openai.chat.completions.create(
                        model=model, max_tokens=max_tokens,
                        messages=[{"role": "user", "content": prompt}]
                    )
                    content = resp.choices[0].message.content
                    tokens = resp.usage.total_tokens
                return LLMResponse(content, provider, model, was_fallback, tokens,
                                   int((time.monotonic() - t0) * 1000))
            except Exception as e:
                if attempt == self.MAX_RETRIES - 1:
                    raise
                await asyncio.sleep(2 ** attempt)  # exponential backoff: 1s, 2s, 4s
```

**Override routing via environment:**
Any `AGENT_*_PROVIDER` env variable overrides `AGENT_MODEL_MAP` at startup. The `LLMClient.__init__` should read these and patch the map. This lets you pin all agents to one provider without code changes.

---

## AGENT BASE CLASS — IMPLEMENTATION SPEC

```python
# agents/base_agent.py

class BaseAgent(ABC):
    agent_name: str          # must match key in LLMClient.AGENT_MODEL_MAP
    max_tokens: int = 2000
    temperature: float = 0.2 # low temp = analytical consistency

    def __init__(self, llm_client: LLMClient):
        self.llm = llm_client

    @abstractmethod
    def build_prompt(self, stocks: list[StockInput]) -> str:
        """Construct the agent-specific analysis prompt for this chunk."""

    @abstractmethod
    def parse_response(self, raw: str) -> dict:
        """Parse and structurally validate the AI YAML response."""

    async def analyze(self, stocks: list[StockInput], run_id: UUID, batch_id: UUID) -> AgentBatchResult:
        prompt = self.build_prompt(stocks)
        response = await self.llm.complete(self.agent_name, prompt, self.max_tokens)

        try:
            parsed = self.parse_response(response.content)
            validated = AgentOutputSchema.model_validate(parsed)
        except (yaml.YAMLError, ValidationError):
            # One repair attempt with explicit correction instruction
            repair_prompt = REPAIR_TEMPLATE.format(original=prompt, bad_response=response.content)
            response = await self.llm.complete(self.agent_name, repair_prompt, self.max_tokens)
            parsed = self.parse_response(response.content)
            validated = AgentOutputSchema.model_validate(parsed)

        return AgentBatchResult(
            agent_name=self.agent_name,
            batch_id=batch_id,
            run_id=run_id,
            provider_used=response.provider_used,
            model_used=response.model_used,
            was_fallback=response.was_fallback,
            raw_prompt=prompt,
            raw_response=response.content,
            parsed_output=validated,
            tokens_used=response.tokens_used,
            latency_ms=response.latency_ms,
        )
```

**Universal agent prompt engineering rules — apply to ALL 5 agents:**
1. Instruct the AI to return **only valid YAML** — no markdown fences, no preamble, no explanation
2. Define the **exact output schema** inline in the prompt so the AI knows every required field
3. Provide **explicit scoring rubrics** with numeric boundaries (e.g. "RSI 30–50 = 15 points, RSI 50–65 = 20 points")
4. Include **chain-of-thought instruction**: "Reason step by step before outputting the YAML"
5. Set a **professional persona**: "You are a senior [domain] analyst at a top-tier hedge fund"
6. Specify temperature context: "Be precise and data-driven. Do not speculate beyond the provided data."

---

## INDIVIDUAL AGENT PROMPTS

Implement each in `prompts/` as a function receiving `list[StockInput]` and returning a formatted string.

### Technical Analysis Agent
- **Persona:** "Senior Technical Analyst at a quantitative hedge fund with 15+ years in equity chart analysis"
- **Analyze:** RSI overbought/oversold with divergence, MACD crossover strength and histogram, MA stack alignment (price vs MA50 vs MA200), volume confirmation vs average, proximity to key support/resistance levels, ATR-based momentum
- **Output per ticker:** `tech_score` (0–100), `primary_signal` (bullish/bearish/neutral), `ma_alignment`, `volume_signal`, `key_level_proximity`, `signal_strength` (weak/moderate/strong), `reasoning` (3–4 sentences)

### Fundamental Analysis Agent
- **Persona:** "CFA-certified Fundamental Analyst specializing in equity valuation"
- **Analyze:** P/E vs sector average, EPS and revenue growth trajectory, gross margin quality and trend, free cash flow yield, debt-to-equity risk, earnings quality signals
- **Output per ticker:** `fund_score` (0–100), `valuation_verdict` (cheap/fair/expensive), `growth_quality` (strong/moderate/weak), `balance_sheet_health` (strong/adequate/stressed), `risk_flags` (list), `reasoning`

### Sentiment & News Agent
- **Persona:** "Market Intelligence Analyst specializing in behavioral finance and market sentiment"
- **Analyze:** Analyst consensus strength and dispersion, news sentiment trajectory (recent vs prior period), social signal weight, upcoming catalyst risk/reward, insider activity signals
- **Output per ticker:** `sentiment_score` (0–100), `sentiment_trend` (improving/stable/deteriorating), `catalyst_flag` (boolean), `catalyst_type` (earnings/product/macro/none), `analyst_conviction` (high/medium/low), `reasoning`

### Risk & Volatility Agent
- **Persona:** "Risk Manager at a systematic trading firm, expert in downside protection"
- **Analyze:** Beta-adjusted market risk, implied vs historical volatility spread, distance from 52-week high (drawdown exposure), short interest as squeeze or pressure risk, overall position sizing implication
- **Output per ticker:** `risk_score` (0–100, **INVERTED** — higher score = lower risk), `risk_level` (low/medium/high/extreme), `beta_assessment`, `volatility_regime` (low/normal/elevated/extreme), `key_risks` (list), `reasoning`
- **CRITICAL:** Document clearly in code that `risk_score` is inverted. The CEO component applies it as-is.

### Macro & Sector Agent
- **Persona:** "Macro Strategist and Sector Rotation Specialist at a global macro fund"
- **Analyze:** Sector momentum relative to broad market, correlation risk with index, macro headwinds/tailwinds for the sector, catalyst timing and event risk, sector rotation signal
- **Output per ticker:** `macro_score` (0–100), `sector_stance` (overweight/neutral/underweight), `macro_alignment` (tailwind/neutral/headwind), `catalyst_timing` (near/medium/distant/none), `reasoning`

---

## CEO COMPONENT — CHIEF EVALUATOR

This is the system's most critical component. It receives the complete merged YAML covering all stocks across all chunks (every agent's output for every ticker) and produces the final authoritative ranking.

```python
# ceo/chief_evaluator.py

class ChiefEvaluator:
    model_id = "claude-sonnet-4-20250514"  # always Claude for synthesis
    max_tokens = 8000                       # larger context — full merged payload
    temperature = 0.1                       # maximum consistency

    SCORING_WEIGHTS = {
        "technical":   0.30,
        "fundamental": 0.25,
        "sentiment":   0.20,
        "risk":        0.15,  # risk_score is INVERTED — higher = safer
        "macro":       0.10,
    }
```

**CEO Prompt — include every element below:**

```
You are the Chief Investment Officer (CIO) of a top-tier quantitative hedge fund
with 20+ years of experience in equity markets, technical analysis, and portfolio
construction. You have deep expertise in synthesizing multi-dimensional signals
into actionable investment decisions.

You will receive a YAML document containing analysis results for {N} stocks,
each evaluated by 5 specialist agents: Technical, Fundamental, Sentiment,
Risk, and Macro.

YOUR TASK — execute in this exact order:

1. Review each stock's agent scores and reasoning holistically
2. Apply the following weighting scheme to compute a raw composite score:
   - Technical Analysis:  30%
   - Fundamental Analysis: 25%
   - Sentiment & News:    20%
   - Risk Assessment:     15%  ← risk_score is INVERTED: higher = lower risk = better
   - Macro Alignment:     10%
3. Apply override rules (see CRITICAL RULES below) — these can change or cap scores
4. Assign a final_score (0–100) and recommendation for each stock
5. Rank all stocks from highest to lowest final_score
6. For each stock, flag any conflicting signals between agents and document resolution
7. Identify the TOP 3 stocks for today's trading session with specific entry rationale
8. Identify any stocks with RED FLAGS that override positive composite scores

CRITICAL OVERRIDE RULES (non-negotiable):
- If risk_level = "extreme" → cap final_score at 50, regardless of other agent scores
- If fundamental_score < 30 AND technical_score < 30 → recommendation = "sell" minimum
- If catalyst_flag = true AND catalyst_type = "earnings":
    sentiment_trend = "improving" → add +5 to final_score
    sentiment_trend = "deteriorating" → subtract 5 from final_score
- Confidence score = agreement across agents:
    All agents agree direction → 0.90–0.95
    4 of 5 agree → 0.75–0.89
    Mixed signals (3/5 or less agree) → 0.50–0.74
    Contradictory signals → 0.30–0.49

RECOMMENDATION THRESHOLDS:
- 80–100 → STRONG_BUY
- 65–79  → BUY
- 45–64  → HOLD
- 30–44  → SELL
- 0–29   → STRONG_SELL

OUTPUT FORMAT: Return ONLY valid YAML. No markdown fences, no preamble, no explanation.
Match this exact schema for every stock:

stocks:
  - ticker: "AAPL"
    final_score: 82.5
    rank: 1
    recommendation: "STRONG_BUY"
    confidence: 0.91
    technical_score: 78.0
    fundamental_score: 85.0
    sentiment_score: 80.0
    risk_score: 72.0
    macro_score: 68.0
    override_applied: false
    override_reason: null
    conflicting_signals: []
    key_signals:
      technical: "bullish MACD crossover, above both MAs, volume 1.2x average"
      fundamental: "P/E fair vs sector, strong FCF, low debt"
      sentiment: "analyst consensus BUY with high conviction, positive news trend"
      risk: "moderate beta, low volatility regime, minimal short interest"
      macro: "sector tailwind, positive momentum"
    ceo_rationale: "AAPL presents a high-conviction BUY for today's session..."

top_3_picks:
  - ticker: "AAPL"
    rank: 1
    entry_rationale: "..."

red_flags:
  - ticker: "XYZ"
    reason: "extreme volatility overrides 78 composite score — capped at 50"
```

---

## API ENDPOINTS

| Method | Path | Description |
|---|---|---|
| `GET` | `/health` | System health + DB connectivity check |
| `POST` | `/api/v1/run` | Upload input file → start pipeline → return run_id immediately |
| `GET` | `/api/v1/run/{run_id}/status` | Poll run status + chunk-level progress |
| `GET` | `/api/v1/run/{run_id}/results` | Fetch complete final ranked results |
| `GET` | `/api/v1/run/{run_id}/results/export` | Download as CSV or XLSX |
| `GET` | `/api/v1/runs` | List all historical runs (paginated) |
| `GET` | `/api/v1/run/{run_id}/agents/{ticker}` | Per-ticker agent score breakdown |

**POST `/api/v1/run` behavior:**
1. Accept multipart file upload (`.json` or `.yaml`)
2. Validate schema immediately — return HTTP 422 with field errors on invalid input
3. Create `Run` record in DB with `status=pending`
4. Launch full pipeline as a `BackgroundTask` (FastAPI)
5. Return immediately: `{ "run_id": "...", "process_id": "PREMARKET-20250518-001", "status": "running" }`
6. Frontend polls `/status` every 2 seconds until `completed` or `failed`

**GET `/api/v1/run/{run_id}/status` response:**
```json
{
  "run_id": "...",
  "status": "running",
  "progress": {
    "total_chunks": 6,
    "chunks_completed": 4,
    "total_stocks": 30,
    "stage": "agents_running"
  }
}
```

---

## FRONTEND DASHBOARD

Build a professional financial dashboard with Next.js 14 App Router + TypeScript.

**Design direction:** Dark theme. Professional financial terminal aesthetic — think Bloomberg Terminal meets modern SaaS. Deep navy/charcoal backgrounds (`#0D1117`, `#161B22`). Sharp accent colors: electric blue for primary actions, amber for warnings, green/red for buy/sell signals. Monospace font (JetBrains Mono or similar) for all numbers and scores. Clean sans-serif (Inter or Geist) for labels and body text.

---

**Page 1: Home Dashboard (`/`)**

Layout:
- Header: "Pre-Market Advisor" wordmark + today's date + market open countdown timer
- Upload zone: drag-and-drop or click-to-select for `.json`/`.yaml` files; shows file name + stock count after parse
- "Run Analysis" button: disabled until valid file is loaded; shows spinner during run
- Live pipeline status tracker (visible once run starts):
  ```
  ● Parsing input  →  ● Splitting chunks  →  ● Agents running  →  ● CEO evaluating  →  ○ Complete
                                               [████████░░] 4/6 chunks
  ```
- Recent runs table: last 10 runs with run date, stock count, duration, status badge, link to results

---

**Page 2: Results Page (`/results/[runId]`)**

Layout:
- Run metadata bar: process_id, date, models used, total stocks, pipeline duration
- TOP 3 PICKS spotlight: three prominent cards, each showing:
  - Ticker + company name + sector badge
  - Final score (large, color-coded) + STRONG_BUY badge
  - CEO entry rationale (2–3 sentences)
  - Agent score mini-bar (5 colored segments)
- Full ranked results table with columns:
  ```
  Rank | Ticker | Company | Sector | Score | Recommendation | Confidence |
  Technical | Fundamental | Sentiment | Risk | Macro | Key Signal
  ```
  - Color coding: STRONG_BUY (emerald) → BUY (green) → HOLD (amber) → SELL (orange) → STRONG_SELL (red)
  - Expandable row: clicking a row reveals full per-agent reasoning + provider badge (Anthropic/OpenAI)
  - Red flag indicator: ⚠ icon on any stock where override_applied = true
- Export bar: "Download CSV" and "Download XLSX" buttons

---

## ERROR HANDLING & RESILIENCE

Implement all of the following — these are non-negotiable for a production pipeline:

1. **Agent failure isolation** — `asyncio.gather(return_exceptions=True)` catches per-agent exceptions. A failing agent writes `AgentResult.empty()` (null score, null reasoning) and the chunk continues. The CEO handles null scores gracefully (excludes from weighted average, notes in rationale).

2. **LLM retry with exponential backoff** — `LLMClient._call_with_retry` retries 3 times with delays of 1s, 2s, 4s on `RateLimitError` or 5xx responses. After 3 failures, switches to fallback provider.

3. **YAML repair prompt** — if the AI returns malformed YAML or a response that fails Pydantic validation, `BaseAgent.analyze()` sends one repair request with the original prompt and bad response attached, asking the AI to correct the output format.

4. **Timeout guards** — wrap every `llm.complete()` call with `asyncio.wait_for(timeout=45)` for agents and `asyncio.wait_for(timeout=120)` for the CEO. Timeout = agent failure, caught by isolation pattern.

5. **Chunk-level failure isolation** — if an entire chunk's `_process_chunk()` raises (all 5 agents failed), that chunk is marked `failed` in the DB and excluded from the merger. The CEO component receives a note that chunk N was unavailable. The final results table still includes those tickers, marked with a "Data Unavailable" status.

6. **CEO failure recovery** — if the CEO component fails after agents complete, all `agent_results` rows are already saved to PostgreSQL. The run is marked `failed` but agent data is preserved and queryable.

7. **Redis unavailability** — if Redis is down or `REDIS_URL` is unset, status updates fall back to polling PostgreSQL's `runs.status` column directly. Zero code branching needed — the `redis_client.py` module handles this transparently.

8. **Re-run allowed** — same file uploaded multiple times creates a new `run_id` each time. No deduplication. Re-runs are expected and valid.

---

## ENVIRONMENT CONFIGURATION

```bash
# .env.example

# ── AI Providers ────────────────────────────────────────────────────────────
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-...

# Agent → Provider routing overrides (optional — defaults shown)
# Format: provider:model_id
AGENT_TECHNICAL_PROVIDER=anthropic:claude-sonnet-4-20250514
AGENT_FUNDAMENTAL_PROVIDER=anthropic:claude-sonnet-4-20250514
AGENT_SENTIMENT_PROVIDER=openai:gpt-4o
AGENT_RISK_PROVIDER=anthropic:claude-sonnet-4-20250514
AGENT_MACRO_PROVIDER=openai:gpt-4o
AGENT_CEO_PROVIDER=anthropic:claude-sonnet-4-20250514

# ── Database ─────────────────────────────────────────────────────────────────
DATABASE_URL=postgresql+asyncpg://user:password@localhost:5432/premarket_advisor
REDIS_URL=redis://localhost:6379/0    # Optional — omit to disable Redis state cache

# ── Pipeline ─────────────────────────────────────────────────────────────────
CHUNK_SIZE=5                          # Stocks per chunk (tune based on input size)
AGENT_TIMEOUT_SECONDS=45             # Per-agent AI call timeout
CEO_TIMEOUT_SECONDS=120              # CEO component timeout
MAX_AGENT_RETRIES=3                  # LLMClient retry attempts before fallback

# ── App ──────────────────────────────────────────────────────────────────────
APP_ENV=development                  # development | production
LOG_LEVEL=INFO
CORS_ORIGINS=http://localhost:3000
```

---

## IMPLEMENTATION SEQUENCE

Build in this exact order. Each phase must be independently testable before the next begins.

**Phase 1 — Database & Models**
Set up PostgreSQL + SQLAlchemy async engine. Write Alembic initial migration creating all 4 tables. Initialize Redis client with graceful fallback if `REDIS_URL` is absent. Verify with a simple connection test.

**Phase 2 — Schemas**
Write Pydantic v2 models for: `StockInput`, `AgentBatchResult`, `AgentOutputSchema` (per agent), `FinalResultSchema`, `RunStatusResponse`. These are the contracts every other module depends on.

**Phase 3 — LLMClient ★**
Implement `utils/llm_client.py` with full provider routing, fallback logic, exponential backoff retry, and `LLMResponse` dataclass. **Test in isolation**: mock both provider SDKs, verify fallback triggers on rate limit, verify `was_fallback=True` is recorded correctly.

**Phase 4 — Base Agent**
Implement abstract `BaseAgent` using `LLMClient`. Include YAML parsing, Pydantic validation, and repair-prompt retry. Write a mock concrete agent for testing.

**Phase 5 — Individual Agents**
Implement all 5 agents (`technical`, `fundamental`, `sentiment`, `risk`, `macro`) with their prompts. Unit test each with a mock `LLMClient` returning fixture YAML. Verify `parse_response()` handles malformed output gracefully.

**Phase 6 — Chunker & Merger**
Implement `chunker.py` (splits list by `CHUNK_SIZE`) and `merger.py` (combines all `ChunkResult` objects into one unified YAML string). Test merger with fixture chunk results.

**Phase 7 — Orchestrator ★**
Implement `orchestrator.py` with the two-level parallel pattern (chunks parallel, agents parallel within each chunk). Wire all 5 agents. Integration test with `sample_stocks.yaml` — verify all chunks fire simultaneously (check log timestamps), verify partial failure isolation.

**Phase 8 — CEO Component**
Implement `chief_evaluator.py` with scoring, override rules, ranking, and YAML generation. Test with fixture merged YAML. Verify all override rules trigger correctly (extreme risk cap, double-low floor, catalyst adjustment).

**Phase 9 — Database Persistence**
Wire DB saves at each stage: create Run → create Batches → save AgentResults → save FinalResults → update Run status. Wrap all writes in transactions. Verify rollback on error.

**Phase 10 — FastAPI Routes**
Implement all API endpoints. Wire pipeline as a `BackgroundTask`. Verify status polling works with and without Redis. Test export endpoints (CSV, XLSX).

**Phase 11 — Frontend**
Build Next.js dashboard. Implement `PipelineStatus` polling component. Build results table with expandable rows and provider badges. Implement TOP 3 spotlight section.

**Phase 12 — Docker**
Write `docker-compose.yml` with services: `postgres`, `redis`, `backend`, `frontend`. Write `Dockerfile.backend` and `Dockerfile.frontend`. Verify full stack starts with `docker compose up`.

**Phase 13 — End-to-End Test**
Run complete pipeline with `sample_stocks.yaml` (10 test stocks). Verify: all chunks fired in parallel (timestamps), all 30 agent calls completed, CEO produced ranked output, all DB rows saved correctly, frontend displays results correctly, export produces valid file. Then intentionally break one provider key and verify fallback triggers.

---

## SAMPLE INPUT FOR TESTING

Generate `input_examples/sample_stocks.yaml` with exactly **10 stocks** designed to stress-test the full system:

| Stock | Design Intent |
|---|---|
| Stock 1 | All agents high — clear STRONG_BUY |
| Stock 2 | All agents high but earnings risk — tests catalyst adjustment |
| Stock 3 | Strong tech + fundamental, weak sentiment — mixed signal, BUY |
| Stock 4 | Average across all agents — clean HOLD |
| Stock 5 | Mixed signals, 3 agents disagree — tests confidence scoring |
| Stock 6 | Weak tech + fundamental (<30 each) — triggers SELL override |
| Stock 7 | All agents low — STRONG_SELL |
| Stock 8 | High composite but extreme risk — tests 50-point cap override |
| Stock 9 | Positive earnings catalyst next week, good sentiment — tests +5 bonus |
| Stock 10 | Negative earnings catalyst, deteriorating sentiment — tests −5 penalty |

This set guarantees every override rule, scoring rubric, and edge case is exercised before using real data.

---

## QUALITY GATES

Before marking any phase complete, verify every item below:

**Async correctness**
- [ ] All I/O-bound calls use `async def` and `await`
- [ ] No `time.sleep()` anywhere — only `asyncio.sleep()`
- [ ] No synchronous file reads inside async functions

**Parallel execution**
- [ ] Log timestamps confirm all chunks fire within <100ms of each other (not sequentially)
- [ ] Log timestamps confirm all 5 agents within a chunk fire within <100ms of each other
- [ ] CEO receives results only after ALL chunks complete

**AI reliability**
- [ ] Fallback triggers and records `was_fallback=True` when primary returns 429
- [ ] Repair prompt fires when AI returns malformed YAML
- [ ] Agent timeout fires at exactly `AGENT_TIMEOUT_SECONDS` and triggers isolation

**Data integrity**
- [ ] Every AI response is Pydantic-validated before DB write
- [ ] `provider_used`, `model_used`, `was_fallback` populated on every `agent_results` row
- [ ] All DB writes wrapped in transactions; errors trigger rollback
- [ ] Final results table contains ALL stocks from input — zero silent drops

**Override rules**
- [ ] `risk_level=extreme` caps `final_score` at 50
- [ ] `fund_score < 30 AND tech_score < 30` sets recommendation to SELL minimum
- [ ] Catalyst adjustment of ±5 applies correctly based on sentiment trend

**Infrastructure resilience**
- [ ] Redis down → pipeline continues, status polling falls back to PostgreSQL
- [ ] Both AI providers fail → `PipelineAgentError` raised, agent marked empty, chunk continues

**Frontend**
- [ ] Provider badge visible per agent in expandable row (shows "Anthropic" or "OpenAI")
- [ ] Override indicator (⚠) visible on stocks where `override_applied=true`
- [ ] Meaningful error state shown if run fails (not just a spinner)
- [ ] Export produces a valid, openable file

---

## FIRST STEP

Begin your response with exactly:

> "I have reviewed the full Pre-Market Stock Advisor System specification (v2). Here is my implementation plan..."

Then:
1. Present a numbered plan covering all 13 phases with an estimated complexity rating (Low / Medium / High) per phase
2. List any design decisions where you need clarification before proceeding
3. State any assumptions you are making
4. Begin implementing **Phase 1: Database & Models** immediately after the plan
