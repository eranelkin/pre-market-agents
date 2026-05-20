"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, CreatePromptPayload, PromptInfo } from "@/lib/api";

// ── Helpers ───────────────────────────────────────────────────────────────────

const AGENT_LABELS: Record<string, string> = {
  technical: "Technical",
  fundamental: "Fundamental",
  sentiment: "Sentiment",
  risk: "Risk",
  macro: "Macro",
  ceo: "CEO Evaluator",
};

function displayName(agentName: string): string {
  return AGENT_LABELS[agentName] ?? agentName.charAt(0).toUpperCase() + agentName.slice(1);
}

function formatModified(iso: string | null): string {
  if (!iso) return "file not found";
  return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

// ── Reload bar ────────────────────────────────────────────────────────────────

function ReloadBar({ onReload }: { onReload: () => void }) {
  const [status, setStatus] = useState<"idle" | "loading" | "ok" | "error">("idle");

  const run = async () => {
    setStatus("loading");
    try {
      await api.reloadPrompts();
      setStatus("ok");
      onReload();
      setTimeout(() => setStatus("idle"), 2500);
    } catch {
      setStatus("error");
      setTimeout(() => setStatus("idle"), 3000);
    }
  };

  return (
    <div className="flex items-center gap-3">
      {status === "ok" && <span className="text-xs text-emerald-400">All prompts reloaded.</span>}
      {status === "error" && <span className="text-xs text-red-400">Reload failed.</span>}
      <button
        onClick={run}
        disabled={status === "loading"}
        className="text-sm px-3 py-1.5 rounded border border-border text-muted-foreground hover:text-foreground hover:bg-accent transition-colors disabled:opacity-50"
      >
        {status === "loading" ? "Reloading…" : "Reload All from Disk"}
      </button>
    </div>
  );
}

// ── Create dialog ─────────────────────────────────────────────────────────────

const PLACEHOLDER_PROMPT = `You are a custom analysis agent. For each stock in the input, analyze it and return YAML:

- ticker: TICKER
  {agent_name}_score: 50
  reasoning: "Brief analysis here."

Return only valid YAML. No explanation.`;

function CreateDialog({
  totalWeight,
  onClose,
  onCreated,
}: {
  totalWeight: number;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [name, setName] = useState("");
  const [weight, setWeight] = useState("");
  const [content, setContent] = useState(PLACEHOLDER_PROMPT);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const remaining = Math.max(0, 1 - totalWeight);
  const weightNum = parseFloat(weight) || 0;
  const nameValid = /^[a-z][a-z0-9_]*$/.test(name);
  const weightValid = weightNum > 0 && weightNum <= 1;
  const canSubmit = nameValid && weightValid && content.trim().length > 0;

  const submit = async () => {
    setError(null);
    setSaving(true);
    try {
      const payload: CreatePromptPayload = {
        agent_name: name,
        weight: weightNum,
        content: content.trim(),
      };
      await api.createPrompt(payload);
      onCreated();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-2xl rounded-xl border border-border bg-card shadow-xl flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border shrink-0">
          <h2 className="text-base font-semibold">New Agent</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 6 6 18M6 6l12 12"/>
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="overflow-y-auto px-6 py-5 space-y-5">
          {/* Agent name */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Agent Name <span className="text-red-400">*</span>
            </label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ""))}
              placeholder="e.g. momentum, esg_filter"
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm font-mono outline-none focus:border-blue-500 transition-colors"
            />
            <p className="text-xs text-muted-foreground">
              Lowercase letters, numbers, underscores. The score field in YAML output should be <code className="font-mono">{name || "agent_name"}_score</code>.
            </p>
          </div>

          {/* Weight */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Scoring Weight <span className="text-red-400">*</span>
            </label>
            <div className="flex items-center gap-3">
              <input
                type="number"
                value={weight}
                onChange={(e) => setWeight(e.target.value)}
                placeholder="0.10"
                min="0.01"
                max="1"
                step="0.01"
                className="w-32 rounded-md border border-border bg-background px-3 py-2 text-sm font-mono outline-none focus:border-blue-500 transition-colors"
              />
              <span className="text-xs text-muted-foreground">
                Current total: <span className="font-mono text-foreground">{(totalWeight * 100).toFixed(0)}%</span>
                {" · "}Remaining headroom: <span className={`font-mono ${remaining < weightNum ? "text-amber-400" : "text-foreground"}`}>{(remaining * 100).toFixed(0)}%</span>
              </span>
            </div>
            {remaining < weightNum && (
              <p className="text-xs text-amber-400">
                Weight exceeds headroom — existing weights will be normalized automatically.
              </p>
            )}
            <p className="text-xs text-muted-foreground">
              How much this agent contributes to the final CEO score (0–1). Existing 5 agents total 1.0 — adding more normalizes all weights proportionally.
            </p>
          </div>

          {/* Prompt content */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Prompt Content <span className="text-red-400">*</span>
            </label>
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              rows={12}
              spellCheck={false}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-xs font-mono outline-none focus:border-blue-500 resize-y transition-colors"
            />
            <p className="text-xs text-muted-foreground">
              Saved to <code className="font-mono">prompts/{name || "agent_name"}_prompt.md</code>
            </p>
          </div>

          {error && <p className="text-sm text-red-400">{error}</p>}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 px-6 py-4 border-t border-border shrink-0">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm rounded-md border border-border text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={!canSubmit || saving}
            className="px-4 py-2 text-sm rounded-md bg-blue-600 hover:bg-blue-500 text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saving ? "Creating…" : "Create Agent"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Delete button ─────────────────────────────────────────────────────────────

function DeleteButton({ agentName, onDeleted }: { agentName: string; onDeleted: () => void }) {
  const [confirm, setConfirm] = useState(false);
  const [loading, setLoading] = useState(false);

  if (confirm) {
    return (
      <span className="flex items-center gap-1.5">
        <button
          onClick={async () => {
            setLoading(true);
            try {
              await api.deletePrompt(agentName);
              onDeleted();
            } catch (e) {
              alert(e instanceof Error ? e.message : String(e));
              setConfirm(false);
            } finally {
              setLoading(false);
            }
          }}
          disabled={loading}
          className="text-xs text-red-400 underline disabled:opacity-50"
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
    <button
      onClick={() => setConfirm(true)}
      className="text-muted-foreground hover:text-red-400 transition-colors"
      title="Delete agent"
    >
      <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/>
      </svg>
    </button>
  );
}

// ── Prompt card ───────────────────────────────────────────────────────────────

function PromptCard({
  prompt,
  onSaved,
  onDeleted,
}: {
  prompt: PromptInfo;
  onSaved: () => void;
  onDeleted: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(prompt.content);
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<"idle" | "ok" | "error">("idle");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!editing) setDraft(prompt.content);
  }, [prompt.content, editing]);

  const startEdit = () => {
    setDraft(prompt.content);
    setEditing(true);
    setTimeout(() => textareaRef.current?.focus(), 0);
  };

  const cancel = () => {
    setDraft(prompt.content);
    setEditing(false);
    setSaveStatus("idle");
  };

  const save = async () => {
    setSaving(true);
    setSaveStatus("idle");
    try {
      await api.updatePrompt(prompt.agent_name, draft);
      setSaveStatus("ok");
      setEditing(false);
      onSaved();
      setTimeout(() => setSaveStatus("idle"), 2500);
    } catch {
      setSaveStatus("error");
    } finally {
      setSaving(false);
    }
  };

  const isCeo = prompt.agent_name === "ceo";

  return (
    <div className={`rounded-lg border border-border bg-card overflow-hidden ${isCeo ? "border-blue-500/30" : ""}`}>
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-sm text-foreground">{displayName(prompt.agent_name)}</span>
            {isCeo && (
              <span className="rounded-full bg-blue-500/20 text-blue-400 text-xs px-2 py-0.5 font-medium">evaluator</span>
            )}
            {!prompt.is_built_in && (
              <span className="rounded-full bg-purple-500/20 text-purple-400 text-xs px-2 py-0.5 font-medium">custom</span>
            )}
            {editing && <span className="text-xs text-amber-400 font-medium">editing</span>}
            {saveStatus === "ok" && <span className="text-xs text-emerald-400">Saved.</span>}
            {saveStatus === "error" && <span className="text-xs text-red-400">Save failed.</span>}
          </div>
          <div className="flex items-center gap-2 mt-0.5 text-xs text-muted-foreground font-mono">
            <span>{prompt.file_path}</span>
            <span>·</span>
            <span>{(editing ? draft.length : prompt.char_count).toLocaleString()} chars</span>
            {!editing && prompt.last_modified && (
              <>
                <span>·</span>
                <span>{formatModified(prompt.last_modified)}</span>
              </>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 ml-4 shrink-0">
          {editing ? (
            <>
              <button
                onClick={cancel}
                disabled={saving}
                className="text-xs px-2.5 py-1 rounded border border-border text-muted-foreground hover:text-foreground hover:bg-accent transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={save}
                disabled={saving}
                className="text-xs px-2.5 py-1 rounded bg-blue-600 hover:bg-blue-500 text-white transition-colors disabled:opacity-50"
              >
                {saving ? "Saving…" : "Save"}
              </button>
            </>
          ) : (
            <>
              <button
                onClick={startEdit}
                className="text-xs px-2.5 py-1 rounded border border-border text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
              >
                Edit
              </button>
              {!prompt.is_built_in && (
                <DeleteButton agentName={prompt.agent_name} onDeleted={onDeleted} />
              )}
            </>
          )}
        </div>
      </div>

      <div>
        <textarea
          ref={textareaRef}
          value={editing ? draft : prompt.content}
          readOnly={!editing}
          onChange={(e) => setDraft(e.target.value)}
          rows={Math.min(Math.max(prompt.content.split("\n").length + 1, 6), 24)}
          spellCheck={false}
          className={[
            "w-full font-mono text-xs leading-relaxed px-4 py-3 resize-none outline-none bg-transparent text-foreground",
            editing ? "bg-[#0f0f0f]" : "text-muted-foreground cursor-default select-text",
          ].join(" ")}
        />
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function PromptsPage() {
  const [prompts, setPrompts] = useState<PromptInfo[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const data = await api.listPrompts();
      setPrompts(data);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const scoringAgents = prompts.filter((p) => p.agent_name !== "ceo");
  const ceoPrompt = prompts.find((p) => p.agent_name === "ceo");
  const builtInAgents = scoringAgents.filter((p) => p.is_built_in);
  const customAgents = scoringAgents.filter((p) => !p.is_built_in);

  // Total weight used by all custom agents (built-ins sum to 1.0 already)
  const customWeight = customAgents.reduce((_acc, _p) => _acc, 0);
  const totalWeight = 1.0 + customWeight;

  return (
    <main className="min-h-screen bg-background">
      <div className="max-w-4xl mx-auto px-6 py-8 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Prompts</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Manage AI agent prompts. Changes are written to disk and hot-reloaded immediately.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <ReloadBar onReload={refresh} />
            <button
              onClick={() => setShowCreate(true)}
              className="text-sm px-3 py-1.5 rounded bg-blue-600 hover:bg-blue-500 text-white transition-colors"
            >
              + New Agent
            </button>
          </div>
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}
        {loading && <p className="text-sm text-muted-foreground animate-pulse">Loading prompts…</p>}

        {/* Built-in analysis agents */}
        {builtInAgents.length > 0 && (
          <div className="space-y-3">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Analysis Agents
            </h2>
            {builtInAgents.map((p) => (
              <PromptCard key={p.agent_name} prompt={p} onSaved={refresh} onDeleted={refresh} />
            ))}
          </div>
        )}

        {/* Custom agents */}
        {customAgents.length > 0 && (
          <div className="space-y-3">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Custom Agents
            </h2>
            {customAgents.map((p) => (
              <PromptCard key={p.agent_name} prompt={p} onSaved={refresh} onDeleted={refresh} />
            ))}
          </div>
        )}

        {/* CEO prompt */}
        {ceoPrompt && (
          <div className="space-y-3">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Chief Evaluator
            </h2>
            <PromptCard prompt={ceoPrompt} onSaved={refresh} onDeleted={refresh} />
          </div>
        )}
      </div>

      {showCreate && (
        <CreateDialog
          totalWeight={totalWeight}
          onClose={() => setShowCreate(false)}
          onCreated={() => { setShowCreate(false); refresh(); }}
        />
      )}
    </main>
  );
}
