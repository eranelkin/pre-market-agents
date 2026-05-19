"use client";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { api, RunResults } from "@/lib/api";
import { ResultsTable } from "@/components/ResultsTable";
import { TopPicksSpotlight } from "@/components/TopPicksSpotlight";
import { AgentBreakdown } from "@/components/AgentBreakdown";
import { StatusBadge } from "@/components/StatusBadge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis,
  Tooltip, ResponsiveContainer,
} from "recharts";

function ScoreRadar({ row }: { row: RunResults["results"][number] }) {
  const data = [
    { subject: "Technical", value: row.technical_score ?? 0 },
    { subject: "Fundamental", value: row.fundamental_score ?? 0 },
    { subject: "Sentiment", value: row.sentiment_score ?? 0 },
    { subject: "Risk", value: row.risk_score ?? 0 },
    { subject: "Macro", value: row.macro_score ?? 0 },
  ];
  return (
    <ResponsiveContainer width="100%" height={240}>
      <RadarChart data={data}>
        <PolarGrid />
        <PolarAngleAxis dataKey="subject" tick={{ fontSize: 12 }} />
        <PolarRadiusAxis domain={[0, 100]} tick={false} axisLine={false} />
        <Radar dataKey="value" stroke="#6366f1" fill="#6366f1" fillOpacity={0.3} />
        <Tooltip />
      </RadarChart>
    </ResponsiveContainer>
  );
}

export default function ResultsPage() {
  const { runId } = useParams<{ runId: string }>();
  const [data, setData] = useState<RunResults | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedTicker, setSelectedTicker] = useState<string | null>(null);

  useEffect(() => {
    if (!runId) return;
    api.getResults(runId)
      .then(setData)
      .catch((e) => setError(e.message));
  }, [runId]);

  if (error) return (
    <main className="max-w-4xl mx-auto p-6">
      <Link href="/" className="text-sm text-primary underline">← Back</Link>
      <p className="mt-4 text-destructive">{error}</p>
    </main>
  );

  if (!data) return (
    <main className="max-w-4xl mx-auto p-6">
      <p className="text-muted-foreground">Loading results…</p>
    </main>
  );

  const selectedRow = selectedTicker ? data.results.find((r) => r.ticker === selectedTicker) : null;

  return (
    <main className="min-h-screen bg-background">
      <div className="max-w-6xl mx-auto p-6 space-y-6">
        <div className="flex items-center gap-4">
          <Link href="/" className="text-sm text-primary underline">← Back</Link>
          <h1 className="text-2xl font-bold">Results</h1>
          <StatusBadge status="complete" />
        </div>

        <div className="flex flex-wrap gap-2 text-sm text-muted-foreground">
          <span className="font-mono">{data.model_variant_id}</span>
          <span>·</span>
          <span>{data.provider_used}</span>
          <span>·</span>
          <span>{data.model_used}</span>
          <span>·</span>
          <span>{data.total_stocks} stocks</span>
          <span>·</span>
          <a href={api.exportCsv(runId)} className="text-primary underline">Download CSV</a>
        </div>

        {data.top_3_picks.length > 0 && (
          <section>
            <h2 className="text-lg font-semibold mb-3">Top Picks</h2>
            <TopPicksSpotlight picks={data.top_3_picks} />
          </section>
        )}

        {data.red_flags.length > 0 && (
          <Card className="border-destructive/40">
            <CardHeader>
              <CardTitle className="text-base text-destructive">Red Flags</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              {data.red_flags.map((f) => (
                <Badge key={f.ticker} variant="destructive">
                  {f.ticker}: {f.reason}
                </Badge>
              ))}
            </CardContent>
          </Card>
        )}

        <section>
          <h2 className="text-lg font-semibold mb-3">All Rankings</h2>
          <ResultsTable results={data.results} onSelectTicker={setSelectedTicker} />
        </section>

        {selectedRow && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">{selectedRow.ticker} — Score Breakdown</CardTitle>
              </CardHeader>
              <CardContent>
                <ScoreRadar row={selectedRow} />
                {selectedRow.ceo_rationale && (
                  <p className="text-sm text-muted-foreground mt-2 leading-relaxed">
                    {selectedRow.ceo_rationale}
                  </p>
                )}
                {selectedRow.conflicting_signals.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-1">
                    {selectedRow.conflicting_signals.map((s, i) => (
                      <Badge key={i} variant="outline" className="text-xs">{s}</Badge>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
            <AgentBreakdown runId={runId} ticker={selectedRow.ticker} />
          </div>
        )}
      </div>
    </main>
  );
}
