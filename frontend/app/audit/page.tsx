"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, AuditEntry, RunSummary } from "@/lib/api";
import { StatusBadge } from "@/components/StatusBadge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const TEXT = "#D7DFE7";

// Known agents in preferred display order; any other name falls after these.
const KNOWN_ORDER = [
  "technical",
  "fundamental",
  "sentiment",
  "risk",
  "macro",
  "ceo",
];

const AGENT_COLORS: Record<string, string> = {
  technical: "bg-blue-500/15 text-blue-400",
  fundamental: "bg-purple-500/15 text-purple-400",
  sentiment: "bg-green-500/15 text-green-400",
  risk: "bg-red-500/15 text-red-400",
  macro: "bg-orange-500/15 text-orange-400",
  ceo: "bg-yellow-500/15 text-yellow-400",
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function AgentBadge({ name }: { name: string }) {
  const cls = AGENT_COLORS[name] ?? "bg-gray-500/15 text-gray-400";
  return (
    <span className={`rounded px-2 py-0.5 text-xs font-medium ${cls}`}>
      {name}
    </span>
  );
}

function latencyStyle(ms: number | null): string {
  if (ms === null) return TEXT;
  if (ms < 2000) return "#34d399";
  if (ms < 5000) return "#fbbf24";
  return "#f87171";
}

function fmtDuration(s: number | null) {
  if (s == null) return "—";
  const m = Math.floor(s / 60);
  const sec = Math.round(s % 60);
  return m ? `${m}m ${sec}s` : `${sec}s`;
}

function fmtDateTime(iso: string) {
  const d = new Date(iso);
  return {
    date: d.toLocaleDateString(undefined, { month: "short", day: "numeric" }),
    time: d.toLocaleTimeString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
    }),
  };
}

function cellStatus(entry: AuditEntry): "ok" | "fallback" | "error" {
  if (entry.parsed_output === null) return "error";
  if (entry.was_fallback) return "fallback";
  return "ok";
}

/** Build a sorted list of all agent names found in entries.
 *  Known agents come first (in KNOWN_ORDER), children follow their parent immediately,
 *  then custom top-level agents alphabetically with their children after each. */
function activeAgentsFrom(entries: AuditEntry[]): string[] {
  const parentOf = new Map<string, string>();
  entries.forEach((e) => {
    if (e.parent_agent_name) parentOf.set(e.agent_name, e.parent_agent_name);
  });
  const all = new Set(entries.map((e) => e.agent_name));

  const ordered: string[] = [];
  for (const known of KNOWN_ORDER) {
    if (all.has(known)) {
      ordered.push(known);
      const children = [...all].filter((a) => parentOf.get(a) === known).sort();
      children.forEach((c) => { ordered.push(c); all.delete(c); });
      all.delete(known);
    }
  }
  // Remaining custom top-level agents (not children) + their children
  const topLevel = [...all].filter((a) => !parentOf.has(a)).sort();
  for (const tl of topLevel) {
    ordered.push(tl);
    [...all].filter((a) => parentOf.get(a) === tl).sort().forEach((c) => {
      ordered.push(c);
      all.delete(c);
    });
    all.delete(tl);
  }
  return ordered;
}

type MatrixData = {
  tickers: string[];
  matrix: Record<string, Record<string, AuditEntry | null>>;
};

function buildMatrix(entries: AuditEntry[], agentCols: string[]): MatrixData {
  const tickerSet = new Set<string>();
  const matrix: Record<string, Record<string, AuditEntry | null>> = {};

  for (const e of entries) {
    tickerSet.add(e.ticker);
    if (!matrix[e.ticker]) matrix[e.ticker] = {};
    matrix[e.ticker][e.agent_name] = e;
  }

  const tickers = Array.from(tickerSet).sort();
  for (const t of tickers) {
    for (const a of agentCols) {
      if (!(a in matrix[t])) matrix[t][a] = null;
    }
  }

  return { tickers, matrix };
}

// ── Level 3: Detail modal ─────────────────────────────────────────────────────

type DetailTab = "prompt" | "response" | "parsed";

function DetailModal({
  entry,
  onClose,
}: {
  entry: AuditEntry;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<DetailTab>("response");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const content =
    tab === "prompt"
      ? (entry.raw_prompt ?? "No prompt recorded.")
      : tab === "response"
        ? (entry.raw_response ?? "No response recorded.")
        : entry.parsed_output
          ? JSON.stringify(entry.parsed_output, null, 2)
          : "No parsed output (validation failed or call errored).";

  const { date, time } = fmtDateTime(entry.created_at);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-5xl rounded-xl border border-[#2a2a2a] bg-[#111111] shadow-2xl flex flex-col h-[75vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between px-6 py-4 border-b border-[#2a2a2a] flex-none">
          <div>
            <h2 className="text-base font-semibold" style={{ color: TEXT }}>
              <AgentBadge name={entry.agent_name} />
              <span className="ml-2 font-mono">{entry.ticker}</span>
              <span className="text-muted-foreground font-normal ml-2 text-sm">
                · {date} {time}
              </span>
            </h2>
            <p
              className="text-xs mt-1.5"
              style={{ color: TEXT, opacity: 0.65 }}
            >
              {entry.model_used ?? "—"} via {entry.provider_used ?? "—"} ·{" "}
              {entry.latency_ms != null
                ? `${entry.latency_ms.toLocaleString()}ms`
                : "—"}{" "}
              ·{" "}
              {entry.tokens_used != null
                ? `${entry.tokens_used.toLocaleString()} tokens`
                : "—"}{" "}
              · variant: {entry.model_variant_id}
              {entry.was_fallback && (
                <span className="ml-2 text-amber-400">↩ fallback</span>
              )}
            </p>
          </div>
          <button
            onClick={onClose}
            style={{ color: TEXT }}
            className="opacity-60 hover:opacity-100 transition-opacity text-lg leading-none ml-4"
          >
            ✕
          </button>
        </div>

        {/* Tab switcher */}
        <div className="flex gap-1 px-6 pt-3 pb-2 border-b border-[#2a2a2a] flex-none">
          {(["prompt", "response", "parsed"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className="px-3 py-1 rounded text-sm transition-colors"
              style={{
                color: tab === t ? "#60a5fa" : TEXT,
                backgroundColor:
                  tab === t ? "rgba(96, 165, 250, 0.12)" : "transparent",
                fontWeight: tab === t ? 500 : 400,
              }}
            >
              {t === "prompt"
                ? "Prompt"
                : t === "response"
                  ? "Response"
                  : "Parsed Output"}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto min-h-0 p-6">
          <pre
            className="font-mono text-xs whitespace-pre-wrap break-all leading-relaxed"
            style={{ color: TEXT }}
          >
            {content}
          </pre>
        </div>
      </div>
    </div>
  );
}

// ── Level 2: Matrix cell ───────────────────────────────────────────────────────

function MatrixCell({
  entry,
  onClick,
}: {
  entry: AuditEntry | null;
  onClick?: () => void;
}) {
  if (!entry) {
    return (
      <TableCell className="text-center">
        <span className="text-muted-foreground text-xs">—</span>
      </TableCell>
    );
  }

  const status = cellStatus(entry);
  const dotColor =
    status === "ok"
      ? "bg-emerald-400"
      : status === "fallback"
        ? "bg-amber-400"
        : "bg-red-400";

  return (
    <TableCell className="text-center p-1">
      <button
        onClick={onClick}
        className="flex flex-col items-center gap-0.5 py-2 px-3 rounded hover:bg-[#1e1e1e] transition-colors w-full"
        title={`${entry.agent_name} · ${entry.ticker} · ${status}`}
      >
        <span className={`w-2 h-2 rounded-full ${dotColor}`} />
        <span
          className="text-[10px] font-mono"
          style={{ color: latencyStyle(entry.latency_ms) }}
        >
          {entry.latency_ms != null ? `${entry.latency_ms}ms` : "—"}
        </span>
        {entry.web_search_used && (
          <span className="text-[9px] text-blue-400">web</span>
        )}
      </button>
    </TableCell>
  );
}

// ── Level 2: Run drawer ────────────────────────────────────────────────────────

function RunDrawer({
  run,
  entries,
  loading,
  error,
  onClose,
  onCellClick,
}: {
  run: RunSummary;
  entries: AuditEntry[];
  loading: boolean;
  error: string | null;
  onClose: () => void;
  onCellClick: (entry: AuditEntry) => void;
}) {
  const { date, time } = fmtDateTime(run.started_at);

  const totalTokens = entries.reduce((s, e) => s + (e.tokens_used ?? 0), 0);
  const latencies = entries
    .filter((e) => e.latency_ms !== null)
    .map((e) => e.latency_ms!);
  const avgLatency = latencies.length
    ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length)
    : null;
  const errorCount = entries.filter((e) => e.parsed_output === null).length;

  // All agents found in this run, known ones first, then custom/child agents
  const activeAgents = activeAgentsFrom(entries);
  const { tickers, matrix } = buildMatrix(entries, activeAgents);
  const parentOf = new Map(
    entries.flatMap((e) =>
      e.parent_agent_name ? [[e.agent_name, e.parent_agent_name]] : []
    )
  );

  return (
    <div
      className="flex flex-col border-l border-[#2a2a2a] bg-[#111111] h-full overflow-hidden"
      style={{ width: "75%" }}
    >
      {/* Header */}
      <div className="flex-none px-6 py-4 border-b border-[#2a2a2a] space-y-3">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3 flex-wrap">
            <span
              className="font-mono text-sm font-semibold"
              style={{ color: TEXT }}
            >
              {run.process_id}
            </span>
            <StatusBadge status={run.status} />
            {run.test_mode && (
              <span className="rounded px-2 py-0.5 text-xs font-medium bg-amber-500/15 text-amber-400">
                test
              </span>
            )}
            <span className="text-xs" style={{ color: TEXT, opacity: 0.55 }}>
              {date} · {time}
            </span>
          </div>
          <button
            onClick={onClose}
            style={{ color: TEXT }}
            className="opacity-50 hover:opacity-100 transition-opacity text-base leading-none flex-none"
          >
            ✕
          </button>
        </div>

        <div
          className="flex items-center gap-4 text-xs"
          style={{ color: TEXT, opacity: 0.6 }}
        >
          <span className="font-mono">{run.model_variant_id}</span>
          <span>·</span>
          <span>{run.total_stocks} stocks</span>
          <span>·</span>
          <span>{fmtDuration(run.duration_seconds)}</span>
        </div>

        {!loading && entries.length > 0 && (
          <div className="flex gap-3">
            {[
              {
                label: "Total tokens",
                value: totalTokens.toLocaleString(),
                color: TEXT,
              },
              {
                label: "Avg latency",
                value:
                  avgLatency != null ? `${avgLatency.toLocaleString()}ms` : "—",
                color: latencyStyle(avgLatency),
              },
              {
                label: "Errors",
                value: String(errorCount),
                color: errorCount > 0 ? "#f87171" : "#34d399",
              },
            ].map(({ label, value, color }) => (
              <div
                key={label}
                className="bg-[#1a1a1a] rounded px-3 py-2 flex-1"
              >
                <div
                  className="text-xs opacity-50 mb-0.5"
                  style={{ color: TEXT }}
                >
                  {label}
                </div>
                <div
                  className="text-sm font-mono font-semibold"
                  style={{ color }}
                >
                  {value}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Matrix */}
      {loading ? (
        <div className="flex-1 flex items-center justify-center">
          <span className="text-sm text-muted-foreground animate-pulse">
            Loading run data…
          </span>
        </div>
      ) : error ? (
        <div className="flex-1 flex items-center justify-center">
          <span className="text-sm text-red-400">{error}</span>
        </div>
      ) : entries.length === 0 ? (
        <div className="flex-1 flex items-center justify-center">
          <span className="text-sm text-muted-foreground">
            No agent results found for this run.
          </span>
        </div>
      ) : (
        <div className="flex-1 overflow-auto min-h-0 px-6 py-4">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="sticky top-0 bg-[#111111] z-10">
                <th
                  className="text-left py-2 pr-4 font-medium text-xs sticky left-0 bg-[#111111]"
                  style={{ color: TEXT, opacity: 0.5, minWidth: "70px" }}
                >
                  Ticker
                </th>
                {activeAgents.map((a) => (
                  <th key={a} className="py-2 px-1 text-center">
                    {parentOf.has(a) ? (
                      <span className="flex items-center justify-center gap-1">
                        <span className="text-muted-foreground text-xs opacity-50">↳</span>
                        <AgentBadge name={a} />
                      </span>
                    ) : (
                      <AgentBadge name={a} />
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {tickers.map((ticker) => (
                <tr
                  key={ticker}
                  className="border-t border-[#1e1e1e] hover:bg-[#161616] transition-colors"
                >
                  <td
                    className="py-1 pr-4 font-mono text-sm font-semibold sticky left-0 bg-[#111111]"
                    style={{ color: TEXT }}
                  >
                    {ticker}
                  </td>
                  {activeAgents.map((agent) => (
                    <MatrixCell
                      key={agent}
                      entry={matrix[ticker]?.[agent] ?? null}
                      onClick={() => {
                        const e = matrix[ticker]?.[agent];
                        if (e) onCellClick(e);
                      }}
                    />
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Inner tabs ────────────────────────────────────────────────────────────────

type AuditTab = "production" | "test";

function InnerTabs({
  active,
  onChange,
  productionCount,
  testCount,
}: {
  active: AuditTab;
  onChange: (t: AuditTab) => void;
  productionCount: number;
  testCount: number;
}) {
  const tabs: { id: AuditTab; label: string; count: number }[] = [
    { id: "production", label: "Production", count: productionCount },
    { id: "test", label: "Test runs", count: testCount },
  ];

  return (
    <div className="flex gap-1 border-b border-border px-6">
      {tabs.map((t) => (
        <button
          key={t.id}
          onClick={() => onChange(t.id)}
          className={[
            "flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors",
            active === t.id
              ? "border-blue-500 text-blue-400"
              : "border-transparent hover:border-[#2a2a2a]",
          ].join(" ")}
          style={{ color: active === t.id ? undefined : TEXT }}
        >
          {t.label}
          {t.count > 0 && (
            <span
              className={`rounded-full px-1.5 py-0.5 text-xs font-medium ${
                t.id === "test"
                  ? active === t.id
                    ? "bg-amber-500/20 text-amber-400"
                    : "bg-amber-500/10 text-amber-500"
                  : active === t.id
                    ? "bg-blue-500/20 text-blue-400"
                    : "bg-muted text-muted-foreground"
              }`}
            >
              {t.count}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function AuditPage() {
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [runsLoading, setRunsLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<AuditTab>("production");

  const [selectedRun, setSelectedRun] = useState<RunSummary | null>(null);
  const [runEntries, setRunEntries] = useState<AuditEntry[]>([]);
  const [runEntriesLoading, setRunEntriesLoading] = useState(false);
  const [runEntriesError, setRunEntriesError] = useState<string | null>(null);

  const [selectedEntry, setSelectedEntry] = useState<AuditEntry | null>(null);

  const selectedEntryRef = useRef<AuditEntry | null>(null);
  selectedEntryRef.current = selectedEntry;

  const fetchRuns = useCallback(async () => {
    try {
      const list = await api.listRuns(1, 100);
      setRuns(list);
    } catch {
      // ignore
    } finally {
      setRunsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchRuns();
  }, [fetchRuns]);

  // Clear selected run when switching tabs
  const handleTabChange = (tab: AuditTab) => {
    setActiveTab(tab);
    setSelectedRun(null);
  };

  // Fetch entries when a run is selected
  useEffect(() => {
    if (!selectedRun) {
      setRunEntries([]);
      return;
    }
    let cancelled = false;
    setRunEntriesLoading(true);
    setRunEntriesError(null);
    api
      .getAuditLog({ run_id: selectedRun.run_id, limit: 200 })
      .then((resp) => {
        if (!cancelled) {
          setRunEntries(resp.entries);
          setRunEntriesLoading(false);
        }
      })
      .catch((e) => {
        if (!cancelled) {
          setRunEntriesError(e.message ?? "Failed to load");
          setRunEntriesLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [selectedRun]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (selectedEntryRef.current) return;
      setSelectedRun(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const productionRuns = runs.filter((r) => !r.test_mode);
  const testRuns = runs.filter((r) => r.test_mode);
  const visibleRuns = activeTab === "production" ? productionRuns : testRuns;

  return (
    <main className="fixed inset-0 top-12 bg-background flex flex-col overflow-hidden">
      {/* Page header + inner tabs */}
      <div className="flex-none border-b border-border">
        <div className="px-6 py-4">
          <h1 className="text-xl font-bold tracking-tight" style={{ color: TEXT }}>
            Audit Log
          </h1>
          <p className="text-xs mt-1" style={{ color: TEXT, opacity: 0.55 }}>
            Click a run to inspect every LLM call — prompt, raw response, and parsed output.
          </p>
        </div>
        <InnerTabs
          active={activeTab}
          onChange={handleTabChange}
          productionCount={productionRuns.length}
          testCount={testRuns.length}
        />
      </div>

      {/* Content: runs list + optional drawer */}
      <div className="flex flex-row flex-1 overflow-hidden">
        {/* ── Level 1: Runs list ── */}
        <div
          className="flex flex-col overflow-hidden transition-all duration-200"
          style={{
            width: selectedRun ? "25%" : "80%",
            minWidth: selectedRun ? "220px" : undefined,
            margin: selectedRun ? undefined : "0 auto",
          }}
        >
          <div className="flex-1 overflow-y-auto min-h-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead style={{ color: TEXT }}>Started</TableHead>
                  {!selectedRun && (
                    <TableHead style={{ color: TEXT }}>Process</TableHead>
                  )}
                  {!selectedRun && (
                    <TableHead style={{ color: TEXT }}>Variant</TableHead>
                  )}
                  <TableHead style={{ color: TEXT }}>Status</TableHead>
                  {!selectedRun && (
                    <TableHead className="text-right" style={{ color: TEXT }}>
                      Stocks
                    </TableHead>
                  )}
                  {!selectedRun && (
                    <TableHead className="text-right" style={{ color: TEXT }}>
                      Duration
                    </TableHead>
                  )}
                </TableRow>
              </TableHeader>
              <TableBody>
                {runsLoading ? (
                  <TableRow>
                    <TableCell
                      colSpan={6}
                      className="text-center text-muted-foreground py-12"
                    >
                      Loading…
                    </TableCell>
                  </TableRow>
                ) : visibleRuns.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={6}
                      className="text-center text-muted-foreground py-12"
                    >
                      {activeTab === "test"
                        ? "No test runs yet. Enable Test mode in the NavBar and run the pipeline."
                        : "No production runs yet. Run the pipeline to see results here."}
                    </TableCell>
                  </TableRow>
                ) : (
                  visibleRuns.map((r) => {
                    const isSelected = selectedRun?.run_id === r.run_id;
                    const { date, time } = fmtDateTime(r.started_at);
                    return (
                      <TableRow
                        key={r.run_id}
                        className={`cursor-pointer transition-colors ${
                          isSelected
                            ? "border-l-2 border-blue-400 bg-blue-500/5 hover:bg-blue-500/8"
                            : "hover:bg-muted/20"
                        }`}
                        onClick={() => setSelectedRun(isSelected ? null : r)}
                      >
                        <TableCell className="font-mono" style={{ color: TEXT }}>
                          <span className="text-[10px] opacity-55 block">
                            {date}
                          </span>
                          <span className="text-xs">{time}</span>
                        </TableCell>
                        {!selectedRun && (
                          <TableCell
                            className="font-mono text-xs max-w-[180px] truncate"
                            style={{ color: TEXT }}
                          >
                            {r.process_id}
                          </TableCell>
                        )}
                        {!selectedRun && (
                          <TableCell
                            className="font-mono text-xs"
                            style={{ color: TEXT }}
                          >
                            {r.model_variant_id}
                          </TableCell>
                        )}
                        <TableCell>
                          <StatusBadge status={r.status} />
                        </TableCell>
                        {!selectedRun && (
                          <TableCell
                            className="text-right text-sm"
                            style={{ color: TEXT }}
                          >
                            {r.total_stocks}
                          </TableCell>
                        )}
                        {!selectedRun && (
                          <TableCell
                            className="text-right font-mono text-xs"
                            style={{ color: TEXT }}
                          >
                            {fmtDuration(r.duration_seconds)}
                          </TableCell>
                        )}
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>
        </div>

        {/* ── Level 2: Run drawer ── */}
        {selectedRun && (
          <RunDrawer
            run={selectedRun}
            entries={runEntries}
            loading={runEntriesLoading}
            error={runEntriesError}
            onClose={() => setSelectedRun(null)}
            onCellClick={setSelectedEntry}
          />
        )}
      </div>

      {/* ── Level 3: Detail modal ── */}
      {selectedEntry && (
        <DetailModal
          entry={selectedEntry}
          onClose={() => setSelectedEntry(null)}
        />
      )}
    </main>
  );
}
