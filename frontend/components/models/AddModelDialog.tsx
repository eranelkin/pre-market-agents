"use client";
import { useEffect, useState } from "react";
import { api, AddVariantPayload, ModelPreset, ModelsResponse } from "@/lib/api";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

interface Props {
  open: boolean;
  providers: ModelsResponse["providers"];
  onClose: () => void;
  onAdded: () => void;
}

const TIER_COLOR: Record<string, string> = {
  free: "bg-emerald-600 text-white",
  cheap: "bg-yellow-600 text-white",
  paid: "bg-slate-500 text-white",
};

function toVariantId(label: string) {
  return label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
}

export function AddModelDialog({ open, providers, onClose, onAdded }: Props) {
  const [presets, setPresets] = useState<ModelPreset[]>([]);
  const [activeTier, setActiveTier] = useState<"free" | "cheap">("free");

  const [form, setForm] = useState<AddVariantPayload>({
    id: "", label: "", provider: "", model: "", max_tokens: 4096,
    api_key: "", set_active: false,
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      api.getPresets().then(setPresets).catch(() => {});
    }
  }, [open]);

  const fillFromPreset = (p: ModelPreset) => {
    setForm({
      id: p.id,
      label: p.label,
      provider: p.provider,
      model: p.model,
      max_tokens: p.max_tokens,
      api_key: "",
      set_active: false,
    });
  };

  const set = (key: keyof AddVariantPayload, value: string | number | boolean) =>
    setForm((prev) => ({
      ...prev,
      [key]: value,
      ...(key === "label" ? { id: toVariantId(value as string) } : {}),
    }));

  const providerHasKey = (name: string) => {
    const p = providers[name];
    return p ? Boolean(p.api_key_env) : false;
  };

  const handleSubmit = async () => {
    if (!form.id || !form.label || !form.provider || !form.model) {
      setError("All fields except API Key are required.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      await api.addVariant({ ...form, api_key: form.api_key || undefined });
      onAdded();
      onClose();
      setForm({ id: "", label: "", provider: "", model: "", max_tokens: 4096, api_key: "", set_active: false });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  const filteredPresets = presets.filter((p) => p.tier === activeTier);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Add Model</DialogTitle>
        </DialogHeader>

        {/* ── Preset tabs ── */}
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Quick-add from catalog</p>
          <div className="flex gap-2 mb-2">
            {(["free", "cheap"] as const).map((tier) => (
              <button
                key={tier}
                onClick={() => setActiveTier(tier)}
                className={`px-3 py-1 rounded text-xs font-semibold border transition-colors ${
                  activeTier === tier ? "bg-primary text-primary-foreground border-primary" : "border-border text-muted-foreground hover:border-primary/50"
                }`}
              >
                {tier === "free" ? "Free" : "Cheap"}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-1 gap-2 max-h-40 overflow-y-auto pr-1">
            {filteredPresets.map((p) => (
              <button
                key={p.id}
                onClick={() => fillFromPreset(p)}
                disabled={p.already_added}
                className={`flex items-start gap-3 text-left rounded-lg border p-2.5 transition-colors ${
                  p.already_added
                    ? "opacity-40 cursor-not-allowed border-border"
                    : "hover:border-primary/60 hover:bg-muted/30 border-border cursor-pointer"
                } ${form.id === p.id ? "border-primary bg-muted/20" : ""}`}
              >
                <span className={`mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-xs font-bold ${TIER_COLOR[p.tier]}`}>
                  {p.tier.toUpperCase()}
                </span>
                <div>
                  <p className="text-sm font-medium leading-tight">{p.label}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{p.description}</p>
                  {p.already_added && <p className="text-xs text-muted-foreground mt-0.5 italic">Already added</p>}
                </div>
              </button>
            ))}
          </div>
        </div>

        <div className="border-t pt-4 space-y-3">
          <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Model details</p>

          {/* Display Name */}
          <div>
            <label className="text-xs font-medium text-muted-foreground">Display Name</label>
            <input
              value={form.label}
              onChange={(e) => set("label", e.target.value)}
              placeholder="e.g. LLaMA 3.3 70B (Groq)"
              className="mt-1 w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </div>

          {/* Variant ID */}
          <div>
            <label className="text-xs font-medium text-muted-foreground">Variant ID</label>
            <input
              value={form.id}
              onChange={(e) => setForm((prev) => ({ ...prev, id: e.target.value.replace(/[^a-z0-9_]/g, "") }))}
              placeholder="e.g. llama_3_3_70b"
              className="mt-1 w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-ring"
            />
            <p className="text-xs text-muted-foreground mt-0.5">Lowercase letters, numbers, underscores only</p>
          </div>

          {/* Provider */}
          <div>
            <label className="text-xs font-medium text-muted-foreground">Provider</label>
            <select
              value={form.provider}
              onChange={(e) => set("provider", e.target.value)}
              className="mt-1 w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
            >
              <option value="">Select provider…</option>
              {Object.entries(providers).map(([name, p]) => (
                <option key={name} value={name}>
                  {name} {key_is_set_hint(p.api_key_env)}
                </option>
              ))}
            </select>
          </div>

          {/* Model ID */}
          <div>
            <label className="text-xs font-medium text-muted-foreground">Model ID</label>
            <input
              value={form.model}
              onChange={(e) => set("model", e.target.value)}
              placeholder="e.g. llama-3.3-70b-versatile"
              className="mt-1 w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </div>

          {/* API Key */}
          <div>
            <label className="text-xs font-medium text-muted-foreground">
              API Key{" "}
              <span className="text-muted-foreground font-normal">
                (optional if already set in .env)
              </span>
            </label>
            <input
              type="password"
              value={form.api_key ?? ""}
              onChange={(e) => set("api_key", e.target.value)}
              placeholder="sk-…"
              className="mt-1 w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
            />
            <p className="text-xs text-muted-foreground mt-0.5">Written to .env file only — never stored in the database</p>
          </div>

          {/* Set active */}
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={form.set_active}
              onChange={(e) => set("set_active", e.target.checked)}
              className="rounded border-input"
            />
            <span className="text-sm">Activate for next run</span>
          </label>
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={loading}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={loading}>
            {loading ? "Adding…" : "Add Model"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Small hint shown in the provider dropdown — derived from env var presence
function key_is_set_hint(envVar: string): string {
  // We can't read env vars client-side; the status comes from the variants table
  // so we just show the env var name as a hint
  return `(${envVar})`;
}
