"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, CreatePromptPayload, PromptInfo } from "@/lib/api";
import { Switch } from "@/components/ui/switch";

// ── Constants ─────────────────────────────────────────────────────────────────

const TEXT = "#D7DFE7";

const AGENT_LABELS: Record<string, string> = {
  orchestrator: "Orchestrator",
  technical: "Technical",
  fundamental: "Fundamental",
  sentiment: "Sentiment",
  risk: "Risk",
  macro: "Macro",
  ceo: "CEO Evaluator",
};

function label(name: string) {
  return AGENT_LABELS[name] ?? name.charAt(0).toUpperCase() + name.slice(1);
}

function truncate(s: string, n = 110) {
  const first = s.split("\n").find((l) => l.trim()) ?? "";
  return first.length > n ? first.slice(0, n) + "…" : first;
}

// ── Edit modal ────────────────────────────────────────────────────────────────

function EditModal({
  prompt,
  onClose,
  onSaved,
}: {
  prompt: PromptInfo;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [draft, setDraft] = useState(prompt.content);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    textareaRef.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await api.updatePrompt(prompt.agent_name, draft);
      onSaved();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="w-full max-w-2xl rounded-xl border border-[#2a2a2a] bg-[#111111] shadow-2xl flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#2a2a2a]">
          <h2 className="text-base font-semibold" style={{ color: TEXT }}>Edit Prompt</h2>
          <button onClick={onClose} style={{ color: TEXT }} className="opacity-60 hover:opacity-100 transition-opacity">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 6 6 18M6 6l12 12"/>
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="px-6 py-5 flex flex-col gap-4 overflow-y-auto">
          <p className="text-sm font-medium" style={{ color: TEXT }}>{label(prompt.agent_name)}</p>

          <div className="flex flex-col gap-1.5">
            <label className="text-xs uppercase tracking-wider" style={{ color: TEXT, opacity: 0.6 }}>Prompt text</label>
            <textarea
              ref={textareaRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              rows={16}
              spellCheck={false}
              className="w-full rounded-md border border-[#2a2a2a] bg-[#0a0a0a] px-3 py-2.5 text-xs font-mono leading-relaxed outline-none focus:border-blue-500 resize-y transition-colors"
              style={{ color: TEXT }}
            />
          </div>

          {error && <p className="text-xs text-red-400">{error}</p>}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 px-6 py-4 border-t border-[#2a2a2a]">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm rounded-md border border-[#2a2a2a] hover:bg-[#1a1a1a] transition-colors"
            style={{ color: TEXT }}
          >
            Cancel
          </button>
          <button
            onClick={save}
            disabled={saving}
            className="px-4 py-2 text-sm rounded-md bg-blue-600 hover:bg-blue-500 text-white transition-colors disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Pencil / delete icons ─────────────────────────────────────────────────────

function PencilIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/>
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/>
    </svg>
  );
}

function DeleteCell({ agentName, onDeleted }: { agentName: string; onDeleted: () => void }) {
  const [confirm, setConfirm] = useState(false);
  const [loading, setLoading] = useState(false);

  if (confirm) {
    return (
      <span className="flex items-center gap-1.5 text-xs">
        <button
          onClick={async () => {
            setLoading(true);
            try { await api.deletePrompt(agentName); onDeleted(); }
            catch (e) { alert(e instanceof Error ? e.message : String(e)); setConfirm(false); }
            finally { setLoading(false); }
          }}
          disabled={loading}
          className="text-red-400 underline disabled:opacity-50"
        >
          {loading ? "…" : "Confirm"}
        </button>
        <button onClick={() => setConfirm(false)} style={{ color: TEXT }} className="opacity-60 underline">Cancel</button>
      </span>
    );
  }

  return (
    <button
      onClick={() => setConfirm(true)}
      style={{ color: TEXT }}
      className="opacity-40 hover:opacity-100 hover:text-red-400 transition-all"
      title="Delete agent"
    >
      <TrashIcon />
    </button>
  );
}

// ── System table ──────────────────────────────────────────────────────────────

function SystemTable({ prompts, onEdit }: { prompts: PromptInfo[]; onEdit: (p: PromptInfo) => void }) {
  return (
    <div className="rounded-lg border border-[#2a2a2a] overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-[#2a2a2a]" style={{ backgroundColor: "#111111" }}>
            <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider w-44" style={{ color: TEXT, opacity: 0.5 }}>Agent</th>
            <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider" style={{ color: TEXT, opacity: 0.5 }}>Prompt</th>
            <th className="text-right px-4 py-3 text-xs font-semibold uppercase tracking-wider w-24" style={{ color: TEXT, opacity: 0.5 }}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {prompts.map((p, i) => (
            <tr
              key={p.agent_name}
              className="border-b border-[#2a2a2a] last:border-0 hover:bg-[#111111] transition-colors"
            >
              <td className="px-4 py-3 font-medium whitespace-nowrap" style={{ color: TEXT }}>
                {label(p.agent_name)}
              </td>
              <td className="px-4 py-3 font-mono text-xs max-w-0 w-full" style={{ color: TEXT, opacity: 0.5 }}>
                <span className="block truncate">{truncate(p.content)}</span>
              </td>
              <td className="px-4 py-3 text-right">
                <button
                  onClick={() => onEdit(p)}
                  style={{ color: TEXT }}
                  className="opacity-40 hover:opacity-100 transition-opacity"
                  title="Edit prompt"
                >
                  <PencilIcon />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Agents table ──────────────────────────────────────────────────────────────

function AgentsTable({
  prompts,
  onEdit,
  onDeleted,
  onToggle,
}: {
  prompts: PromptInfo[];
  onEdit: (p: PromptInfo) => void;
  onDeleted: () => void;
  onToggle: (name: string, active: boolean) => void;
}) {
  const [toggling, setToggling] = useState<string | null>(null);

  const handleToggle = async (p: PromptInfo) => {
    setToggling(p.agent_name);
    try {
      await api.togglePromptActive(p.agent_name, !p.active);
      onToggle(p.agent_name, !p.active);
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    } finally {
      setToggling(null);
    }
  };

  if (prompts.length === 0) {
    return (
      <div className="rounded-lg border border-[#2a2a2a] px-6 py-10 text-center">
        <p className="text-sm" style={{ color: TEXT, opacity: 0.5 }}>No custom agents yet. Click &quot;+ New Agent&quot; to create one.</p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-[#2a2a2a] overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-[#2a2a2a]" style={{ backgroundColor: "#111111" }}>
            <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider w-44" style={{ color: TEXT, opacity: 0.5 }}>Agent</th>
            <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider" style={{ color: TEXT, opacity: 0.5 }}>Prompt</th>
            <th className="text-center px-4 py-3 text-xs font-semibold uppercase tracking-wider w-24" style={{ color: TEXT, opacity: 0.5 }}>Active</th>
            <th className="text-right px-4 py-3 text-xs font-semibold uppercase tracking-wider w-24" style={{ color: TEXT, opacity: 0.5 }}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {prompts.map((p) => (
            <tr
              key={p.agent_name}
              className="border-b border-[#2a2a2a] last:border-0 hover:bg-[#111111] transition-colors"
            >
              <td className="px-4 py-3 whitespace-nowrap" style={{ color: TEXT }}>
                <span className="font-medium">{label(p.agent_name)}</span>
                {!p.is_system && (
                  <span className="ml-2 rounded-full bg-purple-500/20 text-purple-400 text-xs px-1.5 py-0.5">custom</span>
                )}
              </td>
              <td className="px-4 py-3 font-mono text-xs max-w-0 w-full" style={{ color: TEXT, opacity: 0.5 }}>
                <span className="block truncate">{truncate(p.content)}</span>
              </td>
              <td className="px-4 py-3 text-center">
                <Switch
                  checked={p.active}
                  disabled={toggling === p.agent_name}
                  onCheckedChange={() => handleToggle(p)}
                />
              </td>
              <td className="px-4 py-3">
                <div className="flex items-center justify-end gap-3">
                  <button
                    onClick={() => onEdit(p)}
                    style={{ color: TEXT }}
                    className="opacity-40 hover:opacity-100 transition-opacity"
                    title="Edit prompt"
                  >
                    <PencilIcon />
                  </button>
                  {!p.is_system && (
                    <DeleteCell agentName={p.agent_name} onDeleted={onDeleted} />
                  )}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── CEO Autonomous toggle panel ───────────────────────────────────────────────

function CeoAutonomousPanel() {
  const [enabled, setEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [toggling, setToggling] = useState(false);

  useEffect(() => {
    api.getPipelineSettings()
      .then((s) => setEnabled(s.ceo_autonomous))
      .finally(() => setLoading(false));
  }, []);

  const toggle = async () => {
    setToggling(true);
    const next = !enabled;
    setEnabled(next); // optimistic
    try {
      await api.setCeoAutonomous(next);
    } catch {
      setEnabled(!next); // revert
    } finally {
      setToggling(false);
    }
  };

  return (
    <div className="rounded-lg border border-[#2a2a2a] px-5 py-4 flex items-start justify-between gap-6">
      <div className="space-y-1">
        <p className="text-sm font-medium" style={{ color: TEXT }}>CEO Autonomous Scoring</p>
        <p className="text-xs leading-relaxed" style={{ color: TEXT, opacity: 0.55 }}>
          When <span className="font-semibold">ON</span>, the CEO LLM decides all scores and rankings directly based on its own expertise.{" "}
          When <span className="font-semibold">OFF</span>, scores are computed from the fixed agent weights below.
        </p>
      </div>
      <div className="shrink-0 pt-0.5">
        {loading ? (
          <div className="w-9 h-5 rounded-full bg-[#2a2a2a] animate-pulse" />
        ) : (
          <Switch checked={enabled} disabled={toggling} onCheckedChange={toggle} />
        )}
      </div>
    </div>
  );
}

// ── Create dialog ─────────────────────────────────────────────────────────────

const PLACEHOLDER = `You are a custom analysis agent. For each stock in the input, analyze it and return YAML:

- ticker: TICKER
  {agent_name}_score: 50
  reasoning: "Brief analysis here."

Return only valid YAML. No explanation.`;

function CreateDialog({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [name, setName] = useState("");
  const [weight, setWeight] = useState("");
  const [content, setContent] = useState(PLACEHOLDER);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const nameValid = /^[a-z][a-z0-9_]*$/.test(name);
  const weightNum = parseFloat(weight) || 0;
  const canSubmit = nameValid && weightNum > 0 && content.trim().length > 0;

  const submit = async () => {
    setError(null);
    setSaving(true);
    try {
      const payload: CreatePromptPayload = { agent_name: name, weight: weightNum, content: content.trim() };
      await api.createPrompt(payload);
      onCreated();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="w-full max-w-2xl rounded-xl border border-[#2a2a2a] bg-[#111111] shadow-2xl flex flex-col max-h-[90vh]">
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#2a2a2a]">
          <h2 className="text-base font-semibold" style={{ color: TEXT }}>New Agent</h2>
          <button onClick={onClose} style={{ color: TEXT }} className="opacity-60 hover:opacity-100 transition-opacity">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18M6 6l12 12"/></svg>
          </button>
        </div>

        <div className="overflow-y-auto px-6 py-5 space-y-5">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-xs uppercase tracking-wider" style={{ color: TEXT, opacity: 0.6 }}>Agent name *</label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ""))}
                placeholder="e.g. momentum"
                className="w-full rounded-md border border-[#2a2a2a] bg-[#0a0a0a] px-3 py-2 text-sm font-mono outline-none focus:border-blue-500 transition-colors"
                style={{ color: TEXT }}
              />
              <p className="text-xs opacity-50" style={{ color: TEXT }}>Score field: <code>{name || "name"}_score</code></p>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs uppercase tracking-wider" style={{ color: TEXT, opacity: 0.6 }}>Weight (0–1) *</label>
              <input
                type="number"
                value={weight}
                onChange={(e) => setWeight(e.target.value)}
                placeholder="0.10"
                min="0.01" max="1" step="0.01"
                className="w-full rounded-md border border-[#2a2a2a] bg-[#0a0a0a] px-3 py-2 text-sm font-mono outline-none focus:border-blue-500 transition-colors"
                style={{ color: TEXT }}
              />
              <p className="text-xs opacity-50" style={{ color: TEXT }}>CEO scoring contribution</p>
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs uppercase tracking-wider" style={{ color: TEXT, opacity: 0.6 }}>Prompt content *</label>
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              rows={12}
              spellCheck={false}
              className="w-full rounded-md border border-[#2a2a2a] bg-[#0a0a0a] px-3 py-2 text-xs font-mono outline-none focus:border-blue-500 resize-y transition-colors"
              style={{ color: TEXT }}
            />
          </div>

          {error && <p className="text-xs text-red-400">{error}</p>}
        </div>

        <div className="flex justify-end gap-2 px-6 py-4 border-t border-[#2a2a2a]">
          <button onClick={onClose} className="px-4 py-2 text-sm rounded-md border border-[#2a2a2a] hover:bg-[#1a1a1a] transition-colors" style={{ color: TEXT }}>Cancel</button>
          <button onClick={submit} disabled={!canSubmit || saving} className="px-4 py-2 text-sm rounded-md bg-blue-600 hover:bg-blue-500 text-white transition-colors disabled:opacity-50">
            {saving ? "Creating…" : "Create Agent"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Inner tab switcher ────────────────────────────────────────────────────────

function InnerTabs({ active, onChange }: { active: string; onChange: (t: string) => void }) {
  return (
    <div className="flex gap-1 border-b border-[#2a2a2a] pb-0">
      {["System", "Agents"].map((t) => (
        <button
          key={t}
          onClick={() => onChange(t)}
          className={[
            "px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors",
            active === t
              ? "border-blue-500 text-blue-400"
              : "border-transparent hover:border-[#2a2a2a]",
          ].join(" ")}
          style={{ color: active === t ? undefined : TEXT, opacity: active === t ? 1 : 0.6 }}
        >
          {t}
        </button>
      ))}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function PromptsPage() {
  const [prompts, setPrompts] = useState<PromptInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [innerTab, setInnerTab] = useState("System");
  const [editing, setEditing] = useState<PromptInfo | null>(null);
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

  // Optimistic toggle — update local state without a full refresh
  const handleToggle = (name: string, active: boolean) => {
    setPrompts((prev) => prev.map((p) => p.agent_name === name ? { ...p, active } : p));
  };

  const systemPrompts = prompts.filter((p) => p.is_system);
  const agentPrompts = prompts.filter((p) => !p.is_system);

  return (
    <main className="min-h-screen bg-background">
      <div className="max-w-5xl mx-auto px-6 py-8 space-y-6">
        {/* Page header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight" style={{ color: TEXT }}>Prompts</h1>
            <p className="text-sm mt-1" style={{ color: TEXT, opacity: 0.55 }}>
              Manage AI agent prompts. Changes are written to disk and hot-reloaded immediately.
            </p>
          </div>
          <button
            onClick={() => setShowCreate(true)}
            className="text-sm px-3 py-1.5 rounded bg-blue-600 hover:bg-blue-500 text-white transition-colors"
          >
            + New Agent
          </button>
        </div>

        {error && <p className="text-sm text-red-400">{error}</p>}
        {loading && <p className="text-sm animate-pulse" style={{ color: TEXT, opacity: 0.5 }}>Loading prompts…</p>}

        {/* Inner tabs */}
        <div className="space-y-5">
          <InnerTabs active={innerTab} onChange={setInnerTab} />

          {innerTab === "System" && (
            <div className="space-y-5">
              <CeoAutonomousPanel />
              <SystemTable prompts={systemPrompts} onEdit={setEditing} />
            </div>
          )}

          {innerTab === "Agents" && (
            <AgentsTable
              prompts={agentPrompts}
              onEdit={setEditing}
              onDeleted={refresh}
              onToggle={handleToggle}
            />
          )}
        </div>
      </div>

      {editing && (
        <EditModal prompt={editing} onClose={() => setEditing(null)} onSaved={refresh} />
      )}

      {showCreate && (
        <CreateDialog onClose={() => setShowCreate(false)} onCreated={() => { setShowCreate(false); refresh(); }} />
      )}
    </main>
  );
}
