import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";

import { ImageUpload } from "@/components/admin/ImageUpload";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { queryKeys } from "@/constants/query-keys";
import { ApiRoutes } from "@/constants/routes";
import { pointsSettingsFormSchema, type PointsSettingsFormValues } from "@/constants/schemas";
import type { AdminUser, ImageEntry, Organization } from "@/constants/types";
import { apiClient } from "@/lib/api-client";
import { cn, resolveImageEntry } from "@/lib/utils";

type PendingSave = PointsSettingsFormValues & { icon: ImageEntry };

function confirmationText(
  org: Organization,
  values: PointsSettingsFormValues,
  activeMembers: number
): string | null {
  if (!values.pointsEnabled) return null;
  const name = values.pointsName;
  const members = `${activeMembers} active ${activeMembers === 1 ? "member" : "members"}`;
  if (!org.pointsEnabled) {
    const membership =
      values.membershipPoints > 0
        ? `${members} will get ${values.membershipPoints} ${name} each for their active membership. `
        : "";
    return `${membership}Members already marked as attended on projects with points will receive those points.`;
  }
  if (values.membershipPoints === org.membershipPoints || activeMembers === 0) return null;
  const change =
    org.membershipPoints === 0
      ? `will get ${values.membershipPoints} ${name} each`
      : values.membershipPoints === 0
        ? `will lose their ${org.membershipPoints} membership ${name}`
        : `will be adjusted from ${org.membershipPoints} to ${values.membershipPoints} ${name}`;
  return `${members} ${change} right away. Each change appears in their history.`;
}

export function PointsSection() {
  const queryClient = useQueryClient();
  const [icon, setIcon] = useState<ImageEntry>({ type: "none" });
  const [pendingSave, setPendingSave] = useState<PendingSave | null>(null);

  const { data: org } = useQuery({
    queryKey: queryKeys.admin.organization(),
    queryFn: () => apiClient.get<Organization | null>(ApiRoutes.ADMIN_ORGANIZATION),
  });

  const { data: users = [] } = useQuery({
    queryKey: queryKeys.admin.users(),
    queryFn: () => apiClient.get<AdminUser[]>(ApiRoutes.ADMIN_USERS),
  });
  const activeMembers = users.filter((u) => u.isActive).length;

  const form = useForm<PointsSettingsFormValues>({
    resolver: zodResolver(pointsSettingsFormSchema),
    defaultValues: { pointsEnabled: false, pointsName: "Points", membershipPoints: 0 },
  });

  const savedEnabled = org?.pointsEnabled;
  const savedName = org?.pointsName;
  const savedMembershipPoints = org?.membershipPoints;
  const savedIconUrl = org?.pointsIconUrl;

  useEffect(() => {
    if (savedEnabled === undefined) return;
    form.reset({
      pointsEnabled: savedEnabled,
      pointsName: savedName ?? "Points",
      membershipPoints: savedMembershipPoints ?? 0,
    });
    setIcon(savedIconUrl ? { type: "existing", url: savedIconUrl } : { type: "none" });
  }, [savedEnabled, savedName, savedMembershipPoints, savedIconUrl, form]);

  const {
    mutate: save,
    isPending,
    error,
    isSuccess,
    reset: resetMutation,
  } = useMutation({
    mutationFn: async ({ icon: iconEntry, ...values }: PendingSave) => {
      const pointsIconUrl = await resolveImageEntry(iconEntry, ApiRoutes.ADMIN_ORGANIZATION_UPLOAD);
      return apiClient.patch<Organization>(ApiRoutes.ADMIN_ORGANIZATION, {
        ...values,
        pointsIconUrl,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.admin.organization() });
      queryClient.invalidateQueries({ queryKey: queryKeys.organization() });
      queryClient.invalidateQueries({ queryKey: queryKeys.admin.users() });
      queryClient.invalidateQueries({ queryKey: queryKeys.me() });
    },
  });

  function handleSubmit(values: PointsSettingsFormValues) {
    resetMutation();
    const next = { ...values, icon };
    if (org && confirmationText(org, values, activeMembers)) {
      setPendingSave(next);
    } else {
      save(next);
    }
  }

  const enabled = form.watch("pointsEnabled");
  const confirmation =
    org && pendingSave ? confirmationText(org, pendingSave, activeMembers) : null;

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h3 className="font-semibold">Points</h3>
        <p className="text-sm text-muted-foreground">
          Reward members for attending projects and for having an active membership.
        </p>
      </div>

      <Form {...form}>
        <form
          onSubmit={form.handleSubmit(handleSubmit)}
          className="flex max-w-2xl flex-col gap-5 rounded-md border p-4"
        >
          <FormField
            control={form.control}
            name="pointsEnabled"
            render={({ field }) => (
              <FormItem className="flex items-center justify-between gap-4 space-y-0">
                <div>
                  <FormLabel>Enable points</FormLabel>
                  <FormDescription>
                    When off, points are hidden everywhere and nothing is awarded.
                  </FormDescription>
                </div>
                <FormControl>
                  <Switch checked={field.value} onCheckedChange={field.onChange} />
                </FormControl>
              </FormItem>
            )}
          />

          <div
            className={cn(
              "flex flex-col gap-5 transition-opacity",
              !enabled && "pointer-events-none opacity-50"
            )}
            aria-disabled={!enabled}
          >
            <FormField
              control={form.control}
              name="pointsName"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Name</FormLabel>
                  <FormControl>
                    <Input placeholder='e.g. "EMSA Credits"' {...field} />
                  </FormControl>
                  <FormDescription>Shown to members wherever points appear.</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="flex flex-col gap-2">
              <Label>Logo</Label>
              <ImageUpload state={icon} onChange={setIcon} />
              <p className="text-sm text-muted-foreground">
                Shown next to point amounts. A square image works best.
              </p>
            </div>

            <FormField
              control={form.control}
              name="membershipPoints"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Points for active membership</FormLabel>
                  <FormControl>
                    <Input
                      type="number"
                      min={0}
                      step={1}
                      inputMode="numeric"
                      className="w-32"
                      value={Number.isNaN(field.value) ? "" : field.value}
                      onChange={(e) => field.onChange(e.target.valueAsNumber)}
                    />
                  </FormControl>
                  <FormDescription>
                    Active members hold these points while their membership lasts; they are taken
                    back when it ends. Changing the value adjusts all active members right away. Use
                    0 to turn this off.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>

          <div className="flex flex-col gap-2">
            {error && (
              <p className="text-sm text-destructive">
                {error instanceof Error ? error.message : "Failed to save points settings"}
              </p>
            )}
            {isSuccess && !form.formState.isDirty && (
              <p className="text-sm text-muted-foreground">Points settings saved.</p>
            )}
            <Button type="submit" disabled={isPending} className="self-start">
              {isPending ? "Saving..." : "Save points settings"}
            </Button>
          </div>
        </form>
      </Form>

      <AlertDialog open={!!pendingSave} onOpenChange={(open) => !open && setPendingSave(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Update member points?</AlertDialogTitle>
            <AlertDialogDescription>{confirmation}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (pendingSave) save(pendingSave);
                setPendingSave(null);
              }}
            >
              Save and apply
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
