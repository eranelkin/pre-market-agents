"use client";
import { Badge } from "@/components/ui/badge";

const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  complete: "default",
  running: "secondary",
  pending: "outline",
  failed: "destructive",
};

const RECOMMENDATION_COLOR: Record<string, string> = {
  STRONG_BUY: "bg-emerald-600 text-white",
  BUY: "bg-green-500 text-white",
  HOLD: "bg-yellow-500 text-white",
  SELL: "bg-orange-500 text-white",
  STRONG_SELL: "bg-red-600 text-white",
};

export function StatusBadge({ status }: { status: string }) {
  return (
    <Badge variant={STATUS_VARIANT[status] ?? "outline"}>
      {status}
    </Badge>
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
