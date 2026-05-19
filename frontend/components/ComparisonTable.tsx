"use client";
import { ComparisonItem } from "@/lib/api";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { RecommendationBadge } from "@/components/StatusBadge";
import { Badge } from "@/components/ui/badge";

interface Props {
  items: ComparisonItem[];
  variantIds: string[];
}

export function ComparisonTable({ items, variantIds }: Props) {
  return (
    <div className="rounded-md border overflow-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Ticker</TableHead>
            {variantIds.map((v) => (
              <TableHead key={v} colSpan={3} className="text-center border-l">
                <span className="font-mono">{v}</span>
              </TableHead>
            ))}
            <TableHead className="text-center">Agree</TableHead>
            <TableHead className="text-right">Rank Δ</TableHead>
            <TableHead className="text-right">Score Δ</TableHead>
            <TableHead>Consensus</TableHead>
          </TableRow>
          <TableRow>
            <TableHead />
            {variantIds.map((v) => (
              <>
                <TableHead key={`${v}-rank`} className="border-l text-center text-xs">Rank</TableHead>
                <TableHead key={`${v}-score`} className="text-right text-xs">Score</TableHead>
                <TableHead key={`${v}-rec`} className="text-xs">Rec.</TableHead>
              </>
            ))}
            <TableHead />
            <TableHead />
            <TableHead />
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((item) => (
            <TableRow key={item.ticker} className={!item.recommendation_agreement ? "bg-yellow-50 dark:bg-yellow-900/10" : ""}>
              <TableCell className="font-bold">{item.ticker}</TableCell>
              {variantIds.map((v) => {
                const s = item.variant_results[v];
                return s ? (
                  <>
                    <TableCell key={`${item.ticker}-${v}-rank`} className="border-l text-center font-mono">{s.rank}</TableCell>
                    <TableCell key={`${item.ticker}-${v}-score`} className="text-right font-mono">{s.final_score.toFixed(1)}</TableCell>
                    <TableCell key={`${item.ticker}-${v}-rec`}><RecommendationBadge rec={s.recommendation} /></TableCell>
                  </>
                ) : (
                  <>
                    <TableCell key={`${item.ticker}-${v}-rank`} className="border-l text-center text-muted-foreground">—</TableCell>
                    <TableCell key={`${item.ticker}-${v}-score`} className="text-right text-muted-foreground">—</TableCell>
                    <TableCell key={`${item.ticker}-${v}-rec`} className="text-muted-foreground">—</TableCell>
                  </>
                );
              })}
              <TableCell className="text-center">
                <Badge variant={item.recommendation_agreement ? "default" : "destructive"}>
                  {item.recommendation_agreement ? "yes" : "no"}
                </Badge>
              </TableCell>
              <TableCell className="text-right font-mono">{item.max_rank_diff}</TableCell>
              <TableCell className="text-right font-mono">{item.max_score_diff.toFixed(1)}</TableCell>
              <TableCell>
                {item.consensus_recommendation
                  ? <RecommendationBadge rec={item.consensus_recommendation} />
                  : <span className="text-muted-foreground text-xs">split</span>}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
