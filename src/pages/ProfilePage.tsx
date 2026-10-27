import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertCircle, CheckCircle2, LogOut } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { useLocation } from "react-router-dom";
import { z } from "zod";

import { ImageUpload } from "@/components/admin/ImageUpload";
import { CustomFieldInput } from "@/components/CustomFieldInput";
import { PointsCard } from "@/components/PointsCard";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { UserAvatar } from "@/components/UserAvatar";
import { queryKeys } from "@/constants/query-keys";
import { ApiRoutes, PROFILE_POINTS_ANCHOR } from "@/constants/routes";
import {
  type CustomFieldValues,
  type ImageEntry,
  type MemberFieldDefinition,
  type UserProfile,
} from "@/constants/types";
import { useAuth } from "@/context/auth";
import { useMemberFields } from "@/hooks/useMemberFields";
import { usePoints } from "@/hooks/usePoints";
import { apiClient } from "@/lib/api-client";
import { buildCustomFieldsSchema, isEmptyFieldValue } from "@/lib/member-fields";
import { spring } from "@/lib/motion";
import { getDocumentOffsetTop, getImageSrc, resolveImageEntry } from "@/lib/utils";

const FADE_UP = {
  initial: { opacity: 0, y: 20 },
  animate: { opacity: 1, y: 0 },
};

type ProfileFormValues = {
  name: string;
  customFields: CustomFieldValues;
};

function getMissingFields(defs: MemberFieldDefinition[], profile: UserProfile): string[] {
  return defs
    .filter((d) => d.required && isEmptyFieldValue(profile.customFields[d.key]))
    .map((d) => d.label);
}

export function ProfilePage() {
  const queryClient = useQueryClient();
  const { logout, updateUser, login, user } = useAuth();
  const { enabled: pointsEnabled } = usePoints();
  const { hash } = useLocation();
  const reduceMotion = useReducedMotion();
  const [imageEntry, setImageEntry] = useState<ImageEntry>({ type: "none" });

  const { data: profile, isLoading } = useQuery({
    queryKey: queryKeys.me(),
    queryFn: () => apiClient.get<UserProfile>(ApiRoutes.USERS_ME),
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });

  const { data: fieldDefs, isLoading: isLoadingFields } = useMemberFields();
  const defs = useMemo(() => fieldDefs ?? [], [fieldDefs]);

  const formSchema = useMemo(
    () =>
      z.object({
        name: z.string().min(2, { message: "Name must be at least 2 characters" }),
        customFields: buildCustomFieldsSchema(defs, { enforceRequired: false }),
      }),
    [defs]
  );

  const { mutate: updateMe, isPending } = useMutation({
    mutationFn: async ({
      imageEntry: img,
      ...values
    }: ProfileFormValues & { imageEntry: ImageEntry }) => {
      const imageUrl = await resolveImageEntry(img, ApiRoutes.UPLOAD_PRESIGNED);
      return apiClient.patch<UserProfile & { token?: string }>(ApiRoutes.USERS_ME, {
        ...values,
        imageUrl,
      });
    },
    onSuccess: ({ token, ...updated }) => {
      if (token) {
        login(token);
      } else {
        updateUser({
          name: updated.name,
          imageUrl: updated.imageUrl,
          profileCompleted: updated.profileCompleted,
        });
      }
      queryClient.setQueryData(queryKeys.me(), updated);
    },
  });

  const form = useForm<ProfileFormValues>({
    resolver: zodResolver(formSchema),
  });

  useEffect(() => {
    if (!profile || !fieldDefs) return;
    setImageEntry(
      profile.imageUrl ? { type: "existing", url: profile.imageUrl } : { type: "none" }
    );
    form.reset({
      name: profile.name,
      customFields: Object.fromEntries(
        fieldDefs.map((d) => [d.key, profile.customFields[d.key] ?? null])
      ),
    });
  }, [profile, fieldDefs, form]);

  const isReady = !isLoading && !isLoadingFields;

  useEffect(() => {
    if (!isReady || !pointsEnabled || hash !== `#${PROFILE_POINTS_ANCHOR}`) return;
    const frame = requestAnimationFrame(() => {
      const section = document.getElementById(PROFILE_POINTS_ANCHOR);
      if (!section) return;
      const margin = parseFloat(getComputedStyle(section).scrollMarginTop) || 0;
      window.scrollTo({
        top: getDocumentOffsetTop(section) - margin,
        behavior: reduceMotion ? "auto" : "smooth",
      });
    });
    return () => cancelAnimationFrame(frame);
  }, [isReady, pointsEnabled, hash, reduceMotion]);

  function handleSubmit(values: ProfileFormValues) {
    updateMe({ ...values, imageEntry });
  }

  if (isLoading || isLoadingFields) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <p className="text-sm text-muted-foreground">Loading profile...</p>
      </div>
    );
  }

  if (!profile) return null;

  const missingFields = getMissingFields(defs, profile);
  const isComplete = user?.profileCompleted ?? profile.profileCompleted;

  return (
    <div className="relative">
      {/* Atmospheric background */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute right-0 top-0 size-[500px] -translate-y-1/4 translate-x-1/4 rounded-full bg-primary/10 blur-[100px]" />
        <div className="absolute bottom-0 left-0 size-[400px] translate-y-1/4 -translate-x-1/4 rounded-full bg-chart-2/10 blur-[80px]" />
      </div>

      <div className="relative mx-auto max-w-lg space-y-6 px-4 py-10">
        {/* Header */}
        <motion.div
          {...FADE_UP}
          transition={{ ...spring.smooth }}
          className="flex items-start justify-between"
        >
          <div className="flex min-w-0 items-center gap-4">
            <UserAvatar
              name={profile.name}
              imageUrl={getImageSrc(imageEntry)}
              className="size-14 shrink-0 text-xl"
            />
            <div className="min-w-0">
              <h1 className="truncate text-heading text-foreground">{profile.name}</h1>
              <p className="truncate text-sm text-muted-foreground">{profile.email}</p>
            </div>
          </div>
          <Button variant="outline" size="sm" className="shrink-0" onClick={logout}>
            <LogOut className="size-4" />
            Log out
          </Button>
        </motion.div>

        {/* Profile status banner */}
        <motion.div {...FADE_UP} transition={{ ...spring.smooth, delay: 0.08 }}>
          {isComplete ? (
            <div className="flex items-center gap-3 rounded-lg border border-green-200 bg-green-50 px-4 py-3 dark:border-green-900/40 dark:bg-green-950/20">
              <CheckCircle2 className="size-4 shrink-0 text-green-600 dark:text-green-400" />
              <p className="text-sm font-medium text-green-800 dark:text-green-400">
                Your profile is complete
              </p>
            </div>
          ) : (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 dark:border-amber-900/40 dark:bg-amber-950/20">
              <div className="flex items-start gap-3">
                <AlertCircle className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" />
                <div>
                  <p className="text-sm font-medium text-amber-800 dark:text-amber-400">
                    Profile incomplete
                  </p>
                  <p className="mt-0.5 text-sm text-amber-700 dark:text-amber-500">
                    Fill in the following to unlock full access:
                  </p>
                  <ul className="mt-2 space-y-1">
                    {missingFields.map((field) => (
                      <li
                        key={field}
                        className="flex items-center gap-2 text-sm text-amber-700 dark:text-amber-500"
                      >
                        <span className="size-1.5 rounded-full bg-amber-500" />
                        {field}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
          )}
        </motion.div>

        {pointsEnabled && (
          <motion.div
            id={PROFILE_POINTS_ANCHOR}
            className="scroll-mt-24"
            {...FADE_UP}
            transition={{ ...spring.smooth, delay: 0.12 }}
          >
            <PointsCard />
          </motion.div>
        )}

        {/* Avatar card */}
        <motion.div {...FADE_UP} transition={{ ...spring.smooth, delay: 0.16 }}>
          <Card>
            <CardHeader>
              <CardTitle>Profile photo</CardTitle>
              <CardDescription>JPG, PNG or WebP. Max 5 MB.</CardDescription>
            </CardHeader>
            <CardContent>
              <ImageUpload
                state={imageEntry}
                onChange={setImageEntry}
                variant="avatar"
                name={profile.name}
                maxSizeBytes={5 * 1024 * 1024}
                crop
              />
            </CardContent>
          </Card>
        </motion.div>

        {/* Personal info card */}
        <motion.div {...FADE_UP} transition={{ ...spring.smooth, delay: 0.24 }}>
          <Card>
            <CardHeader>
              <CardTitle>Personal information</CardTitle>
              <CardDescription>
                {isComplete
                  ? "Update your details below"
                  : "Complete the required fields to access the platform"}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Form {...form}>
                <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-4">
                  <FormField
                    control={form.control}
                    name="name"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Name</FormLabel>
                        <FormControl>
                          <Input {...field} value={field.value ?? ""} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  {defs.map((def) => (
                    <CustomFieldInput
                      key={def.id}
                      def={def}
                      control={form.control}
                      showRequired={
                        def.required && isEmptyFieldValue(profile.customFields[def.key])
                      }
                    />
                  ))}
                  <div className="flex justify-end pt-1">
                    <Button type="submit" disabled={isPending}>
                      {isPending ? "Saving..." : "Save changes"}
                    </Button>
                  </div>
                </form>
              </Form>
            </CardContent>
          </Card>
        </motion.div>
      </div>
    </div>
  );
}
