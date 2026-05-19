"use client";
import { Top3Pick } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export function TopPicksSpotlight({ picks }: { picks: Top3Pick[] }) {
  if (!picks.length) return null;
  const medals = ["🥇", "🥈", "🥉"];
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      {picks.map((p, i) => (
        <Card key={p.ticker} className="border-primary/30">
          <CardHeader className="pb-1">
            <CardTitle className="text-lg flex items-center gap-2">
              {medals[i]} {p.ticker}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground leading-relaxed">{p.entry_rationale}</p>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
