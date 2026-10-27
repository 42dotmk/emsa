import { cva, type VariantProps } from "class-variance-authority";
import { Sparkles } from "lucide-react";

import { usePoints } from "@/hooks/usePoints";
import { cn } from "@/lib/utils";

const pointsAmountVariants = cva("inline-flex items-center font-medium tabular-nums", {
  variants: {
    size: {
      sm: "gap-1 text-sm",
      md: "gap-1.5 text-base",
      lg: "gap-2.5 text-display",
    },
  },
  defaultVariants: { size: "sm" },
});

const iconSizes = { sm: "size-4", md: "size-5", lg: "size-10" } as const;

interface PointsAmountProps extends VariantProps<typeof pointsAmountVariants> {
  amount: number;
  showName?: boolean;
  signed?: boolean;
  className?: string;
}

export function PointsAmount({
  amount,
  size,
  showName = false,
  signed = false,
  className,
}: PointsAmountProps) {
  const { name, iconUrl } = usePoints();
  const iconClass = cn("shrink-0", iconSizes[size ?? "sm"]);
  const value = signed && amount > 0 ? `+${amount}` : String(amount);

  return (
    <span className={cn(pointsAmountVariants({ size }), className)} title={`${amount} ${name}`}>
      {iconUrl ? (
        <img src={iconUrl} alt="" className={cn(iconClass, "rounded-sm object-contain")} />
      ) : (
        <Sparkles className={cn(iconClass, !signed && "text-primary")} aria-hidden />
      )}
      <span>{value}</span>
      {showName && <span className="font-normal text-muted-foreground">{name}</span>}
    </span>
  );
}
