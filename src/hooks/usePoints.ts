import { useQuery } from "@tanstack/react-query";

import { queryKeys } from "@/constants/query-keys";
import { ApiRoutes } from "@/constants/routes";
import type { OrganizationPublic } from "@/constants/types";
import { apiClient } from "@/lib/api-client";

export function usePoints() {
  const { data: org } = useQuery({
    queryKey: queryKeys.organization(),
    queryFn: () => apiClient.get<OrganizationPublic>(ApiRoutes.ORGANIZATION),
    staleTime: Infinity,
  });

  return {
    enabled: org?.pointsEnabled ?? false,
    name: org?.pointsName || "Points",
    iconUrl: org?.pointsIconUrl ?? null,
  };
}
