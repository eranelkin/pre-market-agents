"use client";
import { FinalResultItem } from "@/lib/api";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { RecommendationBadge } from "@/components/StatusBadge";

function ScoreCell({ value }: { value: number | null }) {
  if (value == null) return <span className="text-muted-foreground">—</span>;
  const color =
    value >= 70 ? "text-green-600" :
    value >= 40 ? "text-yellow-600" :
    "text-red-600";
  return <span className={`font-mono ${color}`}>{value.toFixed(1)}</span>;
}

interface Props {
  results: FinalResultItem[];
  onSelectTicker?: (ticker: string) => void;
}

export function ResultsTable({ results, onSelectTicker }: Props) {
  return (
    <div className="rounded-md border overflow-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-12">#</TableHead>
            <TableHead>Ticker</TableHead>
            <TableHead>Rec.</TableHead>
            <TableHead className="text-right">Score</TableHead>
            <TableHead className="text-right">Conf.</TableHead>
            <TableHead className="text-right">Tech</TableHead>
            <TableHead className="text-right">Fund</TableHead>
            <TableHead className="text-right">Sent</TableHead>
            <TableHead className="text-right">Risk</TableHead>
            <TableHead className="text-right">Macro</TableHead>
            <TableHead>Override</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {results.map((r) => (
            <TableRow
              key={r.ticker}
              className={onSelectTicker ? "cursor-pointer hover:bg-muted/50" : ""}
              onClick={() => onSelectTicker?.(r.ticker)}
            >
              <TableCell className="font-mono text-muted-foreground">{r.rank}</TableCell>
              <TableCell className="font-bold">{r.ticker}</TableCell>
              <TableCell><RecommendationBadge rec={r.recommendation} /></TableCell>
              <TableCell className="text-right"><ScoreCell value={r.final_score} /></TableCell>
              <TableCell className="text-right font-mono text-sm">{(r.confidence * 100).toFixed(0)}%</TableCell>
              <TableCell className="text-right"><ScoreCell value={r.technical_score} /></TableCell>
              <TableCell className="text-right"><ScoreCell value={r.fundamental_score} /></TableCell>
              <TableCell className="text-right"><ScoreCell value={r.sentiment_score} /></TableCell>
              <TableCell className="text-right"><ScoreCell value={r.risk_score} /></TableCell>
              <TableCell className="text-right"><ScoreCell value={r.macro_score} /></TableCell>
              <TableCell>
                {r.override_applied && (
                  <span className="text-xs text-orange-600" title={r.override_reason ?? ""}>
                    ⚠ {r.override_reason?.slice(0, 30)}
                  </span>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
