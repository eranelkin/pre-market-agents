"use client";

const STATUS_STYLE: Record<string, string> = {
  complete:       "bg-emerald-500/20 text-emerald-400 border border-emerald-500/40",
  failed:         "bg-red-500/20 text-red-400 border border-red-500/40",
  cancelled:      "bg-red-500/10 text-red-400/70 border border-red-500/25",
  pending:        "bg-yellow-500/20 text-yellow-400 border border-yellow-500/40",
  running:        "bg-blue-500/20 text-blue-400 border border-blue-500/40",
  agents_running: "bg-blue-500/20 text-blue-400 border border-blue-500/40",
  ceo_evaluating: "bg-blue-500/20 text-blue-400 border border-blue-500/40",
};

const STATUS_LABEL: Record<string, string> = {
  agents_running: "analyzing",
  ceo_evaluating: "scoring",
};

const RECOMMENDATION_COLOR: Record<string, string> = {
  STRONG_BUY: "bg-emerald-600 text-white",
  BUY: "bg-green-500 text-white",
  HOLD: "bg-yellow-500 text-white",
  SELL: "bg-orange-500 text-white",
  STRONG_SELL: "bg-red-600 text-white",
};

export function StatusBadge({ status }: { status: string }) {
  const isActive = ["pending", "running", "agents_running", "ceo_evaluating"].includes(status);
  const style = STATUS_STYLE[status] ?? "bg-gray-500/20 text-gray-400 border border-gray-500/40";
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 text-xs font-medium ${style}${isActive ? " animate-pulse" : ""}`}
      style={{ borderRadius: "4px" }}
    >
      {STATUS_LABEL[status] ?? status}
    </span>
  );
}

export function RecommendationBadge({ rec }: { rec: string }) {
  const cls = RECOMMENDATION_COLOR[rec] ?? "bg-slate-500 text-white";
  return (
    <span className={`inline-flex items-center rounded px-2 py-0.5 text-xs font-semibold ${cls}`}>
      {rec.replace("_", " ")}
    </span>
  );
}
