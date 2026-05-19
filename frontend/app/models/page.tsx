"use client";
import { useCallback, useEffect, useState } from "react";
import { api, ModelsResponse, VariantDetail, TestConnectionResult } from "@/lib/api";
import { AddModelDialog } from "@/components/models/AddModelDialog";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";

// ── Status badge ──────────────────────────────────────────────────────────────

function StatusBadge({
  variantId,
  status,
}: {
  variantId: string;
  status: "ready" | "no_key";
}) {
  const [result, setResult] = useState<TestConnectionResult | null>(null);
  const [testing, setTesting] = useState(false);

  const runTest = async () => {
    setTesting(true);
    setResult(null);
    try {
      const r = await api.testVariant(variantId);
      setResult(r);
    } catch {
      setResult({ status: "error", latency_ms: null, message: "Request failed" });
    } finally {
      setTesting(false);
    }
  };

  if (testing) {
    return <span className="text-xs text-muted-foreground animate-pulse">Testing…</span>;
  }

  if (result) {
    return result.status === "ok" ? (
      <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-400 cursor-pointer" onClick={runTest}>
        ✓ {result.latency_ms}ms
      </span>
    ) : (
      <span className="inline-flex items-center gap-1 text-xs font-semibold text-red-400 cursor-pointer" title={result.message ?? ""} onClick={runTest}>
        ✗ Error
      </span>
    );
  }

  return (
    <button
      onClick={runTest}
      className={`inline-flex items-center rounded px-2.5 py-0.5 text-xs font-medium cursor-pointer transition-opacity hover:opacity-80 ${
        status === "ready"
          ? "bg-emerald-500/15 text-emerald-400"
          : "bg-amber-500/15 text-amber-400"
      }`}
      title="Click to test connection"
    >
      {status === "ready" ? "Ready" : "No key"}
    </button>
  );
}

// ── Delete confirm ────────────────────────────────────────────────────────────

function DeleteButton({ variantId, onDeleted }: { variantId: string; onDeleted: () => void }) {
  const [confirm, setConfirm] = useState(false);
  const [loading, setLoading] = useState(false);

  if (confirm) {
    return (
      <span className="flex items-center gap-1">
        <button
          onClick={async () => {
            setLoading(true);
            try { await api.deleteVariant(variantId); onDeleted(); }
            catch { setConfirm(false); }
            finally { setLoading(false); }
          }}
          className="text-xs text-destructive underline"
          disabled={loading}
        >
          {loading ? "…" : "Confirm"}
        </button>
        <button onClick={() => setConfirm(false)} className="text-xs text-muted-foreground underline">
          Cancel
        </button>
      </span>
    );
  }

  return (
    <button onClick={() => setConfirm(true)} className="text-muted-foreground hover:text-destructive transition-colors" title="Delete variant">
      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/>
      </svg>
    </button>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function ModelsPage() {
  const [data, setData] = useState<ModelsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const d = await api.getVariants();
      setData(d);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const toggleActive = async (v: VariantDetail) => {
    setTogglingId(v.id);
    try {
      await api.toggleVariantActive(v.id, !v.active);
      await refresh();
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    } finally {
      setTogglingId(null);
    }
  };

  const firstActiveId = data?.active_variants[0];

  return (
    <main className="min-h-screen bg-background">
      <div className="max-w-7xl mx-auto px-6 py-8 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Models</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Configure AI providers and model variants. API keys are stored in <code className="font-mono text-xs bg-muted px-1 py-0.5 rounded">.env</code> only.
            </p>
          </div>
          <Button onClick={() => setDialogOpen(true)} className="bg-blue-600 hover:bg-blue-500 text-white border-0">
            + Add Model
          </Button>
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}

        {/* Table */}
        {data && (
          <div className="rounded-lg border border-border overflow-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Model ID</TableHead>
                  <TableHead>Provider</TableHead>
                  <TableHead>Base URL</TableHead>
                  <TableHead className="text-center">Status</TableHead>
                  <TableHead className="text-center">Active</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.variants.map((v) => (
                  <TableRow key={v.id}>
                    <TableCell className="font-medium">
                      <span className="flex items-center gap-2">
                        {v.label}
                        {v.id === firstActiveId && (
                          <span className="rounded-full bg-blue-500/20 text-blue-400 text-xs px-2 py-0.5 font-medium">
                            default
                          </span>
                        )}
                      </span>
                    </TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">{v.model}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{v.provider}</TableCell>
                    <TableCell className="text-xs text-muted-foreground max-w-[220px] truncate font-mono" title={v.base_url ?? ""}>
                      {v.base_url ?? "—"}
                    </TableCell>
                    <TableCell className="text-center">
                      <StatusBadge variantId={v.id} status={v.status} />
                    </TableCell>
                    <TableCell className="text-center">
                      <Switch
                        checked={v.active}
                        disabled={togglingId === v.id}
                        onCheckedChange={() => toggleActive(v)}
                      />
                    </TableCell>
                    <TableCell className="text-right">
                      <DeleteButton variantId={v.id} onDeleted={refresh} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        {data?.variants.length === 0 && (
          <p className="text-sm text-muted-foreground">No model variants configured. Add one to get started.</p>
        )}
      </div>

      {data && (
        <AddModelDialog
          open={dialogOpen}
          providers={data.providers}
          onClose={() => setDialogOpen(false)}
          onAdded={() => { setDialogOpen(false); refresh(); }}
        />
      )}
    </main>
  );
}
