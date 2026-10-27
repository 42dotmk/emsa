import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type ColumnDef, flexRender, getCoreRowModel, useReactTable } from "@tanstack/react-table";
import {
  ArrowLeft,
  Award,
  CalendarDays,
  Check,
  ChevronsUpDown,
  FileDown,
  Pencil,
  Plus,
  Search,
  Trash2,
  Upload,
  UserPlus,
  Users,
  X,
} from "lucide-react";
import { type ChangeEvent, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";

import { DataTableEmptyRow } from "@/components/admin/DataTableEmptyRow";
import {
  type DraftCapacityPool,
  type DraftPackage,
  ProjectDialog,
} from "@/components/admin/ProjectDialog";
import { RowActions } from "@/components/admin/RowActions";
import { WorkshopDialog } from "@/components/admin/WorkshopDialog";
import { PointsAmount } from "@/components/PointsAmount";
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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Role } from "@/constants/enums";
import { queryKeys } from "@/constants/query-keys";
import { ApiRoutes, PageRoutes } from "@/constants/routes";
import type { ProjectFormValues, WorkshopFormValues } from "@/constants/schemas";
import {
  type ActiveImageEntry,
  type AdminUser,
  type CsvColumn,
  type Project,
  type ProjectPackage,
  type ProjectRegistration,
  type Workshop,
  type WorkshopRegistration,
} from "@/constants/types";
import { useAuth } from "@/context/auth";
import { useDialogState } from "@/hooks/useDialogState";
import { usePoints } from "@/hooks/usePoints";
import { apiClient } from "@/lib/api-client";
import {
  cn,
  exportToCsv,
  formatDate,
  formatDateTime,
  getInitials,
  hasAccess,
  resolveImageEntry,
  stripHtml,
  uploadFileToR2,
} from "@/lib/utils";

// ─── Capacity Summary (from ProjectsPage) ──────────────────────────────────

function CapacitySummary({
  project,
  packages,
  registrationCount,
}: {
  project: Project;
  packages: ProjectPackage[];
  registrationCount: number;
}) {
  if (packages.length === 0) {
    const max = project.maxParticipants;
    if (max === null) {
      return (
        <p className="text-xs text-muted-foreground">
          <span className="font-medium text-foreground">{registrationCount}</span> registered ·
          Unlimited capacity
        </p>
      );
    }
    const available = Math.max(0, max - registrationCount);
    return (
      <div className="space-y-1.5">
        <div className="flex items-center justify-between text-xs">
          <span className="text-muted-foreground">
            <span className="font-medium text-foreground">{registrationCount}</span> / {max}{" "}
            registered
          </span>
          <span
            className={cn(
              "font-medium",
              available === 0 ? "text-destructive" : "text-emerald-600 dark:text-emerald-400"
            )}
          >
            {available === 0 ? "Full" : `${available} left`}
          </span>
        </div>
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
          <div
            className={cn(
              "h-full rounded-full transition-all",
              available === 0 ? "bg-destructive" : "bg-primary"
            )}
            style={{ width: `${Math.min(100, (registrationCount / max) * 100)}%` }}
          />
        </div>
      </div>
    );
  }

  type CapacityRow =
    | { kind: "package"; pkg: ProjectPackage }
    | {
        kind: "pool";
        poolId: string;
        poolName: string | null;
        poolMax: number;
        availableSpots: number | null;
        pkgs: ProjectPackage[];
      };

  const seenPools = new Set<string>();
  const rows: CapacityRow[] = [];

  for (const pkg of packages) {
    if (pkg.capacityPoolId) {
      if (!seenPools.has(pkg.capacityPoolId)) {
        seenPools.add(pkg.capacityPoolId);
        rows.push({
          kind: "pool",
          poolId: pkg.capacityPoolId,
          poolName: pkg.capacityPoolName,
          poolMax: pkg.capacityPoolMax ?? 0,
          availableSpots: pkg.availableSpots,
          pkgs: packages.filter((p) => p.capacityPoolId === pkg.capacityPoolId),
        });
      }
    } else {
      rows.push({ kind: "package", pkg });
    }
  }

  return (
    <div className="space-y-3">
      {rows.map((row) => {
        if (row.kind === "pool") {
          const registered = row.availableSpots !== null ? row.poolMax - row.availableSpots : null;
          const full = row.availableSpots === 0;
          const pct =
            registered !== null && row.poolMax > 0
              ? Math.min(100, (registered / row.poolMax) * 100)
              : 0;
          return (
            <div key={row.poolId} className="space-y-1">
              <div className="flex items-center justify-between text-xs">
                <span className="font-medium">{row.poolName ?? "Shared pool"}</span>
                <span className="tabular-nums text-muted-foreground">
                  {registered !== null ? `${registered} / ${row.poolMax}` : `— / ${row.poolMax}`}
                  {" · "}
                  <span
                    className={cn(
                      "font-medium",
                      full ? "text-destructive" : "text-emerald-600 dark:text-emerald-400"
                    )}
                  >
                    {full
                      ? "Full"
                      : row.availableSpots !== null
                        ? `${row.availableSpots} left`
                        : "Unlimited"}
                  </span>
                </span>
              </div>
              <div className="h-1 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className={cn(
                    "h-full rounded-full transition-all",
                    full ? "bg-destructive" : "bg-primary"
                  )}
                  style={{ width: `${pct}%` }}
                />
              </div>
              <p className="text-xs text-muted-foreground">
                {row.pkgs.map((p) => p.name).join(", ")}
              </p>
            </div>
          );
        }

        const { pkg } = row;
        if (pkg.availableSpots === null) {
          return (
            <div key={pkg.id} className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">{pkg.name}</span>
              <span className="text-muted-foreground">Unlimited</span>
            </div>
          );
        }
        const max = pkg.maxParticipants ?? 0;
        const registered = max - pkg.availableSpots;
        const full = pkg.availableSpots === 0;
        const pct = max > 0 ? Math.min(100, (registered / max) * 100) : 0;
        return (
          <div key={pkg.id} className="space-y-1">
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">{pkg.name}</span>
              <span className="tabular-nums text-muted-foreground">
                {registered} / {max}
                {" · "}
                <span
                  className={cn(
                    "font-medium",
                    full ? "text-destructive" : "text-emerald-600 dark:text-emerald-400"
                  )}
                >
                  {full ? "Full" : `${pkg.availableSpots} left`}
                </span>
              </span>
            </div>
            <div className="h-1 w-full overflow-hidden rounded-full bg-muted">
              <div
                className={cn(
                  "h-full rounded-full transition-all",
                  full ? "bg-destructive" : "bg-primary"
                )}
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Certificate Cell ───────────────────────────────────────────────────────

function CertificateCell({ reg, onRefresh }: { reg: ProjectRegistration; onRefresh: () => void }) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { mutate: saveCert, isPending: isSaving } = useMutation({
    mutationFn: (body: { url: string; filename: string }) =>
      apiClient.post(ApiRoutes.ADMIN_REGISTRATION_CERTIFICATE.replace(":id", reg.id), body),
    onSuccess: () => {
      setError(null);
      onRefresh();
    },
    onError: (err) => setError(err.message),
  });

  const { mutate: deleteCert, isPending: isDeleting } = useMutation({
    mutationFn: () =>
      apiClient.delete(ApiRoutes.ADMIN_REGISTRATION_CERTIFICATE.replace(":id", reg.id)),
    onSuccess: () => {
      setError(null);
      onRefresh();
    },
    onError: (err) => setError(err.message),
  });

  const isWorking = uploading || isSaving;

  async function handleFileChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      const uploadRoute = ApiRoutes.ADMIN_REGISTRATION_CERTIFICATE_UPLOAD.replace(":id", reg.id);
      const fileUrl = await uploadFileToR2(file, uploadRoute);
      saveCert({ url: fileUrl, filename: file.name });
    } catch {
      setError("Upload failed. Please try again.");
    } finally {
      setUploading(false);
    }
  }

  if (reg.certificateUrl) {
    return (
      <div className="flex flex-col items-end gap-0.5">
        <div className="flex items-center gap-1">
          <a
            href={reg.certificateUrl}
            target="_blank"
            rel="noopener noreferrer"
            download={reg.certificateFilename ?? undefined}
            className="flex items-center gap-1 text-xs text-primary hover:underline"
          >
            <Award className="size-3" />
            Certificate
          </a>
          <button
            onClick={() => deleteCert()}
            disabled={isDeleting}
            className="ml-1 rounded p-0.5 text-muted-foreground hover:text-destructive"
            aria-label="Remove certificate"
          >
            <X className="size-3" />
          </button>
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={isWorking}
            className="rounded p-0.5 text-muted-foreground hover:text-foreground"
            aria-label="Replace certificate"
          >
            <Upload className="size-3" />
          </button>
        </div>
        {error && <p className="text-xs text-destructive">{error}</p>}
        <input
          ref={fileInputRef}
          type="file"
          accept=".pdf,.jpg,.jpeg,.png,.webp"
          className="sr-only"
          onChange={handleFileChange}
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col items-end gap-0.5">
      <button
        onClick={() => fileInputRef.current?.click()}
        disabled={isWorking}
        className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
      >
        <Upload className="size-3" />
        {isWorking ? "Uploading..." : "Upload certificate"}
      </button>
      {error && <p className="text-xs text-destructive">{error}</p>}
      <input
        ref={fileInputRef}
        type="file"
        accept=".pdf,.jpg,.jpeg,.png,.webp"
        className="sr-only"
        onChange={handleFileChange}
      />
    </div>
  );
}

// ─── CSV columns ────────────────────────────────────────────────────────────

const REGISTRATION_CSV_COLUMNS: CsvColumn<ProjectRegistration>[] = [
  { header: "Name", value: (r) => r.userName },
  { header: "Email", value: (r) => r.userEmail },
  { header: "Package", value: (r) => r.packageName ?? "" },
  { header: "Attended", value: (r) => (r.attended ? "Yes" : "No") },
  { header: "Certificate", value: (r) => r.certificateFilename ?? "" },
  { header: "Registered", value: (r) => formatDateTime(r.createdAt) },
];

// ─── Add Participant Dialog ──────────────────────────────────────────────────

function AddParticipantDialog({
  availableUsers,
  packages,
  isPending,
  error,
  onAdd,
}: {
  availableUsers: AdminUser[];
  packages: ProjectPackage[];
  isPending: boolean;
  error: string | null;
  onAdd: (userId: string, packageId: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [comboOpen, setComboOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [selectedUserId, setSelectedUserId] = useState("");
  const [selectedPackageId, setSelectedPackageId] = useState("");

  const hasPackages = packages.length > 0;

  const filteredUsers = availableUsers.filter(
    (u) =>
      u.name.toLowerCase().includes(search.toLowerCase()) ||
      u.email.toLowerCase().includes(search.toLowerCase())
  );

  const selectedUser = availableUsers.find((u) => u.id === selectedUserId);

  function handleAdd() {
    if (!selectedUserId) return;
    onAdd(selectedUserId, selectedPackageId || null);
  }

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (!next) {
      setSelectedUserId("");
      setSelectedPackageId("");
      setSearch("");
      setComboOpen(false);
    }
  }

  const wasAddingRef = useRef(false);
  useEffect(() => {
    if (isPending) {
      wasAddingRef.current = true;
    } else if (wasAddingRef.current && !error) {
      wasAddingRef.current = false;
      handleOpenChange(false);
    } else if (!isPending) {
      wasAddingRef.current = false;
    }
  }, [isPending, error]);

  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        <UserPlus className="size-4" />
        Add Participant
      </Button>

      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add Participant</DialogTitle>
          </DialogHeader>

          <div className="flex flex-col gap-4 py-2">
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium">User</label>
              <Popover open={comboOpen} onOpenChange={setComboOpen}>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    role="combobox"
                    aria-expanded={comboOpen}
                    className="w-full justify-between font-normal"
                  >
                    {selectedUser ? (
                      <span className="truncate">
                        {selectedUser.name}
                        <span className="ml-1.5 text-muted-foreground">{selectedUser.email}</span>
                      </span>
                    ) : (
                      <span className="text-muted-foreground">Search by name or email...</span>
                    )}
                    <ChevronsUpDown className="ml-2 size-4 shrink-0 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
                  <div className="border-b p-2">
                    <div className="relative">
                      <Search className="absolute left-2.5 top-2 size-3.5 text-muted-foreground" />
                      <Input
                        placeholder="Search..."
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        className="h-8 pl-8 text-sm"
                        autoFocus
                      />
                    </div>
                  </div>
                  <div className="max-h-56 overflow-y-auto">
                    {filteredUsers.length === 0 ? (
                      <p className="px-3 py-4 text-center text-sm text-muted-foreground">
                        No users found.
                      </p>
                    ) : (
                      filteredUsers.map((u) => (
                        <button
                          key={u.id}
                          type="button"
                          onClick={() => {
                            setSelectedUserId(u.id);
                            setComboOpen(false);
                            setSearch("");
                          }}
                          className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left text-sm hover:bg-accent"
                        >
                          <Check
                            className={cn(
                              "size-4 shrink-0 text-primary",
                              selectedUserId === u.id ? "opacity-100" : "opacity-0"
                            )}
                          />
                          <div className="min-w-0">
                            <p className="truncate font-medium">{u.name}</p>
                            <p className="truncate text-xs text-muted-foreground">{u.email}</p>
                          </div>
                        </button>
                      ))
                    )}
                  </div>
                </PopoverContent>
              </Popover>
            </div>

            {hasPackages && (
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium">Package</label>
                <Select value={selectedPackageId} onValueChange={setSelectedPackageId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select package..." />
                  </SelectTrigger>
                  <SelectContent>
                    {packages.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {error && <p className="text-sm text-destructive">{error}</p>}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => handleOpenChange(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleAdd}
              disabled={!selectedUserId || (hasPackages && !selectedPackageId) || isPending}
            >
              {isPending ? "Adding..." : "Add Participant"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ─── Registrations Tab ──────────────────────────────────────────────────────

function RegistrationsTab({ project }: { project: Project }) {
  const { enabled: pointsEnabled } = usePoints();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const isSuperAdmin = hasAccess(user?.role ?? Role.USER, Role.SUPER_ADMIN);
  const isAdmin = hasAccess(user?.role ?? Role.USER, Role.ADMIN);
  const [addError, setAddError] = useState<string | null>(null);
  const [packageFilter, setPackageFilter] = useState<string>("all");
  const [listSearch, setListSearch] = useState("");

  const registrationsQueryKey = queryKeys.admin.projectRegistrations(project.id);

  const { data: registrations = [], isLoading } = useQuery({
    queryKey: [...registrationsQueryKey, packageFilter],
    queryFn: () => {
      const base = ApiRoutes.ADMIN_PROJECT_REGISTRATIONS.replace(":id", project.id);
      const url = packageFilter !== "all" ? `${base}?packageId=${packageFilter}` : base;
      return apiClient.get<ProjectRegistration[]>(url);
    },
  });

  const { data: allUsers = [] } = useQuery({
    queryKey: queryKeys.admin.users(),
    queryFn: () => apiClient.get<AdminUser[]>(ApiRoutes.ADMIN_USERS),
    enabled: isSuperAdmin,
  });

  const { data: packages = [], isLoading: isPackagesLoading } = useQuery<ProjectPackage[]>({
    queryKey: queryKeys.admin.projectPackages(project.id),
    queryFn: () =>
      apiClient.get<ProjectPackage[]>(ApiRoutes.ADMIN_PROJECT_PACKAGES.replace(":id", project.id)),
  });

  const { mutate: toggleAttended } = useMutation({
    mutationFn: ({ id, attended }: { id: string; attended: boolean }) =>
      apiClient.patch(ApiRoutes.ADMIN_PROJECT_REGISTRATION_BY_ID.replace(":id", id), { attended }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: registrationsQueryKey });
      queryClient.invalidateQueries({ queryKey: queryKeys.admin.users() });
      queryClient.invalidateQueries({ queryKey: queryKeys.me() });
    },
  });

  const { mutate: addRegistration, isPending: isAdding } = useMutation({
    mutationFn: ({ userId, packageId }: { userId: string; packageId: string | null }) =>
      apiClient.post(ApiRoutes.ADMIN_PROJECT_REGISTRATIONS.replace(":id", project.id), {
        userId,
        ...(packageId && { packageId }),
      }),
    onSuccess: () => {
      setAddError(null);
      queryClient.invalidateQueries({ queryKey: registrationsQueryKey });
      queryClient.invalidateQueries({ queryKey: queryKeys.admin.projectPackages(project.id) });
    },
    onError: (err) => setAddError(err.message),
  });

  const { mutate: deleteRegistration } = useMutation({
    mutationFn: (id: string) =>
      apiClient.delete(ApiRoutes.ADMIN_PROJECT_REGISTRATION_BY_ID.replace(":id", id)),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: registrationsQueryKey });
      queryClient.invalidateQueries({ queryKey: queryKeys.admin.projectPackages(project.id) });
    },
  });

  const registeredUserIds = new Set(registrations.map((r) => r.userId));
  const availableUsers = allUsers.filter((u) => !registeredUserIds.has(u.id));
  const hasPackages = packages.length > 0;

  const filteredRegistrations = registrations.filter(
    (r) =>
      r.userName.toLowerCase().includes(listSearch.toLowerCase()) ||
      r.userEmail.toLowerCase().includes(listSearch.toLowerCase())
  );

  function handleExport() {
    const slug = project.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
    exportToCsv(
      registrations,
      REGISTRATION_CSV_COLUMNS,
      `project-participants-${slug}-${new Date().toISOString().slice(0, 10)}.csv`
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {project.registrationOpensAt && !isLoading && !isPackagesLoading && (
        <div className="rounded-md border p-4">
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Capacity
          </p>
          <CapacitySummary
            project={project}
            packages={packages}
            registrationCount={registrations.length}
          />
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          {hasPackages && (
            <Select value={packageFilter} onValueChange={setPackageFilter}>
              <SelectTrigger className="h-8 w-44 text-xs">
                <SelectValue placeholder="All packages" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All packages</SelectItem>
                {packages.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          {!hasPackages && (
            <span className="text-sm text-muted-foreground">
              {registrations.length} participant{registrations.length !== 1 ? "s" : ""}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {isSuperAdmin && (
            <AddParticipantDialog
              availableUsers={availableUsers}
              packages={packages}
              isPending={isAdding}
              error={addError}
              onAdd={(userId, packageId) => addRegistration({ userId, packageId })}
            />
          )}
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="outline"
                  size="icon"
                  className="h-8 w-8 shrink-0"
                  onClick={handleExport}
                  disabled={registrations.length === 0}
                >
                  <FileDown className="size-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Export CSV</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading...</p>
      ) : registrations.length === 0 ? (
        <p className="text-sm text-muted-foreground">No participants yet.</p>
      ) : (
        <>
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
            <Input
              placeholder="Filter by name or email..."
              value={listSearch}
              onChange={(e) => setListSearch(e.target.value)}
              className="pl-8"
            />
          </div>

          {filteredRegistrations.length === 0 ? (
            <p className="text-sm text-muted-foreground">No participants match your search.</p>
          ) : (
            <div className="rounded-md border">
              <ul className="divide-y">
                {filteredRegistrations.map((reg) => (
                  <li key={reg.id} className="flex items-center gap-3 px-4 py-3">
                    <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium">
                      {getInitials(reg.userName)}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{reg.userName}</p>
                      <p className="truncate text-xs text-muted-foreground">{reg.userEmail}</p>
                      {reg.packageName && (
                        <p className="text-xs font-medium text-primary">{reg.packageName}</p>
                      )}
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1.5">
                      <div className="flex items-center gap-1.5">
                        <Switch
                          id={`attended-${reg.id}`}
                          checked={reg.attended}
                          onCheckedChange={(checked) =>
                            toggleAttended({ id: reg.id, attended: checked })
                          }
                        />
                        <label
                          htmlFor={`attended-${reg.id}`}
                          className="text-xs text-muted-foreground"
                        >
                          Attended
                        </label>
                        {pointsEnabled && reg.pointsAwarded > 0 && (
                          <PointsAmount
                            amount={reg.pointsAwarded}
                            signed
                            className="text-xs text-green-600 dark:text-green-400"
                          />
                        )}
                        {isSuperAdmin && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-7 text-muted-foreground hover:text-destructive"
                            onClick={() => deleteRegistration(reg.id)}
                          >
                            <Trash2 className="size-3.5" />
                          </Button>
                        )}
                      </div>
                      {isAdmin && (
                        <CertificateCell
                          reg={reg}
                          onRefresh={() =>
                            queryClient.invalidateQueries({ queryKey: registrationsQueryKey })
                          }
                        />
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ─── Workshop Registrations Sheet ───────────────────────────────────────────

const WORKSHOP_CSV_COLUMNS: CsvColumn<WorkshopRegistration>[] = [
  { header: "Name", value: (r) => r.userName },
  { header: "Email", value: (r) => r.userEmail },
  { header: "Attended", value: (r) => (r.attended ? "Yes" : "No") },
  { header: "Registered", value: (r) => formatDateTime(r.createdAt) },
];

function WorkshopRegistrationsSheet({
  workshop,
  onClose,
}: {
  workshop: Workshop | undefined;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const isSuperAdmin = hasAccess(user?.role ?? Role.USER, Role.SUPER_ADMIN);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  // Add participant dialog state
  const [addOpen, setAddOpen] = useState(false);
  const [addComboOpen, setAddComboOpen] = useState(false);
  const [addSearch, setAddSearch] = useState("");
  const [addSelectedUserId, setAddSelectedUserId] = useState("");
  const [addError, setAddError] = useState<string | null>(null);

  const queryKey = queryKeys.admin.workshopRegistrations(workshop?.id ?? "");

  const { data: registrations = [], isLoading } = useQuery({
    queryKey,
    queryFn: () =>
      apiClient.get<WorkshopRegistration[]>(
        ApiRoutes.ADMIN_WORKSHOP_REGISTRATIONS.replace(":workshopId", workshop!.id)
      ),
    enabled: !!workshop,
  });

  const { data: projectRegistrations = [] } = useQuery({
    queryKey: queryKeys.admin.projectRegistrations(workshop?.projectId ?? ""),
    queryFn: () =>
      apiClient.get<ProjectRegistration[]>(
        ApiRoutes.ADMIN_PROJECT_REGISTRATIONS.replace(":id", workshop!.projectId)
      ),
    enabled: !!workshop && isSuperAdmin,
  });

  const { mutate: toggleAttended } = useMutation({
    mutationFn: ({ userId, attended }: { userId: string; attended: boolean }) =>
      apiClient.patch(
        ApiRoutes.ADMIN_WORKSHOP_REGISTRATION_ATTENDED.replace(":workshopId", workshop!.id).replace(
          ":userId",
          userId
        ),
        { attended }
      ),
    onSuccess: () => queryClient.invalidateQueries({ queryKey }),
    onError: (err) => setError(err.message),
  });

  const { mutate: deleteReg } = useMutation({
    mutationFn: (userId: string) =>
      apiClient.delete(
        ApiRoutes.ADMIN_WORKSHOP_REGISTRATION_BY_ID.replace(":workshopId", workshop!.id).replace(
          ":userId",
          userId
        )
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
      queryClient.invalidateQueries({
        queryKey: queryKeys.admin.workshops(workshop?.projectId ?? ""),
      });
    },
    onError: (err) => setError(err.message),
  });

  function handleAddOpenChange(next: boolean) {
    setAddOpen(next);
    if (!next) {
      setAddSelectedUserId("");
      setAddSearch("");
      setAddComboOpen(false);
      setAddError(null);
    }
  }

  const wasAddingRef = useRef(false);
  const { mutate: addReg, isPending: isAdding } = useMutation({
    mutationFn: (userId: string) =>
      apiClient.post(ApiRoutes.ADMIN_WORKSHOP_REGISTRATIONS.replace(":workshopId", workshop!.id), {
        userId,
      }),
    onSuccess: () => {
      setAddError(null);
      queryClient.invalidateQueries({ queryKey });
      queryClient.invalidateQueries({
        queryKey: queryKeys.admin.workshops(workshop?.projectId ?? ""),
      });
    },
    onError: (err) => setAddError(err.message),
  });

  useEffect(() => {
    if (isAdding) {
      wasAddingRef.current = true;
    } else if (wasAddingRef.current && !addError) {
      wasAddingRef.current = false;
      handleAddOpenChange(false);
    } else if (!isAdding) {
      wasAddingRef.current = false;
    }
  }, [isAdding, addError]);

  useEffect(() => {
    setError(null);
    setSearch("");
  }, [workshop?.id]);

  const registeredUserIds = new Set(registrations.map((r) => r.userId));
  const availableForAdd = projectRegistrations
    .filter((r) => !registeredUserIds.has(r.userId))
    .map((r) => ({ id: r.userId, name: r.userName, email: r.userEmail }));
  const filteredForAdd = availableForAdd.filter(
    (u) =>
      u.name.toLowerCase().includes(addSearch.toLowerCase()) ||
      u.email.toLowerCase().includes(addSearch.toLowerCase())
  );
  const selectedAddUser = availableForAdd.find((u) => u.id === addSelectedUserId);

  const filteredRegistrations = registrations.filter(
    (r) =>
      r.userName.toLowerCase().includes(search.toLowerCase()) ||
      r.userEmail.toLowerCase().includes(search.toLowerCase())
  );

  function handleExport() {
    if (!workshop) return;
    const slug = workshop.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
    exportToCsv(
      registrations,
      WORKSHOP_CSV_COLUMNS,
      `workshop-participants-${slug}-${new Date().toISOString().slice(0, 10)}.csv`
    );
  }

  return (
    <>
      <Sheet open={!!workshop} onOpenChange={(open) => !open && onClose()}>
        <SheetContent className="flex flex-col gap-0 sm:max-w-md" side="right">
          <SheetHeader className="border-b pb-4">
            <SheetTitle className="flex items-center gap-2">
              <Users className="size-4" />
              Workshop Participants
            </SheetTitle>
            <SheetDescription>{workshop?.title}</SheetDescription>
          </SheetHeader>

          {workshop && (
            <div className="flex items-center justify-between border-b px-4 py-3">
              <span className="text-xs text-muted-foreground">
                {registrations.length} registered
                {workshop.maxParticipants !== null && ` / ${workshop.maxParticipants} max`}
              </span>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleExport}
                  disabled={registrations.length === 0}
                >
                  <FileDown className="size-4" />
                  Export CSV
                </Button>
                {isSuperAdmin && (
                  <Button size="sm" variant="outline" onClick={() => setAddOpen(true)}>
                    <UserPlus className="size-4" />
                    Add Participant
                  </Button>
                )}
              </div>
            </div>
          )}

          {error && <p className="px-4 py-2 text-xs text-destructive">{error}</p>}

          {registrations.length > 0 && (
            <div className="border-b px-4 py-2">
              <div className="relative">
                <Search className="absolute left-2.5 top-2 size-3.5 text-muted-foreground" />
                <Input
                  placeholder="Filter by name or email..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="h-8 pl-8 text-sm"
                />
              </div>
            </div>
          )}

          <div className="flex-1 overflow-y-auto">
            {isLoading ? (
              <p className="p-4 text-sm text-muted-foreground">Loading...</p>
            ) : registrations.length === 0 ? (
              <p className="p-4 text-sm text-muted-foreground">No participants yet.</p>
            ) : filteredRegistrations.length === 0 ? (
              <p className="p-4 text-sm text-muted-foreground">
                No participants match your search.
              </p>
            ) : (
              <ul className="divide-y">
                {filteredRegistrations.map((reg) => (
                  <li key={reg.id} className="flex items-center gap-3 px-4 py-3">
                    <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium">
                      {getInitials(reg.userName)}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{reg.userName}</p>
                      <p className="truncate text-xs text-muted-foreground">{reg.userEmail}</p>
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5">
                      <Switch
                        id={`ws-attended-${reg.id}`}
                        checked={reg.attended}
                        onCheckedChange={(checked) =>
                          toggleAttended({ userId: reg.userId, attended: checked })
                        }
                      />
                      <label
                        htmlFor={`ws-attended-${reg.id}`}
                        className="text-xs text-muted-foreground"
                      >
                        Attended
                      </label>
                      {isSuperAdmin && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-7 text-muted-foreground hover:text-destructive"
                          onClick={() => deleteReg(reg.userId)}
                        >
                          <Trash2 className="size-3.5" />
                        </Button>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </SheetContent>
      </Sheet>

      {isSuperAdmin && (
        <Dialog open={addOpen} onOpenChange={handleAddOpenChange}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Add Workshop Participant</DialogTitle>
            </DialogHeader>

            <div className="flex flex-col gap-4 py-2">
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium">Project Participant</label>
                <Popover open={addComboOpen} onOpenChange={setAddComboOpen}>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      role="combobox"
                      aria-expanded={addComboOpen}
                      className="w-full justify-between font-normal"
                    >
                      {selectedAddUser ? (
                        <span className="truncate">
                          {selectedAddUser.name}
                          <span className="ml-1.5 text-muted-foreground">
                            {selectedAddUser.email}
                          </span>
                        </span>
                      ) : (
                        <span className="text-muted-foreground">Search by name or email...</span>
                      )}
                      <ChevronsUpDown className="ml-2 size-4 shrink-0 opacity-50" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
                    <div className="border-b p-2">
                      <div className="relative">
                        <Search className="absolute left-2.5 top-2 size-3.5 text-muted-foreground" />
                        <Input
                          placeholder="Search..."
                          value={addSearch}
                          onChange={(e) => setAddSearch(e.target.value)}
                          className="h-8 pl-8 text-sm"
                          autoFocus
                        />
                      </div>
                    </div>
                    <div className="max-h-56 overflow-y-auto">
                      {availableForAdd.length === 0 ? (
                        <p className="px-3 py-4 text-center text-sm text-muted-foreground">
                          All project participants are already registered.
                        </p>
                      ) : filteredForAdd.length === 0 ? (
                        <p className="px-3 py-4 text-center text-sm text-muted-foreground">
                          No users found.
                        </p>
                      ) : (
                        filteredForAdd.map((u) => (
                          <button
                            key={u.id}
                            type="button"
                            onClick={() => {
                              setAddSelectedUserId(u.id);
                              setAddComboOpen(false);
                              setAddSearch("");
                            }}
                            className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left text-sm hover:bg-accent"
                          >
                            <Check
                              className={cn(
                                "size-4 shrink-0 text-primary",
                                addSelectedUserId === u.id ? "opacity-100" : "opacity-0"
                              )}
                            />
                            <div className="min-w-0">
                              <p className="truncate font-medium">{u.name}</p>
                              <p className="truncate text-xs text-muted-foreground">{u.email}</p>
                            </div>
                          </button>
                        ))
                      )}
                    </div>
                  </PopoverContent>
                </Popover>
              </div>

              {addError && <p className="text-sm text-destructive">{addError}</p>}
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => handleAddOpenChange(false)}>
                Cancel
              </Button>
              <Button
                onClick={() => addSelectedUserId && addReg(addSelectedUserId)}
                disabled={!addSelectedUserId || isAdding}
              >
                {isAdding ? "Adding..." : "Add Participant"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}

// ─── Workshops Tab ──────────────────────────────────────────────────────────

function WorkshopsTab({ project }: { project: Project }) {
  const queryClient = useQueryClient();
  const dialog = useDialogState<Workshop>();
  const [deletingWorkshop, setDeletingWorkshop] = useState<Workshop | undefined>(undefined);
  const [viewingRegistrations, setViewingRegistrations] = useState<Workshop | undefined>(undefined);

  const workshopsQueryKey = queryKeys.admin.workshops(project.id);

  const { data: workshops = [], isLoading } = useQuery({
    queryKey: workshopsQueryKey,
    queryFn: () =>
      apiClient.get<Workshop[]>(ApiRoutes.ADMIN_PROJECT_WORKSHOPS.replace(":id", project.id)),
  });

  const { mutate: createWorkshop, isPending: isCreating } = useMutation({
    mutationFn: (values: WorkshopFormValues) =>
      apiClient.post<Workshop>(
        ApiRoutes.ADMIN_PROJECT_WORKSHOPS.replace(":id", project.id),
        values
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: workshopsQueryKey });
      dialog.close();
    },
  });

  const { mutate: updateWorkshop, isPending: isUpdating } = useMutation({
    mutationFn: ({ id, values }: { id: string; values: WorkshopFormValues }) =>
      apiClient.patch<Workshop>(ApiRoutes.ADMIN_WORKSHOP_BY_ID.replace(":workshopId", id), values),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: workshopsQueryKey });
      dialog.close();
    },
  });

  const { mutate: deleteWorkshop, isPending: isDeleting } = useMutation({
    mutationFn: (id: string) =>
      apiClient.delete(ApiRoutes.ADMIN_WORKSHOP_BY_ID.replace(":workshopId", id)),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: workshopsQueryKey });
      setDeletingWorkshop(undefined);
    },
  });

  function handleSubmit(values: WorkshopFormValues) {
    if (dialog.item) {
      updateWorkshop({ id: dialog.item.id, values });
    } else {
      createWorkshop(values);
    }
  }

  const columns: ColumnDef<Workshop>[] = [
    {
      accessorKey: "title",
      header: "Title",
      cell: ({ row }) => <span className="font-medium">{row.getValue("title")}</span>,
    },
    {
      accessorKey: "startingAt",
      header: "Date / Time",
      cell: ({ row }) => {
        const start = formatDateTime(row.getValue<string>("startingAt"));
        const end = row.original.endingAt;
        return (
          <span className="text-sm text-muted-foreground">
            {end ? `${start} – ${formatDateTime(end)}` : start}
          </span>
        );
      },
    },
    {
      accessorKey: "registeredCount",
      header: "Registered",
      cell: ({ row }) => {
        const count = row.getValue<number>("registeredCount");
        const max = row.original.maxParticipants;
        return (
          <span className="text-sm text-muted-foreground">
            {count}
            {max !== null && ` / ${max}`}
          </span>
        );
      },
    },
    {
      id: "actions",
      header: "",
      cell: ({ row }) => (
        <div className="flex items-center justify-end gap-1">
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-8"
                  onClick={() => setViewingRegistrations(row.original)}
                >
                  <Users className="size-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>View registrations</TooltipContent>
            </Tooltip>
          </TooltipProvider>
          <RowActions
            onEdit={() => dialog.open(row.original)}
            onDelete={() => setDeletingWorkshop(row.original)}
          />
        </div>
      ),
    },
  ];

  const table = useReactTable({
    data: workshops,
    columns,
    getCoreRowModel: getCoreRowModel(),
  });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <span className="text-sm text-muted-foreground">
          {workshops.length} workshop{workshops.length !== 1 ? "s" : ""}
        </span>
        <Button size="sm" onClick={() => dialog.open()}>
          <Plus className="size-4" />
          New Workshop
        </Button>
      </div>

      <div className="overflow-x-auto rounded-md border">
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((hg) => (
              <TableRow key={hg.id}>
                {hg.headers.map((h) => (
                  <TableHead key={h.id}>
                    {flexRender(h.column.columnDef.header, h.getContext())}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <DataTableEmptyRow colSpan={columns.length} message="Loading workshops..." />
            ) : table.getRowModel().rows.length === 0 ? (
              <DataTableEmptyRow colSpan={columns.length} message="No workshops yet." />
            ) : (
              table.getRowModel().rows.map((row) => (
                <TableRow key={row.id}>
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id}>
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <WorkshopDialog
        open={dialog.isOpen}
        onOpenChange={(open) => !open && dialog.close()}
        workshop={dialog.item}
        onSubmit={handleSubmit}
        isPending={isCreating || isUpdating}
      />

      <WorkshopRegistrationsSheet
        workshop={viewingRegistrations}
        onClose={() => setViewingRegistrations(undefined)}
      />

      <AlertDialog
        open={!!deletingWorkshop}
        onOpenChange={(open) => !open && setDeletingWorkshop(undefined)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Workshop</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete <strong>{deletingWorkshop?.title}</strong>? This will
              also remove all workshop registrations.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => deletingWorkshop && deleteWorkshop(deletingWorkshop.id)}
              disabled={isDeleting}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ─── Main Page ───────────────────────────────────────────────────────────────

export function AdminProjectDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<"registrations" | "workshops">("registrations");
  const editDialog = useDialogState<Project>();

  const { data: projects = [], isLoading: isLoadingProjects } = useQuery({
    queryKey: queryKeys.admin.projects(),
    queryFn: () => apiClient.get<Project[]>(ApiRoutes.ADMIN_PROJECTS),
  });

  const project = projects.find((p) => p.id === id);
  const pinnedProject = projects.find((p) => p.isPinned);

  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const { mutate: updateProject, isPending: isUpdating } = useMutation({
    mutationFn: async ({
      payload,
      images,
    }: {
      payload: Omit<ProjectFormValues, "imageUrls">;
      images: ActiveImageEntry[];
    }) => {
      const imageUrls: string[] = [];
      for (const img of images) {
        const url = await resolveImageEntry(img, ApiRoutes.ADMIN_PROJECTS_UPLOAD);
        if (url) imageUrls.push(url);
      }
      return apiClient.patch<Project>(ApiRoutes.ADMIN_PROJECT_BY_ID.replace(":id", id!), {
        ...payload,
        imageUrls,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.admin.projects() });
      editDialog.close();
    },
  });

  const { mutate: deleteProject, isPending: isDeletingProject } = useMutation({
    mutationFn: () => apiClient.delete(ApiRoutes.ADMIN_PROJECT_BY_ID.replace(":id", id!)),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.admin.projects() });
      navigate(PageRoutes.ADMIN_PROJECTS);
    },
  });

  function handleEditSubmit(
    payload: Omit<ProjectFormValues, "imageUrls">,
    images: ActiveImageEntry[],
    _draftPackages: DraftPackage[],
    _draftPools: DraftCapacityPool[]
  ) {
    updateProject({ payload, images });
  }

  if (isLoadingProjects) {
    return (
      <div className="flex flex-col gap-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  if (!project) {
    return (
      <div className="flex flex-col items-center gap-4 py-16 text-center">
        <p className="text-muted-foreground">Project not found.</p>
        <Button asChild variant="outline">
          <Link to={PageRoutes.ADMIN_PROJECTS}>Back to Projects</Link>
        </Button>
      </div>
    );
  }

  const date = project.endingAt
    ? `${formatDate(project.startingAt)} – ${formatDate(project.endingAt)}`
    : formatDate(project.startingAt);

  return (
    <div className="flex min-w-0 flex-col gap-6">
      {/* Header */}
      <div>
        <Button variant="ghost" size="sm" className="mb-4 -ml-2 gap-1" asChild>
          <Link to={PageRoutes.ADMIN_PROJECTS}>
            <ArrowLeft className="size-4" />
            All Projects
          </Link>
        </Button>

        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-title text-foreground">{project.title}</h1>
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
              {project.pillarName && (
                <Badge variant="secondary" className="text-xs">
                  {project.pillarName}
                </Badge>
              )}
              <span className="flex items-center gap-1">
                <CalendarDays className="size-3.5" />
                {date}
              </span>
              {project.description && (
                <span className="max-w-sm truncate">{stripHtml(project.description)}</span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => editDialog.open(project)}>
              <Pencil className="size-4" />
              Edit Project
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="text-destructive hover:text-destructive"
              onClick={() => setConfirmingDelete(true)}
            >
              <Trash2 className="size-4" />
              Delete
            </Button>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b">
        <div className="flex gap-0">
          {(["registrations", "workshops"] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={cn(
                "border-b-2 px-4 py-2 text-sm font-medium capitalize transition-colors",
                activeTab === tab
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              )}
            >
              {tab}
            </button>
          ))}
        </div>
      </div>

      {/* Tab content */}
      {activeTab === "registrations" ? (
        <RegistrationsTab project={project} />
      ) : (
        <WorkshopsTab project={project} />
      )}

      {/* Edit dialog */}
      <ProjectDialog
        open={editDialog.isOpen}
        onOpenChange={(open) => !open && editDialog.close()}
        project={editDialog.item}
        pinnedProject={pinnedProject}
        onSubmit={handleEditSubmit}
        isPending={isUpdating}
      />

      <AlertDialog open={confirmingDelete} onOpenChange={setConfirmingDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Project</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete <strong>{project.title}</strong>? This action cannot
              be undone and will remove all workshops and registrations.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => deleteProject()}
              disabled={isDeletingProject}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
