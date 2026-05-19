"use client";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { api, ComparisonOutput, ComparisonItem } from "@/lib/api";
import { ComparisonTable } from "@/components/ComparisonTable";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  Legend, ResponsiveContainer,
} from "recharts";

const COLORS = ["#6366f1", "#22c55e", "#f59e0b", "#ef4444"];

function ScoreComparisonChart({ items, variantIds }: { items: ComparisonItem[]; variantIds: string[] }) {
  const data = items.slice(0, 15).map((item) => ({
    ticker: item.ticker,
    ...Object.fromEntries(
      variantIds.map((v) => [v, item.variant_results[v]?.final_score ?? 0])
    ),
  }));

  return (
    <ResponsiveContainer width="100%" height={300}>
      <BarChart data={data} margin={{ top: 5, right: 10, bottom: 5, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis dataKey="ticker" tick={{ fontSize: 11 }} />
        <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} />
        <Tooltip />
        <Legend />
        {variantIds.map((v, i) => (
          <Bar key={v} dataKey={v} fill={COLORS[i % COLORS.length]} />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}

export default function ComparePage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const [data, setData] = useState<ComparisonOutput | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!sessionId) return;
    api.getComparison(sessionId)
      .then(setData)
      .catch((e) => setError(e.message));
  }, [sessionId]);

  if (error) return (
    <main className="max-w-4xl mx-auto p-6">
      <Link href="/" className="text-sm text-primary underline">← Back</Link>
      <p className="mt-4 text-destructive">{error}</p>
    </main>
  );

  if (!data) return (
    <main className="max-w-4xl mx-auto p-6">
      <p className="text-muted-foreground">Loading comparison…</p>
    </main>
  );

  const agreements = data.stocks.filter((s) => s.recommendation_agreement).length;
  const avgScoreDiff =
    data.stocks.reduce((acc, s) => acc + s.max_score_diff, 0) / (data.stocks.length || 1);

  return (
    <main className="min-h-screen bg-background">
      <div className="max-w-6xl mx-auto p-6 space-y-6">
        <div className="flex items-center gap-4">
          <Link href="/" className="text-sm text-primary underline">← Back</Link>
          <h1 className="text-2xl font-bold">Model Comparison</h1>
        </div>

        <p className="text-sm text-muted-foreground font-mono">{data.process_id}</p>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card>
            <CardHeader><CardTitle className="text-sm">Variants Compared</CardTitle></CardHeader>
            <CardContent>
              <p className="text-2xl font-bold">{data.variant_ids.length}</p>
              <p className="text-xs text-muted-foreground">{data.variant_ids.join(", ")}</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle className="text-sm">Agreement Rate</CardTitle></CardHeader>
            <CardContent>
              <p className="text-2xl font-bold">
                {data.stocks.length ? Math.round((agreements / data.stocks.length) * 100) : 0}%
              </p>
              <p className="text-xs text-muted-foreground">{agreements}/{data.stocks.length} tickers</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle className="text-sm">Avg Score Delta</CardTitle></CardHeader>
            <CardContent>
              <p className="text-2xl font-bold">{avgScoreDiff.toFixed(1)}</p>
              <p className="text-xs text-muted-foreground">points across tickers</p>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader><CardTitle>Score Comparison (top 15)</CardTitle></CardHeader>
          <CardContent>
            <ScoreComparisonChart items={data.stocks} variantIds={data.variant_ids} />
          </CardContent>
        </Card>

        <section>
          <h2 className="text-lg font-semibold mb-3">Per-Ticker Comparison</h2>
          <ComparisonTable items={data.stocks} variantIds={data.variant_ids} />
        </section>
      </div>
    </main>
  );
}
