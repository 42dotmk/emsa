import { Link } from "react-router-dom";

import { PointsAmount } from "@/components/PointsAmount";
import { PageRoutes, PROFILE_POINTS_ANCHOR } from "@/constants/routes";
import { useAuth } from "@/context/auth";
import { usePoints } from "@/hooks/usePoints";
import { cn } from "@/lib/utils";

export function PointsPill({ className }: { className?: string }) {
  const { user } = useAuth();
  const { enabled, name } = usePoints();

  if (!user || !enabled) return null;

  return (
    <Link
      to={`${PageRoutes.PROFILE}#${PROFILE_POINTS_ANCHOR}`}
      aria-label={`${user.pointsBalance} ${name}, view history`}
      className={cn(
        "relative z-20 inline-flex h-8 items-center rounded-full border bg-background/70 px-2.5 transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        className
      )}
    >
      <PointsAmount amount={user.pointsBalance} animated />
    </Link>
  );
}
