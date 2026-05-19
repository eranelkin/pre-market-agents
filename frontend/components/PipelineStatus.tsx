"use client";
import { useEffect, useRef, useState } from "react";
import { api, RunStatus } from "@/lib/api";
import { StatusBadge } from "@/components/StatusBadge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface Props {
  runId: string;
  onComplete?: () => void;
}

const TERMINAL = new Set(["complete", "failed"]);

export function PipelineStatus({ runId, onComplete }: Props) {
  const [status, setStatus] = useState<RunStatus | null>(null);
  const esRef = useRef<EventSource | null>(null);
  const doneRef = useRef(false);

  useEffect(() => {
    if (doneRef.current) return;

    const es = new EventSource(api.sseUrl(runId));
    esRef.current = es;

    es.onmessage = (ev) => {
      try {
        const payload = JSON.parse(ev.data);
        setStatus((prev) => ({
          run_id: runId,
          session_id: prev?.session_id ?? "",
          model_variant_id: prev?.model_variant_id ?? "",
          status: payload.status ?? prev?.status ?? "pending",
          error_message: payload.error_message ?? prev?.error_message ?? null,
          progress: payload.progress ?? prev?.progress ?? null,
        }));
        const st: string | undefined = payload.status ?? payload.stage;
        if (st && TERMINAL.has(st)) {
          doneRef.current = true;
          es.close();
          onComplete?.();
        }
      } catch {
        // ignore malformed events
      }
    };

    es.onerror = () => {
      es.close();
      if (doneRef.current) return;
      // One fallback poll on error, then stop
      api.getRunStatus(runId)
        .then((s) => {
          setStatus(s);
          if (TERMINAL.has(s.status)) {
            doneRef.current = true;
            onComplete?.();
          }
        })
        .catch(() => {});
    };

    return () => {
      es.close();
      esRef.current = null;
    };
  }, [runId, onComplete]);

  if (!status) return <p className="text-sm text-muted-foreground">Connecting…</p>;

  const p = status.progress;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          Pipeline Status
          <StatusBadge status={status.status} />
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <p className="text-sm text-muted-foreground">
          Variant: <span className="font-mono text-foreground">{status.model_variant_id}</span>
        </p>
        {p && (
          <>
            <div className="w-full bg-secondary rounded-full h-2">
              <div
                className="bg-primary h-2 rounded-full transition-all"
                style={{ width: `${p.total_chunks ? (p.chunks_completed / p.total_chunks) * 100 : 0}%` }}
              />
            </div>
            <p className="text-xs text-muted-foreground">
              Chunks: {p.chunks_completed}/{p.total_chunks}
              &nbsp;·&nbsp;
              Stocks: {p.total_stocks}
              &nbsp;·&nbsp;
              Stage: {p.stage}
            </p>
          </>
        )}
        {status.error_message && (
          <p className="text-sm text-destructive">{status.error_message}</p>
        )}
      </CardContent>
    </Card>
  );
}
