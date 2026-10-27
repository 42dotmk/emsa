import { PointsAmount } from "@/components/PointsAmount";
import { PointReason } from "@/constants/enums";
import type { PointTransaction } from "@/constants/types";
import { cn, formatDateTime } from "@/lib/utils";

function describe(transaction: PointTransaction): { title: string; detail: string | null } {
  const project = transaction.projectTitle ?? "a deleted project";
  switch (transaction.reason) {
    case PointReason.PROJECT_ATTENDANCE:
      return { title: `Attended ${project}`, detail: null };
    case PointReason.PROJECT_ATTENDANCE_REVOKED:
      return { title: `Attendance removed for ${project}`, detail: null };
    case PointReason.MEMBERSHIP_ACTIVE:
      return { title: "Active membership", detail: null };
    case PointReason.MEMBERSHIP_ADJUSTED:
      return {
        title: "Active membership points changed",
        detail: transaction.context
          ? `From ${transaction.context.from} to ${transaction.context.to}`
          : null,
      };
    case PointReason.MEMBERSHIP_ENDED:
      return { title: "Membership ended", detail: null };
    case PointReason.MANUAL:
      return { title: "Manual adjustment", detail: transaction.note };
  }
}

interface PointsHistoryListProps {
  transactions: PointTransaction[];
  showAuthor?: boolean;
  emptyMessage?: string;
}

export function PointsHistoryList({
  transactions,
  showAuthor = false,
  emptyMessage = "No points yet.",
}: PointsHistoryListProps) {
  if (transactions.length === 0) {
    return <p className="py-6 text-center text-sm text-muted-foreground">{emptyMessage}</p>;
  }

  return (
    <ul className="divide-y">
      {transactions.map((transaction) => {
        const { title, detail } = describe(transaction);
        return (
          <li key={transaction.id} className="flex items-start justify-between gap-4 py-3">
            <div className="min-w-0">
              <p className="text-sm font-medium break-words">{title}</p>
              {detail && <p className="text-sm break-words text-muted-foreground">{detail}</p>}
              <p className="mt-0.5 text-xs text-muted-foreground">
                {formatDateTime(transaction.createdAt)}
                {showAuthor && ` · ${transaction.createdByName ?? "System"}`}
              </p>
            </div>
            <div className="flex shrink-0 flex-col items-end gap-0.5">
              <PointsAmount
                amount={transaction.amount}
                signed
                className={cn(
                  transaction.amount > 0 ? "text-green-600 dark:text-green-400" : "text-destructive"
                )}
              />
              <span className="text-xs text-muted-foreground tabular-nums">
                Balance {transaction.balanceAfter}
              </span>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
