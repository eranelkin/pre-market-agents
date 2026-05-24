"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  api,
  ChildPromptInfo,
  CreateChildPromptPayload,
  CreatePromptPayload,
  PromptInfo,
} from "@/lib/api";
import { Switch } from "@/components/ui/switch";
import { useTestMode } from "@/lib/test-mode-context";

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
  testMode,
}: {
  prompt: { agent_name: string; content: string };
  onClose: () => void;
  onSaved: () => void;
  testMode: boolean;
}) {
  const [draft, setDraft] = useState(prompt.content);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    textareaRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await api.updatePrompt(prompt.agent_name, draft, testMode);
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
          <h2 className="text-base font-semibold" style={{ color: TEXT }}>
            Edit Prompt
          </h2>
          <button
            onClick={onClose}
            style={{ color: TEXT }}
            className="opacity-60 hover:opacity-100 transition-opacity"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="px-6 py-5 flex flex-col gap-4 overflow-y-auto">
          <p className="text-sm font-medium" style={{ color: TEXT }}>
            {label(prompt.agent_name)}
          </p>

          <div className="flex flex-col gap-1.5">
            <label
              className="text-xs uppercase tracking-wider"
              style={{ color: TEXT, opacity: 0.6 }}
            >
              Prompt text
            </label>
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
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 20 20"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      {/* Dark outer ring */}
      <circle cx="10" cy="10" r="10" fill="#1a1a1a" />
      {/* Blue fill */}
      <circle cx="10" cy="10" r="8.5" fill="#2196F3" />
      {/* White inner ring gap */}
      <circle
        cx="10"
        cy="10"
        r="7"
        fill="#2196F3"
        stroke="white"
        strokeWidth="0.8"
      />
      {/* White plus */}
      <path
        d="M10 5.5V14.5M5.5 10H14.5"
        stroke="white"
        strokeWidth="2.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{
        transform: open ? "rotate(90deg)" : "rotate(0deg)",
        transition: "transform 0.15s ease",
      }}
    >
      <path d="m9 18 6-6-6-6" />
    </svg>
  );
}

function DeleteCell({
  agentName,
  onDeleted,
  testMode,
}: {
  agentName: string;
  onDeleted: () => void;
  testMode: boolean;
}) {
  const [confirm, setConfirm] = useState(false);
  const [loading, setLoading] = useState(false);

  if (confirm) {
    return (
      <span className="flex items-center gap-1.5 text-xs">
        <button
          onClick={async () => {
            setLoading(true);
            try {
              await api.deletePrompt(agentName, testMode);
              onDeleted();
            } catch (e) {
              alert(e instanceof Error ? e.message : String(e));
              setConfirm(false);
            } finally {
              setLoading(false);
            }
          }}
          disabled={loading}
          className="text-red-400 underline disabled:opacity-50"
        >
          {loading ? "…" : "Confirm"}
        </button>
        <button
          onClick={() => setConfirm(false)}
          style={{ color: TEXT }}
          className="opacity-60 underline"
        >
          Cancel
        </button>
      </span>
    );
  }

  return (
    <button
      onClick={() => setConfirm(true)}
      style={{ color: TEXT }}
      className="hover:text-red-400 transition-all"
      title="Delete agent"
    >
      <TrashIcon />
    </button>
  );
}

// ── System table ──────────────────────────────────────────────────────────────

function SystemTable({
  prompts,
  onEdit,
}: {
  prompts: PromptInfo[];
  onEdit: (p: { agent_name: string; content: string }) => void;
}) {
  return (
    <div className="rounded-lg border border-[#2a2a2a] overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr
            className="border-b border-[#2a2a2a]"
            style={{ backgroundColor: "#111111" }}
          >
            <th
              className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider w-44"
              style={{ color: TEXT }}
            >
              Agent
            </th>
            <th
              className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider"
              style={{ color: TEXT }}
            >
              Prompt
            </th>
            <th
              className="text-right px-4 py-3 text-xs font-semibold uppercase tracking-wider w-24"
              style={{ color: TEXT }}
            >
              Actions
            </th>
          </tr>
        </thead>
        <tbody>
          {prompts.map((p) => (
            <tr
              key={p.agent_name}
              className="border-b border-[#2a2a2a] last:border-0 hover:bg-[#111111] transition-colors"
            >
              <td
                className="px-4 py-3 font-medium whitespace-nowrap"
                style={{ color: TEXT }}
              >
                {label(p.agent_name)}
              </td>
              <td
                className="px-4 py-3 font-mono text-xs max-w-0 w-full"
                style={{ color: TEXT }}
              >
                <span className="block truncate">{truncate(p.content)}</span>
              </td>
              <td className="px-4 py-3 text-right">
                <button
                  onClick={() => onEdit(p)}
                  style={{ color: TEXT }}
                  className="transition-opacity"
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
  onChildToggle,
  onAddChild,
  testMode,
}: {
  prompts: PromptInfo[];
  onEdit: (p: { agent_name: string; content: string }) => void;
  onDeleted: () => void;
  onToggle: (name: string, active: boolean) => void;
  onChildToggle: (
    parentName: string,
    childName: string,
    active: boolean,
  ) => void;
  onAddChild: (parentName: string) => void;
  testMode: boolean;
}) {
  const [toggling, setToggling] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const handleToggle = async (p: PromptInfo) => {
    setToggling(p.agent_name);
    try {
      await api.togglePromptActive(p.agent_name, !p.active, testMode);
      onToggle(p.agent_name, !p.active);
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    } finally {
      setToggling(null);
    }
  };

  const handleChildToggle = async (
    parentName: string,
    child: ChildPromptInfo,
  ) => {
    setToggling(child.agent_name);
    try {
      await api.togglePromptActive(child.agent_name, !child.active, testMode);
      onChildToggle(parentName, child.agent_name, !child.active);
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    } finally {
      setToggling(null);
    }
  };

  const toggleExpand = (name: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  if (prompts.length === 0) {
    return (
      <div className="rounded-lg border border-[#2a2a2a] px-6 py-10 text-center">
        <p className="text-sm" style={{ color: TEXT, opacity: 0.5 }}>
          No custom agents yet. Click &quot;+ New Agent&quot; to create one.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-[#2a2a2a] overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr
            className="border-b border-[#2a2a2a]"
            style={{ backgroundColor: "#111111" }}
          >
            <th className="w-6 px-2 py-3" />
            <th
              className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider w-44"
              style={{ color: TEXT }}
            >
              Agent
            </th>
            <th
              className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider"
              style={{ color: TEXT }}
            >
              Prompt
            </th>
            <th
              className="text-center px-4 py-3 text-xs font-semibold uppercase tracking-wider w-24"
              style={{ color: TEXT }}
            >
              Active
            </th>
            <th
              className="text-right px-4 py-3 text-xs font-semibold uppercase tracking-wider w-32"
              style={{ color: TEXT }}
            >
              Actions
            </th>
          </tr>
        </thead>
        <tbody>
          {prompts.map((p) => (
            <>
              {/* ── Parent row ── */}
              <tr
                key={p.agent_name}
                className="border-b border-[#2a2a2a] hover:bg-[#111111] transition-colors"
              >
                {/* Expand chevron — only visible when agent has children */}
                <td className="w-6 pl-3 pr-0 py-3">
                  {p.children.length > 0 && (
                    <button
                      onClick={() => toggleExpand(p.agent_name)}
                      style={{ color: TEXT }}
                      className="opacity-50 hover:opacity-100 transition-opacity"
                      title={expanded.has(p.agent_name) ? "Collapse" : "Expand"}
                    >
                      <ChevronIcon open={expanded.has(p.agent_name)} />
                    </button>
                  )}
                </td>
                <td
                  className="px-4 py-3 whitespace-nowrap"
                  style={{ color: TEXT }}
                >
                  <span className="font-medium">{label(p.agent_name)}</span>
                  {!p.is_system && (
                    <span className="ml-2 rounded-full bg-purple-500/20 text-purple-400 text-xs px-1.5 py-0.5">
                      custom
                    </span>
                  )}
                  {p.children.length > 0 && (
                    <span className="ml-2 rounded-full bg-blue-500/15 text-blue-400 text-xs px-1.5 py-0.5">
                      {p.children.length} sub-agent
                      {p.children.length !== 1 ? "s" : ""}
                    </span>
                  )}
                </td>
                <td
                  className="px-4 py-3 font-mono text-xs max-w-0 w-full"
                  style={{ color: TEXT }}
                >
                  <span className="block truncate">{truncate(p.content)}</span>
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center justify-center gap-2">
                    {!p.is_system && (
                      <button
                        onClick={() => onAddChild(p.agent_name)}
                        className="opacity-60 hover:opacity-100 transition-opacity pr-5"
                        title="Add sub-agent"
                      >
                        <PlusIcon />
                      </button>
                    )}
                    <Switch
                      checked={p.active}
                      disabled={toggling === p.agent_name}
                      onCheckedChange={() => handleToggle(p)}
                    />
                  </div>
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center justify-end gap-3">
                    <button
                      onClick={() => onEdit(p)}
                      style={{ color: TEXT, marginRight: 6 }}
                      className="opacity-40 hover:opacity-100 transition-opacity"
                      title="Edit prompt"
                    >
                      <PencilIcon />
                    </button>
                    {!p.is_system && (
                      <DeleteCell
                        agentName={p.agent_name}
                        onDeleted={onDeleted}
                        testMode={testMode}
                      />
                    )}
                  </div>
                </td>
              </tr>

              {/* ── Child rows (shown when expanded) ── */}
              {expanded.has(p.agent_name) &&
                p.children.map((child) => (
                  <tr
                    key={child.agent_name}
                    className="border-b border-[#2a2a2a] last:border-0 transition-opacity duration-200"
                    style={{
                      backgroundColor: "#0d0d0d",
                      opacity: p.active ? 1 : 0.35,
                      pointerEvents: p.active ? "auto" : "none",
                    }}
                  >
                    <td className="w-6" />
                    <td
                      className="py-2.5 whitespace-nowrap"
                      style={{ color: TEXT }}
                    >
                      <div className="flex items-center gap-2 pl-6 border-l-2 border-[#2a2a2a] ml-4">
                        <span className="text-xs opacity-40">↳</span>
                        <span className="text-xs font-medium">
                          {label(child.agent_name)}
                        </span>
                        <span className="text-xs opacity-40">
                          {child.child_weight != null
                            ? `weight ${child.child_weight}`
                            : "equal weight"}
                        </span>
                      </div>
                    </td>
                    <td
                      className="px-4 py-2.5 font-mono text-xs max-w-0 w-full"
                      style={{ color: TEXT, opacity: 0.7 }}
                    >
                      <span className="block truncate">
                        {truncate(child.content)}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-center">
                      <Switch
                        checked={child.active}
                        disabled={toggling === child.agent_name}
                        onCheckedChange={() =>
                          handleChildToggle(p.agent_name, child)
                        }
                      />
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center justify-end gap-3">
                        <button
                          onClick={() => onEdit(child)}
                          style={{ color: TEXT }}
                          className="opacity-40 hover:opacity-100 transition-opacity"
                          title="Edit sub-agent prompt"
                        >
                          <PencilIcon />
                        </button>
                        <DeleteCell
                          agentName={child.agent_name}
                          onDeleted={onDeleted}
                          testMode={testMode}
                        />
                      </div>
                    </td>
                  </tr>
                ))}
            </>
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
    api
      .getPipelineSettings()
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
        <p className="text-sm font-medium" style={{ color: TEXT }}>
          CEO Autonomous Scoring
        </p>
        <p
          className="text-xs leading-relaxed"
          style={{ color: TEXT, opacity: 0.8 }}
        >
          When <span className="font-semibold">ON</span>, the CEO LLM decides
          all scores and rankings directly based on its own expertise. When{" "}
          <span className="font-semibold">OFF</span>, scores are computed from
          the fixed agent weights below.
        </p>
      </div>
      <div className="shrink-0 pt-0.5">
        {loading ? (
          <div className="w-9 h-5 rounded-full bg-[#2a2a2a] animate-pulse" />
        ) : (
          <Switch
            checked={enabled}
            disabled={toggling}
            onCheckedChange={toggle}
          />
        )}
      </div>
    </div>
  );
}

// ── Create dialog ─────────────────────────────────────────────────────────────

const CHILD_PLACEHOLDER = `You are a sub-agent. For each stock in the input, analyze it and return YAML:

- ticker: TICKER
  {agent_name}_score: 50
  reasoning: "Brief analysis here."

Return only valid YAML. No explanation.`;

const PARENT_PLACEHOLDER = `Leave blank to use weighted average of children results (math mode).

Fill in to act as a judge agent (judge mode): your prompt receives all children
results as context and synthesizes them into a final verdict. Example:

You are a synthesis agent. Sub-agent analyses are provided below.
Weigh their findings and return a final YAML verdict for each stock.

- ticker: TICKER
  {agent_name}_score: 50
  reasoning: "Synthesized judgment here."

Return only valid YAML. No explanation.`;

function CreateDialog({
  onClose,
  onCreated,
  parentName,
  testMode,
}: {
  onClose: () => void;
  onCreated: () => void;
  parentName?: string;
  testMode: boolean;
}) {
  const isChild = Boolean(parentName);
  const [name, setName] = useState("");
  const [weight, setWeight] = useState("");
  const [content, setContent] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const nameValid = /^[a-z][a-z0-9_]*$/.test(name);
  const weightNum = parseFloat(weight) || 0;
  const canSubmit =
    nameValid &&
    (isChild
      ? content.trim().length > 0 && true // children always need a prompt
      : weightNum > 0); // top-level: name + weight; prompt optional

  const submit = async () => {
    setError(null);
    setSaving(true);
    try {
      if (isChild) {
        const payload: CreateChildPromptPayload = {
          agent_name: name,
          child_weight: weightNum > 0 ? weightNum : null,
          content: content.trim(),
        };
        await api.createChildPrompt(parentName!, payload, testMode);
      } else {
        const payload: CreatePromptPayload = {
          agent_name: name,
          weight: weightNum,
          content: content.trim(),
        };
        await api.createPrompt(payload, testMode);
      }
      onCreated();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const dialogTitle = isChild
    ? `New Sub-Agent for "${parentName}"`
    : "New Agent";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="w-full max-w-2xl rounded-xl border border-[#2a2a2a] bg-[#111111] shadow-2xl flex flex-col max-h-[90vh]">
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#2a2a2a]">
          <h2 className="text-base font-semibold" style={{ color: TEXT }}>
            {dialogTitle}
          </h2>
          <button
            onClick={onClose}
            style={{ color: TEXT }}
            className="opacity-60 hover:opacity-100 transition-opacity"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="overflow-y-auto px-6 py-5 space-y-5">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label
                className="text-xs uppercase tracking-wider"
                style={{ color: TEXT, opacity: 0.6 }}
              >
                Agent name *
              </label>
              <input
                value={name}
                onChange={(e) =>
                  setName(
                    e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ""),
                  )
                }
                placeholder="e.g. momentum"
                className="w-full rounded-md border border-[#2a2a2a] bg-[#0a0a0a] px-3 py-2 text-sm font-mono outline-none focus:border-blue-500 transition-colors"
                style={{ color: TEXT }}
              />
              <p className="text-xs opacity-50" style={{ color: TEXT }}>
                Score field: <code>{name || "name"}_score</code>
              </p>
            </div>
            <div className="space-y-1.5">
              <label
                className="text-xs uppercase tracking-wider"
                style={{ color: TEXT, opacity: 0.6 }}
              >
                {isChild ? "Weight (optional)" : "Weight (0–1) *"}
              </label>
              <input
                type="number"
                value={weight}
                onChange={(e) => setWeight(e.target.value)}
                placeholder={isChild ? "blank = equal share" : "0.10"}
                min="0.01"
                max="100"
                step="0.01"
                className="w-full rounded-md border border-[#2a2a2a] bg-[#0a0a0a] px-3 py-2 text-sm font-mono outline-none focus:border-blue-500 transition-colors"
                style={{ color: TEXT }}
              />
              <p className="text-xs opacity-50" style={{ color: TEXT }}>
                {isChild
                  ? "Relative weight within this parent (null = equal)"
                  : "CEO scoring contribution"}
              </p>
            </div>
          </div>

          <div className="space-y-1.5">
            <label
              className="text-xs uppercase tracking-wider"
              style={{ color: TEXT, opacity: 0.6 }}
            >
              {isChild ? "Prompt content *" : "Prompt content"}
            </label>
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder={isChild ? CHILD_PLACEHOLDER : PARENT_PLACEHOLDER}
              rows={12}
              spellCheck={false}
              className="w-full rounded-md border border-[#2a2a2a] bg-[#0a0a0a] px-3 py-2 text-xs font-mono outline-none focus:border-blue-500 resize-y transition-colors placeholder:opacity-30"
              style={{ color: TEXT }}
            />
          </div>

          {error && <p className="text-xs text-red-400">{error}</p>}
        </div>

        <div className="flex justify-end gap-2 px-6 py-4 border-t border-[#2a2a2a]">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm rounded-md border border-[#2a2a2a] hover:bg-[#1a1a1a] transition-colors"
            style={{ color: TEXT }}
          >
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={!canSubmit || saving}
            className="px-4 py-2 text-sm rounded-md bg-blue-600 hover:bg-blue-500 text-white transition-colors disabled:opacity-50"
          >
            {saving
              ? "Creating…"
              : isChild
                ? "Create Sub-Agent"
                : "Create Agent"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Inner tab switcher ────────────────────────────────────────────────────────

function InnerTabs({
  active,
  onChange,
}: {
  active: string;
  onChange: (t: string) => void;
}) {
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
          style={{ color: active === t ? undefined : TEXT }}
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
  const [editing, setEditing] = useState<{
    agent_name: string;
    content: string;
  } | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [showCreateChild, setShowCreateChild] = useState<string | null>(null); // parent agent_name
  const { testMode } = useTestMode();

  const refresh = useCallback(async () => {
    try {
      const data = await api.listPrompts(testMode);
      setPrompts(data);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [testMode]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Optimistic toggle for top-level agents
  const handleToggle = (name: string, active: boolean) => {
    setPrompts((prev) =>
      prev.map((p) => (p.agent_name === name ? { ...p, active } : p)),
    );
  };

  // Optimistic toggle for child agents
  const handleChildToggle = (
    parentName: string,
    childName: string,
    active: boolean,
  ) => {
    setPrompts((prev) =>
      prev.map((p) =>
        p.agent_name === parentName
          ? {
              ...p,
              children: p.children.map((c) =>
                c.agent_name === childName ? { ...c, active } : c,
              ),
            }
          : p,
      ),
    );
  };

  const systemPrompts = prompts.filter((p) => p.is_system);
  const agentPrompts = prompts.filter((p) => !p.is_system);

  return (
    <main className="fixed inset-0 top-12 bg-background flex flex-col overflow-hidden">
      <div
        className="max-w-5xl w-full mx-auto px-6 py-8 flex flex-col flex-1 min-h-0 gap-6"
        style={{ maxWidth: "80%" }}
      >
        {/* Page header */}
        <div className="flex items-center justify-between shrink-0">
          <div>
            <h1
              className="text-2xl font-bold tracking-tight"
              style={{ color: TEXT }}
            >
              Prompts
            </h1>
            <p className="text-sm mt-1" style={{ color: TEXT }}>
              Manage AI agent prompts. Changes are written to disk and
              hot-reloaded immediately.
            </p>
          </div>
          <button
            onClick={() => setShowCreate(true)}
            className="text-sm px-3 py-1.5 rounded bg-blue-600 hover:bg-blue-500 text-white transition-colors"
          >
            + New Agent
          </button>
        </div>

        {testMode && (
          <div className="flex items-center gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-400 shrink-0">
            <span className="font-semibold">Test mode</span>
            <span className="text-amber-400/70">— editing test prompts from <code className="font-mono text-xs">prompts/test/</code>. Changes do not affect production.</span>
          </div>
        )}

        {error && <p className="text-sm text-red-400 shrink-0">{error}</p>}
        {loading && (
          <p
            className="text-sm animate-pulse shrink-0"
            style={{ color: TEXT, opacity: 0.5 }}
          >
            Loading prompts…
          </p>
        )}

        {/* Inner tabs */}
        <div className="flex flex-col flex-1 min-h-0 gap-5">
          <InnerTabs active={innerTab} onChange={setInnerTab} />

          <div className="table-container flex-1 overflow-y-auto min-h-0">
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
                onChildToggle={handleChildToggle}
                onAddChild={(parentName) => setShowCreateChild(parentName)}
                testMode={testMode}
              />
            )}
          </div>
        </div>
      </div>

      {editing && (
        <EditModal
          prompt={editing}
          onClose={() => setEditing(null)}
          onSaved={refresh}
          testMode={testMode}
        />
      )}

      {showCreate && (
        <CreateDialog
          onClose={() => setShowCreate(false)}
          onCreated={() => {
            setShowCreate(false);
            refresh();
          }}
          testMode={testMode}
        />
      )}

      {showCreateChild && (
        <CreateDialog
          parentName={showCreateChild}
          onClose={() => setShowCreateChild(null)}
          onCreated={() => {
            setShowCreateChild(null);
            refresh();
          }}
          testMode={testMode}
        />
      )}
    </main>
  );
}
