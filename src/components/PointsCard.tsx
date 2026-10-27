import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { PointsAmount } from "@/components/PointsAmount";
import { PointsHistoryList } from "@/components/PointsHistoryList";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { queryKeys } from "@/constants/query-keys";
import { ApiRoutes } from "@/constants/routes";
import type { PointsHistory } from "@/constants/types";
import { usePoints } from "@/hooks/usePoints";
import { apiClient } from "@/lib/api-client";

const PREVIEW_COUNT = 5;

export function PointsCard() {
  const { enabled, name } = usePoints();
  const [showAll, setShowAll] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: queryKeys.myPoints(),
    queryFn: () => apiClient.get<PointsHistory>(ApiRoutes.USERS_ME_POINTS),
    enabled,
    staleTime: 0,
  });

  if (!enabled) return null;

  const transactions = data?.transactions ?? [];
  const visible = showAll ? transactions : transactions.slice(0, PREVIEW_COUNT);

  return (
    <Card>
      <CardHeader>
        <CardTitle>{name}</CardTitle>
        <CardDescription>Earned by attending projects and being an active member.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading...</p>
        ) : (
          <>
            <PointsAmount amount={data?.balance ?? 0} size="lg" />
            <PointsHistoryList transactions={visible} />
            {transactions.length > PREVIEW_COUNT && (
              <Button
                variant="ghost"
                size="sm"
                className="self-center"
                onClick={() => setShowAll((value) => !value)}
              >
                {showAll ? "Show less" : `Show all ${transactions.length}`}
              </Button>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
