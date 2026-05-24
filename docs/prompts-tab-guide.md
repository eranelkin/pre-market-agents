# Prompts Tab — User Guide

This guide explains how to use the **Prompts** tab. No technical knowledge required.

---

## What the Prompts Tab Does

Every time the system analyses stocks, it uses AI agents. Each agent reads a **prompt** — a set of written instructions that tells it what to look for and how to respond.

The Prompts tab is where you write and manage those instructions.

---

## The Two Inner Tabs

At the top of the page you will see two tabs: **System** and **Agents**.

---

### System Tab

This tab controls the built-in agents that always exist. You cannot create or delete them, but you can edit their prompts.

#### CEO Autonomous Scoring (toggle at the top)

This switch changes how the final stock ranking is calculated.

| Setting | What happens |
|---|---|
| **ON** | The CEO agent decides all final scores and rankings on its own, using its own judgment. |
| **OFF** | Final scores are calculated automatically using fixed weights (Technical 30%, Fundamental 25%, Sentiment 20%, Risk 15%, Macro 10%). |

**Which should you use?**
- Use **OFF** if you want predictable, rule-based scoring.
- Use **ON** if you want the AI to reason freely about which stocks are best.

#### System Agents Table

Below the CEO toggle you will see a table of the built-in agents:

| Agent | What it analyses |
|---|---|
| **Technical** | Price patterns, moving averages, momentum |
| **Fundamental** | Earnings, revenue, financials |
| **Sentiment** | News tone, market mood |
| **Risk** | Volatility, downside danger |
| **Macro** | Broader economic conditions |
| **CEO Evaluator** | Combines all results into a final ranked list |

To edit any system agent's prompt, click the **pencil icon** on the right of its row.

> **Note:** System agents cannot be turned off or deleted.

---

### Agents Tab

This is where you create and manage your own custom agents.

#### The Table

Each row is one custom agent you have created. Columns are:

- **Agent** — The name you gave it. A purple **custom** badge means it is yours. A blue badge (e.g. **2 sub-agents**) means it has children underneath it.
- **Prompt** — A preview of the first line of the agent's instructions.
- **Active** — Toggle switch. When **ON**, the agent runs during analysis. When **OFF**, it is skipped entirely.
- **Actions** — Pencil icon (edit prompt) and trash icon (delete agent).

#### The Chevron (▶)

If an agent has sub-agents, a small arrow appears to the left of its row. Click it to expand and see its children. Click again to collapse.

---

## Creating a New Agent

Click the **+ New Agent** button in the top-right corner of the page.

A dialog box will open with three fields:

**1. Agent name** *(required)*
- Use only lowercase letters, numbers, and underscores.
- Example: `momentum`, `volume_spike`, `earnings_beat`
- The name becomes the score field in results (e.g. `momentum_score`).

**2. Weight** *(required for top-level agents)*
- A number between 0 and 1.
- This controls how much influence this agent's score has on the CEO's final ranking.
- Example: `0.10` means this agent contributes 10%.
- Start small. All your custom agents' weights should add up alongside the system agents.

**3. Prompt content** *(optional for top-level agents)*
- The instructions you write for this agent.
- **Leave blank** if this agent will use sub-agents and average their scores automatically.
- **Fill in** if this agent will act as a judge that synthesises its sub-agents' results (see below).

Click **Create Agent** when done.

---

## Adding Sub-Agents (Children)

A top-level agent can have sub-agents beneath it. This lets you break a complex analysis into smaller, specialised pieces that run in parallel.

To add a sub-agent:
1. Find the parent agent in the table.
2. Click the **blue circle + icon** to the left of its toggle switch.
3. A dialog opens — fill in the sub-agent's name, weight (optional), and prompt (required).
4. Click **Create Sub-Agent**.

The parent row will now show a blue badge counting its sub-agents. Click the **▶** chevron to expand and see them.

**Sub-agent weight**
- Leave blank to give all sub-agents equal weight.
- Enter a number (e.g. `2`) to give this sub-agent more influence than others.
- Weights are relative. If two sub-agents have weights `1` and `2`, the second one counts twice as much.

---

## Parent + Children: Two Modes

When a parent agent has sub-agents, it can work in one of two ways depending on whether you give the **parent** a prompt.

---

### Mode 1 — Math Mode (no parent prompt)

**When to use:** You want a simple average of your sub-agents' scores.

**How it works:**
1. All sub-agents run in parallel.
2. Their numeric scores are averaged automatically (weighted by each sub-agent's weight).
3. No parent LLM call is made.

**Setup:**
- Give the parent agent **no prompt** (leave the prompt field blank when creating it).
- Write prompts for each sub-agent.

---

### Mode 2 — Judge Mode (parent has a prompt)

**When to use:** You want the parent to read what each sub-agent found and make its own final decision.

**How it works:**
1. All sub-agents run in parallel.
2. When all sub-agents finish, their results are automatically collected.
3. The parent agent runs its own prompt with all sub-agent results injected as context.
4. The parent writes the final verdict.

**Setup:**
- Give the parent agent **a prompt** (the judge instructions — see below).
- Write prompts for each sub-agent as usual.

---

## How to Write Prompts

Every prompt must tell the agent two things:
1. What to analyse.
2. What format to return the result in.

The system expects agents to return **YAML** — a structured list with specific fields. If the format is wrong, the agent's result is discarded.

---

### Sub-Agent Prompt Template

Use this as your starting point for every sub-agent:

```
You are a [describe the agent's specialty] analyst.

For each stock provided, analyse [what to look at] and return YAML:

- ticker: TICKER
  [agent_name]_score: 50
  primary_signal: neutral
  reasoning: "One or two sentences explaining your conclusion."

Rules:
- Score range: 0 (worst) to 100 (best).
- primary_signal must be one of: bullish, bearish, neutral.
- Return only valid YAML. No extra text. No markdown.
```

**Replace:**
- `[describe the agent's specialty]` with what this agent does (e.g. "price momentum")
- `[what to look at]` with what data to focus on
- `[agent_name]_score` with your agent's actual name (e.g. `momentum_score`)

**Example — a momentum sub-agent:**

```
You are a price momentum analyst.

For each stock provided, analyse short-term price trends, moving average crossovers,
and rate of change indicators. Return YAML:

- ticker: TICKER
  momentum_score: 50
  primary_signal: neutral
  reasoning: "Brief explanation of momentum signals observed."

Rules:
- Score range: 0 (worst) to 100 (best).
- primary_signal must be one of: bullish, bearish, neutral.
- Return only valid YAML. No extra text. No markdown.
```

---

### Parent Prompt Template — Judge Mode

Use this when the parent agent needs to synthesise its sub-agents' results:

```
You are a synthesis analyst. Your sub-agents have already analysed the stocks.
Their results are provided below as context.

Weigh each sub-agent's findings according to its weight. Then return your final
verdict for each stock in YAML:

- ticker: TICKER
  [parent_name]_score: 50
  primary_signal: neutral
  reasoning: "Your synthesised judgment, referencing sub-agent findings."

Rules:
- Score range: 0 (worst) to 100 (best).
- primary_signal must be one of: bullish, bearish, neutral.
- Return only valid YAML. No extra text. No markdown.
```

**Replace** `[parent_name]_score` with your parent agent's name (e.g. `technical_score`).

> The sub-agents' results are injected automatically — you do not need to mention them by name in the prompt. The system handles this.

---

## Activating and Deactivating Agents

Every agent has a toggle switch in the **Active** column.

| Toggle | What happens |
|---|---|
| **ON** | Agent runs during the next analysis. |
| **OFF** | Agent is skipped. Its score will be missing from results. |

**Important rules:**
- If you turn a **parent** agent off, all its **sub-agents are automatically skipped too**. Their rows will appear grey and dimmed.
- Turning the parent back **ON** restores its sub-agents.
- You can turn individual sub-agents off without affecting the parent or sibling sub-agents.

---

## Editing a Prompt

1. Find the agent in the table.
2. Click the **pencil icon** on the right of its row.
3. Edit the text in the box that appears.
4. Click **Save**.

Changes take effect immediately — no restart required.

---

## Deleting an Agent

1. Find the agent in the table.
2. Click the **trash icon** on the right of its row.
3. A confirm link appears. Click **Confirm** to delete, or **Cancel** to go back.

> **Warning:** Deleting a parent agent also deletes all its sub-agents. This cannot be undone.

System agents (Technical, Fundamental, Sentiment, Risk, Macro, CEO) cannot be deleted.

---

## Quick Reference

| What you want | How to do it |
|---|---|
| Edit a system agent prompt | System tab → pencil icon |
| Create a custom agent | + New Agent button |
| Add a sub-agent to an agent | Blue + icon left of the toggle |
| See sub-agents | Click ▶ chevron on parent row |
| Turn an agent on/off | Toggle switch in the Active column |
| Edit a custom agent's prompt | Pencil icon on its row |
| Delete a custom agent | Trash icon → Confirm |
| Simple average of sub-agents | Leave parent prompt blank (Math Mode) |
| Parent decides final verdict | Give parent a prompt (Judge Mode) |
