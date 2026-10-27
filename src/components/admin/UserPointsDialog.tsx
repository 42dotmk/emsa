import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Minus, Plus } from "lucide-react";
import { useEffect } from "react";
import { useForm } from "react-hook-form";

import { PointsAmount } from "@/components/PointsAmount";
import { PointsHistoryList } from "@/components/PointsHistoryList";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { queryKeys } from "@/constants/query-keys";
import { ApiRoutes } from "@/constants/routes";
import {
  pointsAdjustmentFormSchema,
  type PointsAdjustmentFormValues,
  type PointsAdjustmentPayload,
} from "@/constants/schemas";
import type { AdminUser, PointsHistory } from "@/constants/types";
import { usePoints } from "@/hooks/usePoints";
import { apiClient } from "@/lib/api-client";
import { cn } from "@/lib/utils";

const DEFAULT_VALUES: PointsAdjustmentFormValues = { direction: "add", amount: 1, note: "" };

interface UserPointsDialogProps {
  user: AdminUser | undefined;
  canAdjust: boolean;
  onOpenChange: (open: boolean) => void;
}

export function UserPointsDialog({ user, canAdjust, onOpenChange }: UserPointsDialogProps) {
  const queryClient = useQueryClient();
  const { name } = usePoints();
  const form = useForm<PointsAdjustmentFormValues>({
    resolver: zodResolver(pointsAdjustmentFormSchema),
    defaultValues: DEFAULT_VALUES,
  });

  const userId = user?.id;
  const { data, isLoading } = useQuery({
    queryKey: queryKeys.admin.userPoints(userId ?? ""),
    queryFn: () =>
      apiClient.get<PointsHistory>(ApiRoutes.ADMIN_USER_POINTS.replace(":id", userId!)),
    enabled: !!userId,
    staleTime: 0,
  });

  const {
    mutate: adjust,
    isPending,
    error,
    reset: resetMutation,
  } = useMutation({
    mutationFn: (payload: PointsAdjustmentPayload) =>
      apiClient.post<{ balance: number }>(
        ApiRoutes.ADMIN_USER_POINTS.replace(":id", userId!),
        payload
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.admin.userPoints(userId!) });
      queryClient.invalidateQueries({ queryKey: queryKeys.admin.users() });
      queryClient.invalidateQueries({ queryKey: queryKeys.me() });
      form.reset(DEFAULT_VALUES);
    },
  });

  useEffect(() => {
    form.reset(DEFAULT_VALUES);
    resetMutation();
  }, [userId, form, resetMutation]);

  const direction = form.watch("direction");
  const amount = form.watch("amount");
  const balance = data?.balance ?? user?.pointsBalance ?? 0;

  function handleSubmit(values: PointsAdjustmentFormValues) {
    adjust({
      amount: values.direction === "add" ? values.amount : -values.amount,
      note: values.note,
    });
  }

  return (
    <Dialog open={!!user} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{name}</DialogTitle>
          <DialogDescription>{user?.name}</DialogDescription>
        </DialogHeader>

        <div className="flex items-center justify-between rounded-lg border bg-muted/40 px-4 py-3">
          <span className="text-sm text-muted-foreground">Current balance</span>
          <PointsAmount amount={balance} size="md" />
        </div>

        {canAdjust && (
          <Form {...form}>
            <form
              onSubmit={form.handleSubmit(handleSubmit)}
              className="flex flex-col gap-3 rounded-lg border p-4"
            >
              <div className="grid grid-cols-2 gap-1 rounded-md bg-muted p-1">
                {(["add", "remove"] as const).map((value) => (
                  <Button
                    key={value}
                    type="button"
                    size="sm"
                    variant="ghost"
                    aria-pressed={direction === value}
                    onClick={() => form.setValue("direction", value)}
                    className={cn(direction === value && "bg-background shadow-sm")}
                  >
                    {value === "add" ? <Plus className="size-4" /> : <Minus className="size-4" />}
                    {value === "add" ? "Add" : "Remove"}
                  </Button>
                ))}
              </div>
              <FormField
                control={form.control}
                name="amount"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Amount</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        min={1}
                        step={1}
                        inputMode="numeric"
                        value={Number.isNaN(field.value) ? "" : field.value}
                        onChange={(e) => field.onChange(e.target.valueAsNumber)}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="note"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Note</FormLabel>
                    <FormControl>
                      <Textarea
                        rows={2}
                        placeholder="Why? The member sees this in their history."
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              {error && (
                <p className="text-sm text-destructive">
                  {error instanceof Error ? error.message : "Failed to update points"}
                </p>
              )}
              <Button
                type="submit"
                disabled={isPending}
                variant={direction === "remove" ? "destructive" : "default"}
              >
                {isPending
                  ? "Saving..."
                  : `${direction === "add" ? "Add" : "Remove"} ${Number.isNaN(amount) ? "" : amount} ${name}`}
              </Button>
            </form>
          </Form>
        )}

        <div className="flex flex-col gap-1">
          <h3 className="text-sm font-medium">History</h3>
          {isLoading ? (
            <p className="py-6 text-center text-sm text-muted-foreground">Loading...</p>
          ) : (
            <PointsHistoryList transactions={data?.transactions ?? []} showAuthor />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
