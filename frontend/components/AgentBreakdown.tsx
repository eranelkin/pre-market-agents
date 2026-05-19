"use client";
import { useEffect, useState } from "react";
import { api, AgentBreakdown as AgentBreakdownData } from "@/lib/api";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface Props {
  runId: string;
  ticker: string;
}

export function AgentBreakdown({ runId, ticker }: Props) {
  const [data, setData] = useState<AgentBreakdownData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.getAgentBreakdown(runId, ticker)
      .then(setData)
      .catch((e) => setError(e.message));
  }, [runId, ticker]);

  if (error) return <p className="text-sm text-destructive">{error}</p>;
  if (!data) return <p className="text-sm text-muted-foreground">Loading…</p>;

  const agentNames = Object.keys(data.agents);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Agent Breakdown — {ticker}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="rounded-md border overflow-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Agent</TableHead>
                <TableHead>Provider</TableHead>
                <TableHead>Model</TableHead>
                <TableHead className="text-center">Fallback</TableHead>
                <TableHead className="text-center">Search</TableHead>
                <TableHead className="text-right">Tokens</TableHead>
                <TableHead className="text-right">Latency</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {agentNames.map((name) => {
                const a = data.agents[name];
                return (
                  <TableRow key={name}>
                    <TableCell className="font-medium capitalize">{name}</TableCell>
                    <TableCell className="font-mono text-sm">{a.provider_used}</TableCell>
                    <TableCell className="font-mono text-sm text-muted-foreground">{a.model_used}</TableCell>
                    <TableCell className="text-center">{a.was_fallback ? "yes" : "—"}</TableCell>
                    <TableCell className="text-center">{a.web_search_used ? "yes" : "—"}</TableCell>
                    <TableCell className="text-right font-mono text-sm">
                      {a.tokens_used != null ? a.tokens_used.toLocaleString() : "—"}
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm">
                      {a.latency_ms != null ? `${(a.latency_ms / 1000).toFixed(1)}s` : "—"}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}
