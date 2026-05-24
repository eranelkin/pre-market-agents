const BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3301";

export interface RunSummary {
  session_id: string;
  run_id: string;
  process_id: string;
  model_variant_id: string;
  test_mode: boolean;
  status: string;
  total_stocks: number;
  started_at: string;
  completed_at: string | null;
  duration_seconds: number | null;
}

export interface RunProgress {
  total_chunks: number;
  chunks_completed: number;
  total_stocks: number;
  stage: string;
}

export interface RunStatus {
  run_id: string;
  session_id: string;
  model_variant_id: string;
  status: string;
  error_message: string | null;
  progress: RunProgress | null;
}

export interface FinalResultItem {
  ticker: string;
  final_score: number;
  rank: number;
  recommendation: string;
  confidence: number;
  technical_score: number | null;
  fundamental_score: number | null;
  sentiment_score: number | null;
  risk_score: number | null;
  macro_score: number | null;
  override_applied: boolean;
  override_reason: string | null;
  conflicting_signals: string[];
  ceo_rationale: string | null;
}

export interface Top3Pick {
  ticker: string;
  rank: number;
  entry_rationale: string;
}

export interface RedFlag {
  ticker: string;
  reason: string;
}

export interface RunResults {
  run_id: string;
  session_id: string;
  model_variant_id: string;
  provider_used: string | null;
  model_used: string | null;
  total_stocks: number;
  results: FinalResultItem[];
  top_3_picks: Top3Pick[];
  red_flags: RedFlag[];
}

export interface AgentBreakdown {
  ticker: string;
  run_id: string;
  agents: Record<string, {
    provider_used: string;
    model_used: string;
    was_fallback: boolean;
    web_search_used: boolean;
    tokens_used: number | null;
    latency_ms: number | null;
    [key: string]: unknown;
  }>;
}

export interface VariantSnapshot {
  variant_id: string;
  rank: number;
  final_score: number;
  recommendation: string;
  confidence: number;
}

export interface ComparisonItem {
  ticker: string;
  variant_results: Record<string, VariantSnapshot>;
  recommendation_agreement: boolean;
  max_rank_diff: number;
  max_score_diff: number;
  consensus_recommendation: string | null;
}

export interface ComparisonOutput {
  session_id: string;
  process_id: string;
  variant_ids: string[];
  stocks: ComparisonItem[];
}

export interface StartRunResponse {
  session_id: string;
  process_id: string;
  run_ids: Record<string, string>;
  total_stocks: number;
  active_variants: string[];
  status: string;
}

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, init);
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`${res.status}: ${text}`);
  }
  return res.json() as Promise<T>;
}

function withMode(path: string, testMode?: boolean) {
  if (!testMode) return path;
  return `${path}${path.includes("?") ? "&" : "?"}test_mode=true`;
}

export interface VariantDetail {
  id: string;
  label: string;
  provider: string;
  model: string;
  max_tokens: number;
  base_url: string | null;
  status: "ready" | "no_key";
  active: boolean;
}

export interface ModelPreset {
  id: string;
  label: string;
  provider: string;
  model: string;
  max_tokens: number;
  tier: "free" | "cheap" | "paid";
  description: string;
  already_added: boolean;
}

export interface AddVariantPayload {
  id: string;
  label: string;
  provider: string;
  model: string;
  max_tokens: number;
  api_key?: string;
  set_active: boolean;
}

export interface TestConnectionResult {
  status: "ok" | "error";
  latency_ms: number | null;
  message: string | null;
}

export interface ChildPromptInfo {
  agent_name: string;
  file_path: string;
  content: string;
  last_modified: string | null;
  char_count: number;
  active: boolean;
  child_weight: number | null;
}

export interface PromptInfo {
  agent_name: string;
  file_path: string;
  content: string;
  last_modified: string | null;
  char_count: number;
  is_system: boolean;
  active: boolean;
  weight: number;
  children: ChildPromptInfo[];
}

export interface CreatePromptPayload {
  agent_name: string;
  weight: number;
  content: string;
  default_variant?: string;
}

export interface CreateChildPromptPayload {
  agent_name: string;
  child_weight?: number | null;
  content: string;
}

export interface ModelsResponse {
  variants: VariantDetail[];
  providers: Record<string, { api_key_env: string; base_url: string | null; supports_tool_use: boolean; supports_built_in_search: boolean }>;
  active_variants: string[];
}

export interface AuditEntry {
  result_id: string;
  run_id: string;
  session_id: string;
  model_variant_id: string;
  agent_name: string;
  ticker: string;
  provider_used: string | null;
  model_used: string | null;
  was_fallback: boolean;
  web_search_used: boolean;
  tokens_used: number | null;
  latency_ms: number | null;
  raw_prompt: string | null;
  raw_response: string | null;
  parsed_output: Record<string, unknown> | null;
  created_at: string;
}

export interface AuditResponse {
  total: number;
  entries: AuditEntry[];
}

export const api = {
  listRuns: (page = 1, pageSize = 20) =>
    apiFetch<RunSummary[]>(`/api/v1/runs?page=${page}&page_size=${pageSize}`),

  getRunStatus: (runId: string) =>
    apiFetch<RunStatus>(`/api/v1/run/${runId}/status`),

  getResults: (runId: string) =>
    apiFetch<RunResults>(`/api/v1/run/${runId}/results`),

  getAgentBreakdown: (runId: string, ticker: string) =>
    apiFetch<AgentBreakdown>(`/api/v1/run/${runId}/agents/${ticker}`),

  getComparison: (sessionId: string) =>
    apiFetch<ComparisonOutput>(`/api/v1/compare/${sessionId}`),

  startRun: (file: File, chunkSize: number = 5, testMode: boolean = false) => {
    const form = new FormData();
    form.append("file", file);
    form.append("chunk_size", String(chunkSize));
    form.append("test_mode", String(testMode));
    return apiFetch<StartRunResponse>("/api/v1/run", { method: "POST", body: form });
  },

  cancelRun: (runId: string) =>
    apiFetch<{ status: string; run_id: string }>(`/api/v1/run/${runId}/cancel`, { method: "POST" }),

  deleteRun: (runId: string) =>
    apiFetch<{ status: string; run_id: string }>(`/api/v1/run/${runId}`, { method: "DELETE" }),

  exportCsv: (runId: string) =>
    `${BASE}/api/v1/run/${runId}/results/export`,

  sseUrl: (runId: string) =>
    `${BASE}/api/v1/run/${runId}/stream`,

  // ── Model management ──────────────────────────────────────────────────────
  getVariants: (testMode?: boolean) => apiFetch<ModelsResponse>(withMode("/api/v1/models", testMode)),

  getPresets: () => apiFetch<ModelPreset[]>("/api/v1/models/presets"),

  addVariant: (body: AddVariantPayload) =>
    apiFetch<{ status: string; variant_id: string }>("/api/v1/models/variants", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),

  deleteVariant: (id: string) =>
    apiFetch<{ status: string }>(`/api/v1/models/variants/${id}`, { method: "DELETE" }),

  toggleVariantActive: (id: string, active: boolean, testMode?: boolean) =>
    apiFetch<{ status: string; active_variants: string[] }>(
      withMode(`/api/v1/models/variants/${id}/active`, testMode),
      { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ active }) }
    ),

  testVariant: (id: string) =>
    apiFetch<TestConnectionResult>(`/api/v1/models/variants/${id}/test`, { method: "POST" }),

  // ── Prompt management ─────────────────────────────────────────────────────
  listPrompts: (testMode?: boolean) => apiFetch<PromptInfo[]>(withMode("/api/v1/prompts", testMode)),

  createPrompt: (payload: CreatePromptPayload, testMode?: boolean) =>
    apiFetch<{ status: string; agent_name: string; prompt_file: string }>(
      withMode("/api/v1/prompts", testMode),
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }
    ),

  updatePrompt: (agentName: string, content: string, testMode?: boolean) =>
    apiFetch<{ status: string; agent_name: string; char_count: number }>(
      withMode(`/api/v1/prompts/${agentName}`, testMode),
      { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ content }) }
    ),

  togglePromptActive: (agentName: string, active: boolean, testMode?: boolean) =>
    apiFetch<{ status: string; agent_name: string; active: boolean }>(
      withMode(`/api/v1/prompts/${agentName}/active`, testMode),
      { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ active }) }
    ),

  deletePrompt: (agentName: string, testMode?: boolean) =>
    apiFetch<{ status: string; agent_name: string }>(
      withMode(`/api/v1/prompts/${agentName}`, testMode),
      { method: "DELETE" }
    ),

  createChildPrompt: (parentName: string, payload: CreateChildPromptPayload, testMode?: boolean) =>
    apiFetch<{ status: string; agent_name: string; parent: string; prompt_file: string }>(
      withMode(`/api/v1/prompts/${parentName}/children`, testMode),
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }
    ),

  reloadPrompts: () =>
    apiFetch<{ status: string; agents: Record<string, boolean> }>("/api/v1/prompts/reload", { method: "POST" }),

  // ── Audit log ─────────────────────────────────────────────────────────────
  getAuditLog: (params: {
    run_id?: string;
    agent_name?: string;
    ticker?: string;
    status?: string;
    test_mode?: boolean;
    limit?: number;
    offset?: number;
  }) => {
    const qs = new URLSearchParams(
      Object.fromEntries(
        Object.entries(params)
          .filter(([, v]) => v != null && v !== "")
          .map(([k, v]) => [k, String(v)])
      )
    ).toString();
    return apiFetch<AuditResponse>(`/api/v1/audit${qs ? `?${qs}` : ""}`);
  },

  // ── Pipeline settings ──────────────────────────────────────────────────────
  getPipelineSettings: () =>
    apiFetch<{ ceo_autonomous: boolean; chunk_size: number; compare_when_multiple: boolean }>("/api/v1/pipeline/settings"),

  setCeoAutonomous: (enabled: boolean) =>
    apiFetch<{ status: string; ceo_autonomous: boolean }>(
      "/api/v1/pipeline/ceo-autonomous",
      { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ enabled }) }
    ),
};
