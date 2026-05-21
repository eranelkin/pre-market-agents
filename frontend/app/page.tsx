"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { api, RunSummary, StartRunResponse } from "@/lib/api";
import { RunTrigger } from "@/components/RunTrigger";
import { ModelVariantSelector } from "@/components/ModelVariantSelector";
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
import { Button } from "@/components/ui/button";

const TERMINAL = new Set(["complete", "failed", "cancelled"]);

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
    <main className="min-h-screen bg-background">
      <div
        className="max-w-6xl mx-auto p-6 space-y-6"
        style={{ maxWidth: "80%" }}
      >
        <header className="flex items-start justify-between gap-6">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">
              Pre-Market Advisor
            </h1>
            <p className="mt-1" style={{ color: "#D7DFE7" }}>
              Daily AI-powered stock ranking pipeline
            </p>
          </div>
          <RunTrigger onStarted={onStarted} compact />
        </header>

        <div className="flex justify-end">
          <div className="w-full md:w-1/3">
            <ModelVariantSelector />
          </div>
        </div>

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
                    return (
                      <TableRow key={r.run_id}>
                        <TableCell className="font-mono text-sm">
                          {r.process_id}
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
                        <TableCell className="text-sm text-muted-foreground">
                          {fmtDate(r.started_at)}
                        </TableCell>
                        <TableCell className="text-right text-sm font-mono">
                          {isActive
                            ? fmtDuration(elapsedMap[r.run_id] ?? 0)
                            : fmtDuration(r.duration_seconds)}
                        </TableCell>
                        <TableCell className="min-w-[120px]">
                          {isActive && (
                            <div className="w-full bg-secondary rounded-full h-1.5 overflow-hidden">
                              <div className="bg-primary/60 h-1.5 rounded-full w-3/5 animate-pulse" />
                            </div>
                          )}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2 justify-end">
                            {r.status === "complete" && (
                              <>
                                <Link
                                  href={`/results/${r.run_id}`}
                                  className="text-xs text-primary underline"
                                >
                                  Results
                                </Link>
                                <Link
                                  href={`/compare/${r.session_id}`}
                                  className="text-xs text-primary underline"
                                >
                                  Compare
                                </Link>
                              </>
                            )}
                            {isActive && (
                              <Button
                                size="xs"
                                variant="outline"
                                onClick={() => handleCancel(r.run_id)}
                              >
                                Cancel
                              </Button>
                            )}
                            <Button
                              size="xs"
                              variant="destructive"
                              onClick={() => handleDelete(r.run_id, isActive)}
                            >
                              Delete
                            </Button>
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
