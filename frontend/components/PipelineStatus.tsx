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

const STAGE_LABEL: Record<string, string> = {
  pending: "Waiting to start…",
  running: "Agents analyzing stocks…",
  agents_running: "Agents analyzing stocks…",
  ceo_evaluating: "CEO scoring and ranking…",
  complete: "Done",
  failed: "Failed",
};

function fmtElapsed(s: number) {
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return m ? `${m}m ${sec}s` : `${sec}s`;
}

export function PipelineStatus({ runId, onComplete }: Props) {
  const [status, setStatus] = useState<RunStatus | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const esRef = useRef<EventSource | null>(null);
  const doneRef = useRef(false);
  const mountedAt = useRef(Date.now());

  // Elapsed timer — ticks every second until terminal
  useEffect(() => {
    const id = setInterval(() => {
      if (doneRef.current) return;
      setElapsed(Math.floor((Date.now() - mountedAt.current) / 1000));
    }, 1000);
    return () => clearInterval(id);
  }, []);

  // SSE subscription
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
      api
        .getRunStatus(runId)
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

  // Initial connecting state
  if (!status) {
    return (
      <Card>
        <CardContent className="py-4">
          <div className="flex items-center gap-2">
            <span className="inline-block h-2 w-2 rounded-full bg-blue-400 animate-ping" />
            <span className="text-sm text-muted-foreground">Connecting to pipeline…</span>
          </div>
        </CardContent>
      </Card>
    );
  }

  const p = status.progress;
  const isActive = !TERMINAL.has(status.status);
  const stage = p?.stage ?? status.status;
  const stageLabel = STAGE_LABEL[stage] ?? stage;
  const progressPct = p?.total_chunks ? (p.chunks_completed / p.total_chunks) * 100 : 0;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center justify-between text-base">
          <span className="flex items-center gap-2">
            Pipeline
            <StatusBadge status={status.status} />
          </span>
          {isActive && (
            <span className="text-xs font-mono font-normal text-muted-foreground">
              ⏱ {fmtElapsed(elapsed)}
            </span>
          )}
        </CardTitle>
      </CardHeader>

      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Variant:{" "}
          <span className="font-mono text-foreground">{status.model_variant_id}</span>
          {p?.total_stocks != null && (
            <span className="ml-3">· {p.total_stocks} stocks</span>
          )}
        </p>

        {/* Progress bar */}
        <div className="space-y-1.5">
          <div className="w-full bg-secondary rounded-full h-1.5 overflow-hidden">
            {p ? (
              <div
                className="bg-primary h-1.5 rounded-full transition-all duration-500"
                style={{ width: `${progressPct}%` }}
              />
            ) : isActive ? (
              // Indeterminate pulsing bar when no Redis progress data
              <div className="bg-primary/60 h-1.5 rounded-full w-3/5 animate-pulse" />
            ) : (
              <div className="bg-primary h-1.5 rounded-full w-full" />
            )}
          </div>

          <p className="text-xs text-muted-foreground">
            {p ? (
              <>
                Chunks {p.chunks_completed}/{p.total_chunks} · {stageLabel}
              </>
            ) : (
              <span className={isActive ? "animate-pulse" : ""}>{stageLabel}</span>
            )}
          </p>
        </div>

        {status.error_message && (
          <p className="text-sm text-destructive">{status.error_message}</p>
        )}
      </CardContent>
    </Card>
  );
}
