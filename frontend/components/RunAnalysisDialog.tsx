"use client";
import { useRef, useState } from "react";
import { Paperclip, X } from "lucide-react";
import { api, StartRunResponse } from "@/lib/api";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface Props {
  open: boolean;
  onClose: () => void;
  onStarted: (resp: StartRunResponse) => void;
  testMode: boolean;
}

export function RunAnalysisDialog({ open, onClose, onStarted, testMode }: Props) {
  const [file, setFile] = useState<File | null>(null);
  const [chunkSize, setChunkSize] = useState(5);
  const [dragging, setDragging] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const accept = (f: File) => {
    if (!f.name.match(/\.(json|yaml|yml)$/i)) {
      setError("Only .json, .yaml, or .yml files are accepted.");
      return;
    }
    setFile(f);
    setError(null);
  };

  const handleClose = () => {
    if (loading) return;
    setFile(null);
    setChunkSize(5);
    setError(null);
    onClose();
  };

  const handleRun = async () => {
    if (!file) return;
    setLoading(true);
    setError(null);
    try {
      const resp = await api.startRun(file, chunkSize, testMode);
      onStarted(resp);
      setFile(null);
      setChunkSize(5);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) handleClose(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Run Analysis</DialogTitle>
        </DialogHeader>

        <div className="space-y-5 py-2">
          {testMode && (
            <div className="flex items-center gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-400">
              <span className="font-semibold">Test mode</span>
              <span className="text-amber-400/70">— uses stub prompts &amp; agents_config.test.yaml. Fast, free, no real analysis.</span>
            </div>
          )}
          {/* File picker */}
          <div className="space-y-2">
            <label className="text-sm font-medium">Stock file</label>
            {file ? (
              <div className="flex items-center gap-2 rounded-lg border border-border bg-secondary/40 px-3 py-2">
                <Paperclip size={14} className="shrink-0 text-muted-foreground" />
                <span className="flex-1 truncate text-sm font-medium">{file.name}</span>
                <button
                  onClick={() => setFile(null)}
                  className="shrink-0 rounded p-0.5 text-muted-foreground hover:text-foreground transition-colors"
                >
                  <X size={14} />
                </button>
              </div>
            ) : (
              <div
                className={`flex cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed px-4 py-6 transition-colors ${
                  dragging
                    ? "border-primary bg-primary/5"
                    : "border-border hover:border-primary/50"
                }`}
                onClick={() => inputRef.current?.click()}
                onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
                onDragLeave={() => setDragging(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragging(false);
                  const f = e.dataTransfer.files[0];
                  if (f) accept(f);
                }}
              >
                <Paperclip size={18} className="text-muted-foreground" />
                <p className="text-sm text-muted-foreground">
                  Drop a <span className="font-mono">.json</span> or{" "}
                  <span className="font-mono">.yaml</span> file, or{" "}
                  <span className="text-primary underline-offset-2 hover:underline">browse</span>
                </p>
              </div>
            )}
            <input
              ref={inputRef}
              type="file"
              accept=".json,.yaml,.yml"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) accept(f);
                e.target.value = "";
              }}
            />
          </div>

          {/* Chunk size */}
          <div className="space-y-2">
            <label className="text-sm font-medium" htmlFor="chunk-size">
              Stocks per chunk
            </label>
            <p className="text-xs text-muted-foreground">
              How many stocks are analyzed in each parallel batch.
            </p>
            <input
              id="chunk-size"
              type="number"
              min={1}
              max={50}
              value={chunkSize}
              onChange={(e) => {
                const v = parseInt(e.target.value, 10);
                if (!isNaN(v) && v >= 1) setChunkSize(v);
              }}
              className="w-24 rounded-md border border-border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
            />
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={handleClose} disabled={loading}>
            Cancel
          </Button>
          <Button onClick={handleRun} disabled={!file || loading}>
            {loading ? "Starting…" : "Run"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
