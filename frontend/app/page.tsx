"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { BarChart2, ClipboardList, GitCompare, Trash2, X } from "lucide-react";
import { api, RunSummary, StartRunResponse } from "@/lib/api";
import { RunAnalysisDialog } from "@/components/RunAnalysisDialog";
import { StatusBadge } from "@/components/StatusBadge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const TERMINAL = new Set(["complete", "failed", "cancelled"]);

const STAGE_LABEL: Record<string, string> = {
  pending: "Waiting to start…",
  running: "Starting up…",
  agents_running: "Agents analyzing…",
  ceo_evaluating: "CEO scoring…",
  complete: "Done",
  failed: "Failed",
  cancelled: "Cancelled",
};

function ProgressCell({ runId }: { runId: string }) {
  const [info, setInfo] = useState<{
    stage: string;
    chunksCompleted: number;
    totalChunks: number;
    agentNames?: string[];
  } | null>(null);

  useEffect(() => {
    const es = new EventSource(api.sseUrl(runId));
    es.onmessage = (ev) => {
      try {
        const p = JSON.parse(ev.data);
        const stage: string | undefined = p.stage ?? p.status;
        setInfo({
          stage: stage ?? "running",
          chunksCompleted: p.chunks_completed ?? 0,
          totalChunks: p.total_chunks ?? 0,
          agentNames: p.agent_names,
        });
        if (stage && TERMINAL.has(stage)) es.close();
      } catch {
        /* ignore malformed */
      }
    };
    es.onerror = () => es.close();
    return () => es.close();
  }, [runId]);

  const stage = info?.stage ?? "running";
  const label = STAGE_LABEL[stage] ?? stage;
  const hasFraction = (info?.totalChunks ?? 0) > 0;
  const pct = hasFraction
    ? Math.round((info!.chunksCompleted / info!.totalChunks) * 100)
    : 0;
  const agents = info?.agentNames;

  return (
    <div className="space-y-1 min-w-[180px]">
      <div className="w-full bg-secondary rounded-full h-1.5 overflow-hidden">
        {hasFraction ? (
          <div
            className="bg-primary h-1.5 rounded-full transition-all duration-500"
            style={{ width: `${pct}%` }}
          />
        ) : (
          <div className="bg-primary/60 h-1.5 rounded-full w-3/5 animate-pulse" />
        )}
      </div>
      <p className="text-xs text-muted-foreground leading-tight">
        {label}
        {hasFraction &&
          ` · ${info!.chunksCompleted}/${info!.totalChunks} chunks`}
        {agents?.length && stage === "agents_running"
          ? ` [${agents.join(", ")}]`
          : ""}
      </p>
    </div>
  );
}

function fmtDuration(s: number | null) {
  if (s == null) return "—";
  const m = Math.floor(s / 60);
  const sec = Math.round(s % 60);
  return m ? `${m}m ${sec}s` : `${sec}s`;
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleString();
}

export default function Home() {
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [elapsedMap, setElapsedMap] = useState<Record<string, number>>({});
  const [dialogOpen, setDialogOpen] = useState(false);

  const fetchRuns = useCallback(async () => {
    try {
      const list = await api.listRuns();
      setRuns(list);
    } catch {
      // ignore
    }
  }, []);

  // Initial load
  useEffect(() => {
    fetchRuns();
  }, [fetchRuns]);

  const hasActiveRuns = runs.some((r) => !TERMINAL.has(r.status));

  // Auto-poll every 5 s while any run is non-terminal
  useEffect(() => {
    if (!hasActiveRuns) return;
    const id = setInterval(fetchRuns, 5000);
    return () => clearInterval(id);
  }, [hasActiveRuns, fetchRuns]);

  // Live elapsed-time ticker for active rows
  useEffect(() => {
    if (!hasActiveRuns) return;
    const id = setInterval(() => {
      const now = Date.now();
      setElapsedMap(
        Object.fromEntries(
          runs
            .filter((r) => !TERMINAL.has(r.status))
            .map((r) => [
              r.run_id,
              Math.floor((now - new Date(r.started_at).getTime()) / 1000),
            ]),
        ),
      );
    }, 1000);
    return () => clearInterval(id);
  }, [runs, hasActiveRuns]);

  const onStarted = (resp: StartRunResponse) => {
    const placeholders: RunSummary[] = Object.entries(resp.run_ids).map(
      ([variantId, runId]) => ({
        session_id: resp.session_id,
        run_id: runId,
        process_id: resp.process_id,
        model_variant_id: variantId,
        status: "pending",
        total_stocks: resp.total_stocks,
        started_at: new Date().toISOString(),
        completed_at: null,
        duration_seconds: null,
      }),
    );
    setRuns((prev) => [
      ...placeholders,
      ...prev.filter((r) => !placeholders.some((p) => p.run_id === r.run_id)),
    ]);
    fetchRuns();
  };

  const handleCancel = async (runId: string) => {
    setRuns((prev) =>
      prev.map((r) => (r.run_id === runId ? { ...r, status: "cancelled" } : r)),
    );
    try {
      await api.cancelRun(runId);
    } catch {
      fetchRuns();
    }
  };

  const handleDelete = async (runId: string, isActive: boolean) => {
    if (!window.confirm("Delete this run and all its results?")) return;
    if (isActive) {
      try {
        await api.cancelRun(runId);
      } catch {
        /* ignore */
      }
    }
    setRuns((prev) => prev.filter((r) => r.run_id !== runId));
    try {
      await api.deleteRun(runId);
    } catch {
      fetchRuns();
    }
  };

  return (
    <main className="bg-background">
      <div
        className="max-w-6xl mx-auto p-6 space-y-6"
        style={{ maxWidth: "80%" }}
      >
        <header className="flex items-center justify-between gap-6">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">
              Pre-Market Advisor
            </h1>
            <p className="mt-1" style={{ color: "#D7DFE7" }}>
              Daily AI-powered stock ranking pipeline
            </p>
          </div>
          <button
            onClick={() => setDialogOpen(true)}
            className="rounded-full bg-blue-600 px-5 py-2 text-sm font-semibold text-white shadow-sm hover:bg-blue-500 active:bg-blue-700 transition-colors"
          >
            Run Analysis
          </button>
        </header>

        <RunAnalysisDialog
          open={dialogOpen}
          onClose={() => setDialogOpen(false)}
          onStarted={(resp) => { onStarted(resp); setDialogOpen(false); }}
        />

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              {hasActiveRuns && (
                <span className="inline-block h-2 w-2 rounded-full bg-blue-400 animate-ping" />
              )}
              Runs
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="rounded-md border overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Process</TableHead>
                    <TableHead>Variant</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Stocks</TableHead>
                    <TableHead>Started</TableHead>
                    <TableHead className="text-right">Duration</TableHead>
                    <TableHead>Progress</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {runs.map((r) => {
                    const isActive = !TERMINAL.has(r.status);
                    const sessionRunCount = runs.filter(
                      (x) => x.session_id === r.session_id,
                    ).length;
                    return (
                      <TableRow
                        key={r.run_id}
                        onMouseEnter={(e) =>
                          (e.currentTarget.style.backgroundColor = "#2C2D33")
                        }
                        onMouseLeave={(e) =>
                          (e.currentTarget.style.backgroundColor = "")
                        }
                      >
                        <TableCell className="font-mono text-sm">
                          {r.status === "complete" ? (
                            <Link
                              href={`/results/${r.run_id}`}
                              className="hover:text-blue-300 transition-colors"
                            >
                              {r.process_id}
                            </Link>
                          ) : (
                            r.process_id
                          )}
                        </TableCell>
                        <TableCell className="font-mono text-sm">
                          {r.model_variant_id}
                        </TableCell>
                        <TableCell>
                          <StatusBadge status={r.status} />
                        </TableCell>
                        <TableCell className="text-right">
                          {r.total_stocks}
                        </TableCell>
                        <TableCell
                          className="text-sm text-muted-foreground"
                          style={{ color: "#4184F4" }}
                        >
                          {fmtDate(r.started_at)}
                        </TableCell>
                        <TableCell className="text-right text-sm font-mono">
                          {isActive
                            ? fmtDuration(elapsedMap[r.run_id] ?? 0)
                            : fmtDuration(r.duration_seconds)}
                        </TableCell>
                        <TableCell>
                          {isActive && <ProgressCell runId={r.run_id} />}
                        </TableCell>
                        <TableCell onClick={(e) => e.stopPropagation()}>
                          <div className="flex items-center gap-1 justify-end">
                            {r.status === "complete" && (
                              <>
                                <Link
                                  href={`/results/${r.run_id}`}
                                  title="Results"
                                  className="inline-flex items-center justify-center w-7 h-7 rounded hover:bg-[#2C2D33] text-blue-400 hover:text-blue-300 transition-colors"
                                >
                                  <BarChart2 size={15} />
                                </Link>
                                {sessionRunCount > 1 && (
                                  <Link
                                    href={`/compare/${r.session_id}`}
                                    title="Compare"
                                    className="inline-flex items-center justify-center w-7 h-7 rounded hover:bg-[#2C2D33] text-blue-400 hover:text-blue-300 transition-colors"
                                  >
                                    <GitCompare size={15} />
                                  </Link>
                                )}
                                <Link
                                  href={`/audit?run_id=${r.run_id}`}
                                  title="Audit"
                                  className="inline-flex items-center justify-center w-7 h-7 rounded hover:bg-[#2C2D33] text-muted-foreground hover:text-foreground transition-colors"
                                >
                                  <ClipboardList size={15} />
                                </Link>
                              </>
                            )}
                            {isActive && (
                              <button
                                title="Cancel"
                                onClick={() => handleCancel(r.run_id)}
                                className="inline-flex items-center justify-center w-7 h-7 rounded hover:bg-[#2C2D33] text-muted-foreground hover:text-foreground transition-colors"
                              >
                                <X size={15} />
                              </button>
                            )}
                            <button
                              title="Delete"
                              onClick={() => handleDelete(r.run_id, isActive)}
                              className="inline-flex items-center justify-center w-7 h-7 rounded hover:bg-red-500/15 text-muted-foreground hover:text-red-400 transition-colors"
                            >
                              <Trash2 size={15} />
                            </button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
