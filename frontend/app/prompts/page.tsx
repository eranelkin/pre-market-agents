"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, PromptInfo } from "@/lib/api";

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
  const d = new Date(iso);
  return d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function formatChars(n: number): string {
  return n.toLocaleString() + " chars";
}

// ── Reload toast ──────────────────────────────────────────────────────────────

function ReloadBar({ onReload }: { onReload: () => void }) {
  const [status, setStatus] = useState<"idle" | "loading" | "ok" | "error">("idle");

  const run = async () => {
    setStatus("loading");
    try {
      await api.reloadPrompts();
      setStatus("ok");
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

// ── Single prompt card ────────────────────────────────────────────────────────

function PromptCard({ prompt, onSaved }: { prompt: PromptInfo; onSaved: () => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(prompt.content);
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<"idle" | "ok" | "error">("idle");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Keep draft in sync if parent refreshes while not editing
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
      {/* Card header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-sm text-foreground">{displayName(prompt.agent_name)}</span>
            {isCeo && (
              <span className="rounded-full bg-blue-500/20 text-blue-400 text-xs px-2 py-0.5 font-medium">
                evaluator
              </span>
            )}
            {editing && (
              <span className="text-xs text-amber-400 font-medium">editing</span>
            )}
            {saveStatus === "ok" && (
              <span className="text-xs text-emerald-400">Saved.</span>
            )}
            {saveStatus === "error" && (
              <span className="text-xs text-red-400">Save failed.</span>
            )}
          </div>
          <div className="flex items-center gap-2 mt-0.5 text-xs text-muted-foreground font-mono">
            <span>{prompt.file_path}</span>
            <span>·</span>
            <span>{formatChars(editing ? draft.length : prompt.char_count)}</span>
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
            <button
              onClick={startEdit}
              className="text-xs px-2.5 py-1 rounded border border-border text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
            >
              Edit
            </button>
          )}
        </div>
      </div>

      {/* Card body — prompt content */}
      <div className="p-0">
        <textarea
          ref={textareaRef}
          value={editing ? draft : prompt.content}
          readOnly={!editing}
          onChange={(e) => setDraft(e.target.value)}
          rows={Math.min(Math.max(prompt.content.split("\n").length + 1, 6), 24)}
          spellCheck={false}
          className={[
            "w-full font-mono text-xs leading-relaxed px-4 py-3 resize-none outline-none bg-transparent text-foreground",
            editing
              ? "bg-[#0f0f0f] focus:bg-[#0f0f0f]"
              : "text-muted-foreground cursor-default select-text",
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

  // Split CEO out to always show last
  const agentPrompts = prompts.filter((p) => p.agent_name !== "ceo");
  const ceoPrompt = prompts.find((p) => p.agent_name === "ceo");

  return (
    <main className="min-h-screen bg-background">
      <div className="max-w-4xl mx-auto px-6 py-8 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Prompts</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Manage the AI agent prompt files. Changes are written to disk and hot-reloaded immediately.
            </p>
          </div>
          <ReloadBar onReload={refresh} />
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}

        {loading && (
          <p className="text-sm text-muted-foreground animate-pulse">Loading prompts…</p>
        )}

        {/* Agent prompts */}
        {agentPrompts.length > 0 && (
          <div className="space-y-4">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Analysis Agents
            </h2>
            <div className="space-y-3">
              {agentPrompts.map((p) => (
                <PromptCard key={p.agent_name} prompt={p} onSaved={refresh} />
              ))}
            </div>
          </div>
        )}

        {/* CEO prompt */}
        {ceoPrompt && (
          <div className="space-y-4">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Chief Evaluator
            </h2>
            <PromptCard prompt={ceoPrompt} onSaved={refresh} />
          </div>
        )}
      </div>
    </main>
  );
}
