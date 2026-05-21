"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { api, AuditEntry, RunSummary } from "@/lib/api";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const TEXT = "#D7DFE7";
const PAGE_SIZE = 50;

const AGENT_COLORS: Record<string, string> = {
  technical: "bg-blue-500/15 text-blue-400",
  fundamental: "bg-purple-500/15 text-purple-400",
  sentiment: "bg-green-500/15 text-green-400",
  risk: "bg-red-500/15 text-red-400",
  macro: "bg-orange-500/15 text-orange-400",
  ceo: "bg-yellow-500/15 text-yellow-400",
};

function AgentBadge({ name }: { name: string }) {
  const cls = AGENT_COLORS[name] ?? "bg-gray-500/15 text-gray-400";
  return (
    <span className={`rounded px-2 py-0.5 text-xs font-medium ${cls}`}>
      {name}
    </span>
  );
}

function StatusBadge({ entry }: { entry: AuditEntry }) {
  return (
    <span className="flex items-center gap-1">
      {entry.parsed_output === null ? (
        <span className="rounded px-1.5 py-0.5 text-xs font-medium bg-red-500/15 text-red-400">
          ✗ error
        </span>
      ) : entry.was_fallback ? (
        <span className="rounded px-1.5 py-0.5 text-xs font-medium bg-amber-500/15 text-amber-400">
          ↩ fallback
        </span>
      ) : (
        <span className="rounded px-1.5 py-0.5 text-xs font-medium bg-emerald-500/15 text-emerald-400">
          ✓ ok
        </span>
      )}
      {entry.web_search_used && (
        <span className="rounded px-1.5 py-0.5 text-xs font-medium bg-blue-500/15 text-blue-400">
          web
        </span>
      )}
    </span>
  );
}

function latencyStyle(ms: number | null): string {
  if (ms === null) return TEXT;
  if (ms < 2000) return "#34d399";
  if (ms < 5000) return "#fbbf24";
  return "#f87171";
}

function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString();
}

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

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-3xl rounded-xl border border-[#2a2a2a] bg-[#111111] shadow-2xl flex flex-col max-h-[90vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between px-6 py-4 border-b border-[#2a2a2a]">
          <div>
            <h2 className="text-base font-semibold" style={{ color: TEXT }}>
              <AgentBadge name={entry.agent_name} />
              <span className="ml-2 font-mono">{entry.ticker}</span>
              <span className="text-muted-foreground font-normal ml-2 text-sm">
                · {fmtTime(entry.created_at)}
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
        <div className="flex gap-1 px-6 pt-3 pb-2 border-b border-[#2a2a2a]">
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

// ── Main page ─────────────────────────────────────────────────────────────────

export default function AuditPage() {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [runFilter, setRunFilter] = useState("");
  const [agentFilter, setAgentFilter] = useState("");
  const [tickerInput, setTickerInput] = useState("");
  const [tickerFilter, setTickerFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedEntry, setSelectedEntry] = useState<AuditEntry | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchEntries = useCallback(
    async (p: number) => {
      setLoading(true);
      try {
        const resp = await api.getAuditLog({
          run_id: runFilter || undefined,
          agent_name: agentFilter || undefined,
          ticker: tickerFilter || undefined,
          status: statusFilter || undefined,
          limit: PAGE_SIZE,
          offset: p * PAGE_SIZE,
        });
        setEntries(resp.entries);
        setTotal(resp.total);
      } catch {
        // ignore
      } finally {
        setLoading(false);
      }
    },
    [runFilter, agentFilter, tickerFilter, statusFilter],
  );

  useEffect(() => {
    api
      .listRuns(1, 100)
      .then(setRuns)
      .catch(() => {});
  }, []);

  useEffect(() => {
    setPage(0);
    fetchEntries(0);
  }, [fetchEntries]);

  const onTickerChange = (val: string) => {
    setTickerInput(val);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setTickerFilter(val), 400);
  };

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const goPage = (p: number) => {
    setPage(p);
    fetchEntries(p);
  };

  return (
    <main className="fixed inset-0 top-12 bg-background flex flex-col overflow-hidden">
      <div
        className="max-w-7xl w-full mx-auto px-6 py-6 flex flex-col flex-1 min-h-0 gap-4"
        style={{ maxWidth: "80%" }}
      >
        {/* Header */}
        <div>
          <h1
            className="text-2xl font-bold tracking-tight"
            style={{ color: TEXT }}
          >
            Audit Log
          </h1>
          <p className="text-sm mt-1" style={{ color: TEXT }}>
            Every LLM call — prompt sent, response received, model, latency,
            tokens. Click a row to inspect.
          </p>
        </div>

        {/* Filter bar */}
        <div className="flex flex-wrap items-center gap-3">
          {/* Run */}
          <select
            className="bg-background border border-border rounded px-3 py-1.5 text-sm"
            style={{ color: TEXT }}
            value={runFilter}
            onChange={(e) => setRunFilter(e.target.value)}
          >
            <option value="">All Runs</option>
            {runs.map((r) => (
              <option key={r.run_id} value={r.run_id}>
                {r.process_id} ({r.model_variant_id})
              </option>
            ))}
          </select>

          {/* Agent */}
          <select
            className="bg-background border border-border rounded px-3 py-1.5 text-sm"
            style={{ color: TEXT }}
            value={agentFilter}
            onChange={(e) => setAgentFilter(e.target.value)}
          >
            <option value="">All Agents</option>
            {[
              "technical",
              "fundamental",
              "sentiment",
              "risk",
              "macro",
              "ceo",
            ].map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>

          {/* Ticker */}
          <input
            type="text"
            placeholder="Ticker…"
            value={tickerInput}
            onChange={(e) => onTickerChange(e.target.value)}
            className="bg-background border border-border rounded px-3 py-1.5 text-sm w-28"
            style={{ color: TEXT }}
          />

          {/* Status */}
          <select
            className="bg-background border border-border rounded px-3 py-1.5 text-sm"
            style={{ color: TEXT }}
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
          >
            <option value="">All Status</option>
            <option value="ok">✓ ok</option>
            <option value="fallback">↩ fallback</option>
            <option value="error">✗ error</option>
          </select>

          {/* Pagination controls */}
          <div
            className="ml-auto flex items-center gap-2 text-sm"
            style={{ color: TEXT }}
          >
            {loading ? (
              <span className="text-muted-foreground animate-pulse text-xs">
                Loading…
              </span>
            ) : (
              <span className="text-muted-foreground text-xs">
                {total} entries
              </span>
            )}
            <span className="text-xs">
              Page {page + 1} of {totalPages}
            </span>
            <button
              onClick={() => goPage(page - 1)}
              disabled={page === 0}
              className="px-2 py-0.5 rounded border border-border text-xs disabled:opacity-30 hover:bg-muted/30 transition-colors"
            >
              ◀
            </button>
            <button
              onClick={() => goPage(page + 1)}
              disabled={page >= totalPages - 1}
              className="px-2 py-0.5 rounded border border-border text-xs disabled:opacity-30 hover:bg-muted/30 transition-colors"
            >
              ▶
            </button>
          </div>
        </div>

        {/* Table */}
        <div className="flex-1 overflow-y-auto min-h-0 rounded-lg border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead style={{ color: TEXT }}>Time</TableHead>
                <TableHead style={{ color: TEXT }}>Run</TableHead>
                <TableHead style={{ color: TEXT }}>Agent</TableHead>
                <TableHead style={{ color: TEXT }}>Ticker</TableHead>
                <TableHead style={{ color: TEXT }}>Model</TableHead>
                <TableHead style={{ color: TEXT }}>Latency</TableHead>
                <TableHead style={{ color: TEXT }}>Tokens</TableHead>
                <TableHead style={{ color: TEXT }}>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {entries.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={8}
                    className="text-center text-muted-foreground py-12"
                  >
                    {loading
                      ? "Loading…"
                      : "No audit entries found. Run the pipeline to see results here."}
                  </TableCell>
                </TableRow>
              ) : (
                entries.map((e) => (
                  <TableRow
                    key={e.result_id}
                    className="cursor-pointer hover:bg-muted/20 transition-colors"
                    onClick={() => setSelectedEntry(e)}
                  >
                    <TableCell
                      className="text-sm font-mono"
                      style={{ color: TEXT }}
                    >
                      {fmtTime(e.created_at)}
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      <Link
                        href={`/results/${e.run_id}`}
                        className="text-blue-400 underline hover:text-blue-300 transition-colors"
                        onClick={(ev) => ev.stopPropagation()}
                      >
                        {e.run_id.slice(0, 8)}…
                      </Link>
                    </TableCell>
                    <TableCell>
                      <AgentBadge name={e.agent_name} />
                    </TableCell>
                    <TableCell
                      className="font-mono text-sm font-medium"
                      style={{ color: TEXT }}
                    >
                      {e.ticker}
                    </TableCell>
                    <TableCell
                      className="font-mono text-xs max-w-[180px] truncate"
                      style={{ color: TEXT }}
                      title={e.model_used ?? ""}
                    >
                      {e.model_used ?? "—"}
                    </TableCell>
                    <TableCell
                      className="text-sm font-mono"
                      style={{ color: latencyStyle(e.latency_ms) }}
                    >
                      {e.latency_ms != null
                        ? `${e.latency_ms.toLocaleString()}ms`
                        : "—"}
                    </TableCell>
                    <TableCell
                      className="text-sm font-mono"
                      style={{ color: TEXT }}
                    >
                      {e.tokens_used != null
                        ? e.tokens_used.toLocaleString()
                        : "—"}
                    </TableCell>
                    <TableCell>
                      <StatusBadge entry={e} />
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      {selectedEntry && (
        <DetailModal
          entry={selectedEntry}
          onClose={() => setSelectedEntry(null)}
        />
      )}
    </main>
  );
}
