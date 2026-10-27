import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { arrayMove, rectSortingStrategy, SortableContext, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { zodResolver } from "@hookform/resolvers/zod";
import { useQuery } from "@tanstack/react-query";
import { GripVertical, ImagePlus, Pin, Users, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

import {
  type DraftCapacityPool,
  type DraftPackage,
  PackagesSection,
} from "@/components/admin/PackagesSection";
import { RichTextEditor } from "@/components/admin/RichTextEditor";
import { Button } from "@/components/ui/button";
import { DateTimePicker } from "@/components/ui/date-time-picker";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { queryKeys } from "@/constants/query-keys";
import { ApiRoutes } from "@/constants/routes";
import { type ProjectFormValues } from "@/constants/schemas";
import {
  type ActiveImageEntry,
  type Pillar,
  type Project,
  type ProjectPackage,
} from "@/constants/types";
import { usePillarLabels } from "@/hooks/usePillarLabels";
import { usePoints } from "@/hooks/usePoints";
import { apiClient } from "@/lib/api-client";
import { getImageId, getImageSrc, toDatetimeLocalValue } from "@/lib/utils";

export type { DraftCapacityPool, DraftPackage } from "@/components/admin/PackagesSection";

// ── Form schema ───────────────────────────────────────────────────────────────

const formSchema = z
  .object({
    title: z.string().min(1, "Title is required"),
    description: z.string(),
    startingAt: z.string().min(1, "Starting date is required"),
    endingAt: z.string().optional(),
    pillarId: z.string(),
    registrationOpensAt: z.string().optional(),
    registrationClosesAt: z.string().optional(),
    maxParticipants: z.number().int().min(1, "Must be at least 1").nullable().optional(),
    activeMembersOnly: z.boolean(),
    isPinned: z.boolean(),
    points: z.number().int().min(1, "Must be at least 1").max(100000).nullable().optional(),
  })
  .refine(
    (data) => !(!data.registrationOpensAt && (data.registrationClosesAt || data.maxParticipants)),
    { message: "Registration open date is required", path: ["registrationOpensAt"] }
  )
  .refine(
    (data) =>
      !(
        data.registrationOpensAt &&
        data.registrationClosesAt &&
        new Date(data.registrationClosesAt) <= new Date(data.registrationOpensAt)
      ),
    { message: "Close date must be after open date", path: ["registrationClosesAt"] }
  )
  .refine((data) => !(data.endingAt && new Date(data.endingAt) <= new Date(data.startingAt)), {
    message: "Ending date must be after starting date",
    path: ["endingAt"],
  });

type FormValues = z.infer<typeof formSchema>;

// ── Sortable image ────────────────────────────────────────────────────────────

interface SortableImageProps {
  img: ActiveImageEntry;
  onRemove: () => void;
}

function SortableImage({ img, onRemove }: SortableImageProps) {
  const id = getImageId(img);
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
  });

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.4 : 1,
      }}
      className="group relative aspect-square"
    >
      <img
        src={getImageSrc(img)!}
        alt=""
        className="size-full rounded-md border object-cover"
        draggable={false}
      />
      <button
        type="button"
        {...attributes}
        {...listeners}
        className="absolute left-1 top-1 flex size-5 cursor-grab items-center justify-center rounded-full bg-black/60 text-white opacity-0 transition-opacity group-hover:opacity-100 active:cursor-grabbing"
      >
        <GripVertical className="size-3" />
      </button>
      <button
        type="button"
        onClick={onRemove}
        className="absolute right-1 top-1 flex size-5 items-center justify-center rounded-full bg-black/60 text-white opacity-0 transition-opacity group-hover:opacity-100"
      >
        <X className="size-3" />
      </button>
    </div>
  );
}

// ── Main dialog ───────────────────────────────────────────────────────────────

interface ProjectDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  project?: Project;
  pinnedProject?: Project;
  onSubmit: (
    payload: Omit<ProjectFormValues, "imageUrls">,
    images: ActiveImageEntry[],
    draftPackages: DraftPackage[],
    draftPools: DraftCapacityPool[]
  ) => void;
  isPending: boolean;
}

export function ProjectDialog({
  open,
  onOpenChange,
  project,
  pinnedProject,
  onSubmit,
  isPending,
}: ProjectDialogProps) {
  const { singular, singularLower } = usePillarLabels();
  const { enabled: pointsEnabled, name: pointsName } = usePoints();
  const { data: pillars = [] } = useQuery({
    queryKey: queryKeys.admin.pillars(),
    queryFn: () => apiClient.get<Pillar[]>(ApiRoutes.ADMIN_PILLARS),
  });

  // Shares cache with PackagesSection — placeholderData seeds from the project list so hasPackages
  // is correct immediately on open, and updates reactively as packages are added/removed.
  const { data: livePackages } = useQuery<ProjectPackage[]>({
    queryKey: queryKeys.admin.projectPackages(project?.id ?? ""),
    queryFn: () =>
      apiClient.get<ProjectPackage[]>(ApiRoutes.ADMIN_PROJECT_PACKAGES.replace(":id", project!.id)),
    enabled: !!project?.id,
    placeholderData: project?.packages,
  });

  const [images, setImages] = useState<ActiveImageEntry[]>([]);
  const [draftPackages, setDraftPackages] = useState<DraftPackage[]>([]);
  const [draftPools, setDraftPools] = useState<DraftCapacityPool[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    values: project
      ? {
          title: project.title,
          description: project.description,
          startingAt: toDatetimeLocalValue(project.startingAt),
          endingAt: project.endingAt ? toDatetimeLocalValue(project.endingAt) : "",
          pillarId: project.pillarId ?? "none",
          registrationOpensAt: project.registrationOpensAt
            ? toDatetimeLocalValue(project.registrationOpensAt)
            : "",
          registrationClosesAt: project.registrationClosesAt
            ? toDatetimeLocalValue(project.registrationClosesAt)
            : "",
          maxParticipants: project.maxParticipants ?? undefined,
          activeMembersOnly: project.activeMembersOnly,
          isPinned: project.isPinned,
          points: project.points ?? undefined,
        }
      : {
          title: "",
          description: "",
          startingAt: "",
          endingAt: "",
          pillarId: "none",
          registrationOpensAt: "",
          registrationClosesAt: "",
          maxParticipants: undefined,
          activeMembersOnly: false,
          isPinned: false,
          points: undefined,
        },
  });

  const hasPackages = project ? (livePackages?.length ?? 0) > 0 : draftPackages.length > 0;

  useEffect(() => {
    if (open) {
      setImages(project?.images.map((url) => ({ type: "existing", url })) ?? []);
      if (!project) {
        setDraftPackages([]);
        setDraftPools([]);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setImages((prev) => {
      const oldIndex = prev.findIndex((img) => getImageId(img) === active.id);
      const newIndex = prev.findIndex((img) => getImageId(img) === over.id);
      return arrayMove(prev, oldIndex, newIndex);
    });
  }

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    setImages((prev) => [
      ...prev,
      ...files.map((file) => ({
        type: "new" as const,
        file,
        previewUrl: URL.createObjectURL(file),
      })),
    ]);
    e.target.value = "";
  }

  function removeImage(index: number) {
    setImages((prev) => {
      const img = prev[index];
      if (img?.type === "new") URL.revokeObjectURL(img.previewUrl);
      return prev.filter((_, i) => i !== index);
    });
  }

  function handleOpenChange(open: boolean) {
    if (!open) {
      images.forEach((img) => {
        if (img.type === "new") URL.revokeObjectURL(img.previewUrl);
      });
    }
    onOpenChange(open);
  }

  function handleSubmit(values: FormValues) {
    onSubmit(
      {
        title: values.title,
        description: values.description,
        startingAt: new Date(values.startingAt).toISOString(),
        endingAt: values.endingAt ? new Date(values.endingAt).toISOString() : null,
        pillarId: values.pillarId === "none" ? null : values.pillarId,
        registrationOpensAt: values.registrationOpensAt
          ? new Date(values.registrationOpensAt).toISOString()
          : null,
        registrationClosesAt: values.registrationClosesAt
          ? new Date(values.registrationClosesAt).toISOString()
          : null,
        maxParticipants: hasPackages ? null : (values.maxParticipants ?? null),
        activeMembersOnly: values.activeMembersOnly,
        isPinned: values.isPinned,
        points: values.points ?? null,
      },
      images,
      draftPackages,
      draftPools
    );
  }

  const imageIds = images.map(getImageId);

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="flex max-h-[90vh] max-w-2xl flex-col overflow-hidden">
        <DialogHeader>
          <DialogTitle>{project ? "Edit Project" : "Create Project"}</DialogTitle>
        </DialogHeader>

        <div className="overflow-y-auto pr-1">
          <Form {...form}>
            <form
              id="project-form"
              onSubmit={form.handleSubmit(handleSubmit)}
              className="flex flex-col gap-4"
            >
              <FormField
                control={form.control}
                name="title"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Title</FormLabel>
                    <FormControl>
                      <Input placeholder="Project title" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="description"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Description</FormLabel>
                    <FormControl>
                      <RichTextEditor value={field.value} onChange={field.onChange} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="startingAt"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Starting Date</FormLabel>
                      <FormControl>
                        <DateTimePicker value={field.value} onChange={field.onChange} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="endingAt"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Ending Date</FormLabel>
                      <FormControl>
                        <DateTimePicker value={field.value ?? ""} onChange={field.onChange} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <FormField
                control={form.control}
                name="pillarId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{singular}</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder={`No ${singularLower}`} />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="none">No {singularLower}</SelectItem>
                        {pillars.map((p) => (
                          <SelectItem key={p.id} value={p.id}>
                            {p.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {pointsEnabled && (
                <FormField
                  control={form.control}
                  name="points"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{pointsName} for attending</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          min={1}
                          step={1}
                          inputMode="numeric"
                          placeholder="None"
                          className="w-32"
                          value={field.value ?? ""}
                          onChange={(e) => {
                            const val = e.target.value;
                            field.onChange(val === "" ? null : parseInt(val, 10));
                          }}
                        />
                      </FormControl>
                      <FormDescription>
                        Given to members when they are marked as attended. Leave empty for none.
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              )}

              <div className="flex flex-col gap-3 rounded-md border p-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">Registration</span>
                    {form.watch("registrationOpensAt") && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="size-5 text-muted-foreground hover:text-destructive"
                        onClick={() => {
                          form.setValue("registrationOpensAt", "");
                          form.setValue("registrationClosesAt", "");
                          form.setValue("maxParticipants", undefined);
                          form.setValue("activeMembersOnly", false);
                        }}
                      >
                        <X className="size-3" />
                      </Button>
                    )}
                  </div>
                  <FormField
                    control={form.control}
                    name="activeMembersOnly"
                    render={({ field }) => (
                      <FormItem
                        className={`flex items-center gap-2 space-y-0 transition-opacity ${!form.watch("registrationOpensAt") ? "pointer-events-none opacity-40" : ""}`}
                      >
                        <Users className="size-3.5 text-muted-foreground" />
                        <FormLabel className="cursor-pointer text-xs text-muted-foreground">
                          Active members only
                        </FormLabel>
                        <FormControl>
                          <Switch checked={field.value} onCheckedChange={field.onChange} />
                        </FormControl>
                      </FormItem>
                    )}
                  />
                </div>
                <FormField
                  control={form.control}
                  name="registrationOpensAt"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Opens At</FormLabel>
                      <FormControl>
                        <DateTimePicker value={field.value ?? ""} onChange={field.onChange} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <div
                  className={`grid grid-cols-4 gap-4 transition-opacity ${!form.watch("registrationOpensAt") ? "pointer-events-none opacity-40" : ""}`}
                >
                  <FormField
                    control={form.control}
                    name="registrationClosesAt"
                    render={({ field }) => (
                      <FormItem className="col-span-3">
                        <FormLabel>Closes At</FormLabel>
                        <FormControl>
                          <DateTimePicker value={field.value ?? ""} onChange={field.onChange} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="maxParticipants"
                    render={({ field }) => (
                      <FormItem className="col-span-1">
                        <FormLabel>Max</FormLabel>
                        <FormControl>
                          <Input
                            type="number"
                            min={1}
                            placeholder="∞"
                            value={hasPackages ? "" : (field.value ?? "")}
                            onChange={(e) => {
                              const val = e.target.value;
                              field.onChange(val === "" ? null : parseInt(val, 10));
                            }}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
              </div>

              <PackagesSection
                projectId={project?.id}
                draftPackages={draftPackages}
                draftPools={draftPools}
                onDraftPackagesChange={setDraftPackages}
                onDraftPoolsChange={setDraftPools}
              />

              {!!project && (
                <FormField
                  control={form.control}
                  name="isPinned"
                  render={({ field }) => (
                    <FormItem className="space-y-0">
                      <div className="flex items-center justify-between rounded-md border p-3">
                        <div className="flex items-center gap-2">
                          <Pin className="size-3.5 text-muted-foreground" />
                          <FormLabel className="cursor-pointer text-sm font-medium">
                            Pin this project
                          </FormLabel>
                        </div>
                        <FormControl>
                          <Switch checked={field.value} onCheckedChange={field.onChange} />
                        </FormControl>
                      </div>
                      {field.value && pinnedProject && pinnedProject.id !== project?.id && (
                        <p className="rounded-b-md border border-t-0 border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs font-medium text-amber-700 dark:text-amber-400">
                          &ldquo;{pinnedProject.title}&rdquo; is currently pinned and will be
                          unpinned.
                        </p>
                      )}
                    </FormItem>
                  )}
                />
              )}

              <div className="flex flex-col gap-2">
                <span className="text-sm font-medium">Images</span>
                {images.length > 0 && (
                  <DndContext
                    sensors={sensors}
                    collisionDetection={closestCenter}
                    onDragEnd={handleDragEnd}
                  >
                    <SortableContext items={imageIds} strategy={rectSortingStrategy}>
                      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                        {images.map((img, i) => (
                          <SortableImage
                            key={getImageId(img)}
                            img={img}
                            onRemove={() => removeImage(i)}
                          />
                        ))}
                      </div>
                    </SortableContext>
                  </DndContext>
                )}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  multiple
                  className="hidden"
                  onChange={handleFileSelect}
                />
                <Button
                  type="button"
                  variant="outline"
                  className="w-fit"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <ImagePlus className="size-4" />
                  Add Images
                </Button>
              </div>
            </form>
          </Form>
        </div>

        <DialogFooter className="pt-2">
          <Button type="submit" form="project-form" disabled={isPending} className="sm:ml-auto">
            {isPending ? "Saving..." : project ? "Save changes" : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
