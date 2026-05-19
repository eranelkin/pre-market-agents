"use client";
import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

interface ModelVariant {
  id: string;
  provider: string;
  model: string;
}

export function ModelVariantSelector() {
  const [variants, setVariants] = useState<ModelVariant[]>([]);
  const [active, setActive] = useState<string[]>([]);

  useEffect(() => {
    fetch(`${process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000"}/api/v1/models`)
      .then((r) => r.json())
      .then((d) => {
        setVariants(d.model_variants ?? []);
        setActive(d.active_variants ?? []);
      })
      .catch(() => {});
  }, []);

  if (!variants.length) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">Active Model Variants</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-wrap gap-2">
        {variants.map((v) => (
          <Badge
            key={v.id}
            variant={active.includes(v.id) ? "default" : "outline"}
            className="gap-1"
          >
            {v.id}
            <span className="opacity-60 text-xs">({v.provider})</span>
          </Badge>
        ))}
      </CardContent>
    </Card>
  );
}
