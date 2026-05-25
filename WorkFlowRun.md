# How This System Works — A Plain-English Guide

This guide is written for users who want to write prompts, understand what happens when they click "Run", and make sense of what they see in the Audit tab. No technical background needed.

---

## The Big Picture

You give the system a list of stocks. The system sends each stock to several **AI agents** for analysis. Each agent is an expert with a specific job. After all the agents finish, a **CEO agent** reads all their reports, scores each stock, and ranks them. You see the ranked results in the dashboard.

Think of it like hiring a team of analysts. Each analyst reads the same stock data and writes a report from their area of expertise. Then the CEO reads all the reports and makes the final call.

---

## What Is a "Prompt"?

A **prompt** is the instruction you write to tell an AI agent **who it is** and **how to think**.

It is NOT the question the agent will answer. The question is always the same: *"Analyze these stocks and give me scores in the required format."* That part is handled automatically by the system.

Your prompt text defines the agent's **personality, expertise, and priorities**. Examples:

- *"You are a technical analysis expert. Focus on chart patterns, moving averages, and momentum indicators. Be conservative."*
- *"You are a fundamental analyst. Focus on earnings, revenue growth, and P/E ratio."*

**Important rule:** No matter what you write in the prompt, the system will always ask the agent: *"Now analyze these stocks and return your results."* The agent uses your prompt as its lens/mindset, but the task itself never changes.

---

## The Three Layers That Control Every Agent

Understanding these three layers answers the question: *"What can I control with my prompt, and what is fixed in the code?"*

### Layer 1 — Your System Prompt (you control this 100%)

This is the text you write in the Prompts screen. It becomes the AI's **role and identity**. There is no stock-specific text hardcoded here — the AI's personality is entirely what you write.

### Layer 2 — The Task Message (hardcoded, you cannot change it)

No matter what you write in Layer 1, the system **always** automatically sends this message to the AI after your prompt:

> *"Analyze the following N stocks and return the required YAML output: [stock data]"*

This is built into the code and cannot be changed from the UI. The AI always receives the stock data and is always asked to return a structured YAML response. **This is why you can never make an agent answer a completely unrelated question** — the AI always gets the stock task too.

### Layer 3 — The Output Schema (different per agent type)

After the AI responds, the system checks whether the response contains the **required fields**. If required fields are missing → red dot. This is different for each agent type:

**Predefined agents have strict required fields:**

| Agent | Required fields in the YAML response |
|---|---|
| `technical` | `ticker`, `tech_score`, `primary_signal`, `ma_alignment`, `volume_signal`, `key_level_proximity`, `signal_strength`, `reasoning` |
| `fundamental` | `ticker`, `fund_score`, `valuation_verdict`, `growth_quality`, `balance_sheet_health`, `reasoning` |
| `sentiment` | `ticker`, `sentiment_score`, `sentiment_trend`, `catalyst_flag`, `catalyst_type`, `analyst_conviction`, `reasoning` |
| `risk` | `ticker`, `risk_score`, `risk_level`, `beta_assessment`, `volatility_regime`, `reasoning` |
| `macro` | `ticker`, `macro_score`, `sector_stance`, `macro_alignment`, `catalyst_timing`, `reasoning` |

If the AI returns a response that doesn't include these exact fields, validation fails → red dot.

**Custom/child agents have a flexible schema:**

Any agent you create yourself (any child agent, like `mom`, `momentum`, `pattern`) only requires one field: `ticker`. Any other fields the AI includes are accepted. This means you have much more freedom with custom agents — the AI can return whatever fields make sense for the role you defined.

### Summary: What you can and cannot control

| | Can you change it from the UI? |
|---|---|
| The agent's role/personality | ✅ Yes — write your prompt |
| The task message ("analyze these stocks") | ❌ No — hardcoded in the system |
| The required output fields for predefined agents | ❌ No — fixed per agent type |
| The required output fields for custom/child agents | ✅ Flexible — only `ticker` required |

---

## Why "What Is the Date Today?" Didn't Work As Expected

This is the most common point of confusion. When you wrote:

> **Prompt:** `what is the date today?`

You expected the agent to answer that question. But here's what actually happened across the three layers:

- **Layer 1 (your prompt):** The AI received "what is the date today?" as its identity. That's a question, not a role — the AI got confused about who it is.
- **Layer 2 (task message):** The system still sent "Analyze the following 3 stocks and return the required YAML output." The AI followed this because it's the actual instruction.
- **Layer 3 (schema):** Since this was a `technical` agent, the system expected fields like `tech_score`, `primary_signal`, `ma_alignment`, etc. The AI's response didn't contain those fields → red dot.

**The prompt slot is for ROLES, not QUESTIONS.**

A correct prompt that would get a green dot:
> *"You are a technical analysis expert. Your job is to analyze pre-market stock indicators and identify buy, hold, or sell signals based on chart patterns and momentum."*

Now the AI has a clear identity, it still receives and analyzes the stocks, and it returns the expected fields → green dot.

---

## Parent and Child Agents

The system supports a two-level hierarchy: a **parent agent** can have multiple **child agents** underneath it.

### Why would you want this?

Sometimes one topic (like "technical analysis") is complex enough that you want multiple sub-experts to look at it from different angles. You can create children of `technical`, each with their own prompt and focus. They all run at the same time, and their results get combined.

### Two combination modes

**MATH MODE** (automatic averaging):
- Used when the parent's prompt is **empty or blank**.
- The system runs all the children, takes their numeric scores, and averages them (using the weight you set for each child).
- No extra LLM call is made for the parent.
- Best for: simple cases where you want to blend scores.

**JUDGE MODE** (parent reviews children):
- Used when the parent has a **non-empty prompt**.
- Step 1: All children run and produce their results.
- Step 2: The parent agent gets a summary of ALL children's results and is asked to synthesize them into one final verdict.
- An extra LLM call is made — the parent reads the children's work.
- Best for: cases where you want an expert to review and decide, not just average.

---

## Example 1 — Stock Trading (Real Use Case)

**Setup:**
- Parent: `technical` — prompt: *"You are a technical analysis expert specializing in pre-market conditions."*
- Child 1: `momentum` — prompt: *"You are a momentum analyst. Focus on RSI, MACD, and volume spikes."* Weight: 60%
- Child 2: `pattern` — prompt: *"You are a chart pattern specialist. Focus on support/resistance levels and breakout signals."* Weight: 40%

**When the user clicks Run with stocks AAPL, TSLA, NVDA:**

```
Step 1 — Children run in parallel (at the same time)

  momentum → reads AAPL, TSLA, NVDA data
           → AI thinks: "As a momentum analyst, I will look at RSI..."
           → Returns: AAPL score 72, TSLA score 45, NVDA score 88

  pattern  → reads AAPL, TSLA, NVDA data
           → AI thinks: "As a chart pattern specialist, I will look at breakouts..."
           → Returns: AAPL score 65, TSLA score 70, NVDA score 80

Step 2 — Parent (judge mode, because it has a non-empty prompt) reviews both:

  technical → receives a summary:
              "momentum said: AAPL=72, TSLA=45, NVDA=88
               pattern  said: AAPL=65, TSLA=70, NVDA=80"
           → AI thinks: "As a technical expert, considering both views..."
           → Final output: AAPL=68, TSLA=57, NVDA=84 (with reasoning)

Step 3 — CEO reads outputs from technical, fundamental, sentiment, risk, macro
       → Applies scoring weights
       → Ranks: #1 NVDA, #2 AAPL, #3 TSLA
       → You see the ranked table
```

**What you see in the Audit tab:**
- `technical` column shows the parent's final verdict (judge result)
- `↳ momentum` column shows what the momentum child said
- `↳ pattern` column shows what the pattern child said
- Clicking any cell shows the prompt used and the response received

---

## Example 2 — Restaurant Reviews (Non-Stock)

*This example shows the same concept in a different setting to help you understand how parent-child works.*

**Imagine you built a restaurant review app using this system.**

**Setup:**
- Parent: `head_reviewer` — prompt: *"You are a senior food critic. After reading your sub-reviewers' reports, write a final verdict and star rating."*
- Child 1: `food_critic` — prompt: *"You are a food quality expert. Focus on taste, freshness, and presentation."* Weight: 50%
- Child 2: `service_critic` — prompt: *"You are a hospitality expert. Focus on wait time, staff friendliness, and cleanliness."* Weight: 50%

**When analysis runs for restaurants: Pasta Palace, Burger Barn:**

```
Step 1 — Children run in parallel

  food_critic    → reads Pasta Palace data
                 → AI thinks: "As a food quality expert..."
                 → Returns: Pasta Palace food score 90, Burger Barn food score 55

  service_critic → reads same restaurant data
                 → AI thinks: "As a hospitality expert..."
                 → Returns: Pasta Palace service score 60, Burger Barn service score 85

Step 2 — Parent (judge mode) reviews:

  head_reviewer  → receives summary of both reports
                 → AI thinks: "As a senior food critic, Pasta Palace has great food
                               but poor service. Burger Barn is the opposite..."
                 → Final: Pasta Palace ★★★★ (great food wins), Burger Barn ★★★

Step 3 — Final ranking output is displayed
```

**If instead you left `head_reviewer` prompt empty (math mode):**
- No extra LLM call
- System just averages: Pasta Palace = (90+60)/2 = 75, Burger Barn = (55+85)/2 = 70
- Pasta Palace wins by math alone, no interpretation

---

## Example 3 — Wrong Prompt vs. Right Prompt (Same Idea, Different Results)

*Two versions of a "date/timing" agent — one that fails and one that works.*

---

### Version A: Wrong prompt → Red dots

**Setup:**
- Child agent `timing` under `technical`
- Prompt: `what is the date today?`

```
Layer 1 — AI receives: "what is the date today?" as its role
Layer 2 — AI also receives: "Analyze NORM, EXRK, WEAK and return YAML"
Layer 3 — Schema expects: ticker + any fields (flexible for child agents)

What happens:
  The AI is confused. Its "role" is a question with no clear identity.
  It tries to answer the stock task but may produce inconsistent output.
  Even if it returns YAML, it might look like:
    - ticker: NORM
      date: 2026-05-25     ← this field is fine for a child agent
      analysis: unclear    ← but if the AI rambles, YAML may be malformed

Result: Red dot — the AI's response couldn't be parsed reliably.
```

---

### Version B: Correct prompt → Green dots

**Setup:**
- Same child agent `timing` under `technical`
- Prompt: *"You are a market timing specialist. For each stock, analyze how the current day of week, pre-market hours, and time-of-year factors affect its trading setup. Return a `market_timing` field (favorable/neutral/unfavorable) and a `timing_reason` field explaining your verdict."*

```
Layer 1 — AI receives a clear role: market timing specialist
Layer 2 — AI also receives: "Analyze NORM, EXRK, WEAK and return YAML"
Layer 3 — Schema expects: ticker + any fields (flexible for child agents)

What happens:
  The AI has a clear identity AND a clear task.
  It analyzes each stock through a timing lens and returns:
    - ticker: NORM
      market_timing: favorable
      timing_reason: "Monday pre-market typically shows higher volume for..."
    - ticker: EXRK
      market_timing: neutral
      timing_reason: "Mid-week with no major catalyst..."

Result: Green dot — valid YAML with ticker + custom fields → accepted.
```

**Key insight:** For child agents (flexible schema), you can invent any fields you want — as long as your prompt clearly describes them so the AI knows what to return. The AI needs to know both **who it is** and **what fields to put in the YAML**. Include both in your prompt.

---

## Summary: The Rules of Prompts

| Rule | Example |
|---|---|
| Write the agent's ROLE, not a question | "You are a technical analyst..." |
| The TASK (analyze stocks) is always automatic | You don't write this — it's built in |
| Parent with a prompt → Judge mode | Parent reads children's work, makes final call |
| Parent with empty prompt → Math mode | System averages children's scores automatically |
| One LLM call covers all stocks in a batch | One response for 5 stocks, not 5 separate calls |
| Red dot in Audit = response could not be parsed | Usually means the prompt confused the AI |

---

## What You See in the Audit Tab

The Audit tab is your "flight recorder". After a run, you can:

- **Click a run** → see a matrix: rows = stocks, columns = agents
- **Green dot** = agent returned valid, parseable output
- **Red dot** = agent ran but its response couldn't be parsed (usually a prompt issue)
- **Click any cell** → see:
  - **Prompt tab**: the exact text sent as the agent's identity/role
  - **Response tab**: the raw text the AI returned (covers all stocks in that batch)
  - **Parsed Output tab**: the structured data extracted from the response

Child agents appear in the matrix with a `↳` symbol in their column header, immediately after their parent agent.

---

## Quick Reference: Who Does What

| Agent | Its Job |
|---|---|
| `technical` | Chart patterns, RSI, MACD, moving averages |
| `fundamental` | Earnings, P/E ratio, revenue, balance sheet |
| `sentiment` | News, social media mood, analyst ratings |
| `risk` | Volatility, beta, downside exposure |
| `macro` | Interest rates, sector trends, macro economy |
| `ceo` | Reads all agents' outputs, scores and ranks every stock |
| Children of any agent | Sub-specialist lenses feeding into their parent |
