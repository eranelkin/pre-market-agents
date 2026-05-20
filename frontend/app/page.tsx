"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { api, RunSummary, StartRunResponse } from "@/lib/api";
import { RunTrigger } from "@/components/RunTrigger";
import { ModelVariantSelector } from "@/components/ModelVariantSelector";
import { PipelineStatus } from "@/components/PipelineStatus";
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
  const [activeRunIds, setActiveRunIds] = useState<string[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);

  const fetchRuns = async () => {
    try {
      const list = await api.listRuns();
      setRuns(list);
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    fetchRuns();
  }, []);

  const onStarted = (resp: StartRunResponse) => {
    setActiveRunIds(Object.values(resp.run_ids));
    setActiveSessionId(resp.session_id);
    fetchRuns();
  };

  const onPipelineComplete = () => {
    fetchRuns();
  };

  return (
    <main className="min-h-screen bg-background">
      <div className="max-w-6xl mx-auto p-6 space-y-6">
        <header>
          <h1 className="text-3xl font-bold tracking-tight">
            Pre-Market Advisor
          </h1>
          <p className="mt-1" style={{ color: "#D7DFE7" }}>
            Daily AI-powered stock ranking pipeline
          </p>
        </header>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="md:col-span-2 space-y-4">
            <RunTrigger onStarted={onStarted} />
            {activeRunIds.map((id) => (
              <PipelineStatus
                key={id}
                runId={id}
                onComplete={onPipelineComplete}
              />
            ))}
            {activeSessionId && activeRunIds.length > 0 && (
              <div className="flex gap-3">
                <Link
                  href={`/results/${activeRunIds[0]}`}
                  className="text-sm text-primary underline"
                >
                  View results
                </Link>
                <Link
                  href={`/compare/${activeSessionId}`}
                  className="text-sm text-primary underline"
                >
                  View comparison
                </Link>
              </div>
            )}
          </div>
          <div>
            <ModelVariantSelector />
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Recent Runs</CardTitle>
          </CardHeader>
          <CardContent>
            {runs.length === 0 ? (
              <p className="text-sm text-muted-foreground">No runs yet.</p>
            ) : (
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
                      <TableHead />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {runs.map((r) => (
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
                        <TableCell className="text-right text-sm">
                          {fmtDuration(r.duration_seconds)}
                        </TableCell>
                        <TableCell>
                          {r.status === "complete" && (
                            <div className="flex gap-2">
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
                            </div>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
