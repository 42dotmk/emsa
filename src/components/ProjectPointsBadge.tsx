import { cva, type VariantProps } from "class-variance-authority";

import { PointsAmount } from "@/components/PointsAmount";
import { Badge } from "@/components/ui/badge";
import { usePoints } from "@/hooks/usePoints";
import { cn } from "@/lib/utils";

const projectPointsBadgeVariants = cva("gap-0", {
  variants: {
    variant: {
      floating:
        "border-transparent bg-background/90 text-green-700 shadow-sm backdrop-blur-sm dark:text-green-400",
      overlay: "border-white/20 bg-white/15 text-white backdrop-blur-sm",
    },
  },
  defaultVariants: { variant: "floating" },
});

interface ProjectPointsBadgeProps extends VariantProps<typeof projectPointsBadgeVariants> {
  points: number | null;
  className?: string;
}

export function ProjectPointsBadge({ points, variant, className }: ProjectPointsBadgeProps) {
  const { enabled, name } = usePoints();
  if (!enabled || !points) return null;

  const label = `+${points} ${name} for attending`;

  return (
    <Badge
      variant="outline"
      aria-label={label}
      className={cn(projectPointsBadgeVariants({ variant }), className)}
    >
      <PointsAmount amount={points} signed size="xs" title={label} />
    </Badge>
  );
}
