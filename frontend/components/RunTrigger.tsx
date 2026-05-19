"use client";
import { useState, useRef, DragEvent } from "react";
import { api, StartRunResponse } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface Props {
  onStarted: (resp: StartRunResponse) => void;
}

export function RunTrigger({ onStarted }: Props) {
  const [dragging, setDragging] = useState(false);
  const [file, setFile] = useState<File | null>(null);
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

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const f = e.dataTransfer.files[0];
    if (f) accept(f);
  };

  const onSubmit = async () => {
    if (!file) return;
    setLoading(true);
    setError(null);
    try {
      const resp = await api.startRun(file);
      onStarted(resp);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Upload Stock File</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div
          className={`border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors ${
            dragging ? "border-primary bg-primary/5" : "border-border hover:border-primary/50"
          }`}
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
        >
          <input
            ref={inputRef}
            type="file"
            accept=".json,.yaml,.yml"
            className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) accept(f); }}
          />
          {file ? (
            <p className="text-sm font-medium">{file.name}</p>
          ) : (
            <p className="text-sm text-muted-foreground">
              Drag & drop a <span className="font-mono">.json</span> or <span className="font-mono">.yaml</span> stock file here, or click to browse
            </p>
          )}
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <Button onClick={onSubmit} disabled={!file || loading} className="w-full">
          {loading ? "Starting…" : "Run Analysis"}
        </Button>
      </CardContent>
    </Card>
  );
}
