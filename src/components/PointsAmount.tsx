import { cva, type VariantProps } from "class-variance-authority";
import { Sparkles } from "lucide-react";
import { animate, motion, useMotionValue, useReducedMotion, useTransform } from "motion/react";
import { useEffect } from "react";

import { usePoints } from "@/hooks/usePoints";
import { spring } from "@/lib/motion";
import { cn } from "@/lib/utils";

const pointsAmountVariants = cva("inline-flex items-center font-medium tabular-nums", {
  variants: {
    size: {
      xs: "gap-1 text-xs",
      sm: "gap-1 text-sm",
      md: "gap-1.5 text-base",
      lg: "gap-2.5 text-display",
    },
  },
  defaultVariants: { size: "sm" },
});

const iconSizes = { xs: "size-3.5", sm: "size-4", md: "size-5", lg: "size-10" } as const;

function AnimatedNumber({ value }: { value: number }) {
  const reduceMotion = useReducedMotion();
  const motionValue = useMotionValue(value);
  const rounded = useTransform(motionValue, (latest) => Math.round(latest));

  useEffect(() => {
    if (reduceMotion) {
      motionValue.set(value);
      return;
    }
    const controls = animate(motionValue, value, spring.smooth);
    return () => controls.stop();
  }, [value, reduceMotion, motionValue]);

  return <motion.span>{rounded}</motion.span>;
}

interface PointsAmountProps extends VariantProps<typeof pointsAmountVariants> {
  amount: number;
  showName?: boolean;
  signed?: boolean;
  animated?: boolean;
  title?: string;
  className?: string;
}

export function PointsAmount({
  amount,
  size,
  showName = false,
  signed = false,
  animated = false,
  title,
  className,
}: PointsAmountProps) {
  const { name, iconUrl } = usePoints();
  const iconClass = cn("shrink-0", iconSizes[size ?? "sm"]);
  const value = signed && amount > 0 ? `+${amount}` : String(amount);

  return (
    <span
      className={cn(pointsAmountVariants({ size }), className)}
      title={title ?? `${amount} ${name}`}
    >
      {iconUrl ? (
        <img src={iconUrl} alt="" className={cn(iconClass, "rounded-sm object-contain")} />
      ) : (
        <Sparkles className={cn(iconClass, !signed && "text-primary")} aria-hidden />
      )}
      {animated && !signed ? <AnimatedNumber value={amount} /> : <span>{value}</span>}
      {showName && <span className="font-normal text-muted-foreground">{name}</span>}
    </span>
  );
}
