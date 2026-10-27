import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  type ColumnDef,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  useReactTable,
} from "@tanstack/react-table";
import {
  AlertCircle,
  CheckCircle2,
  FileDown,
  Info,
  Pencil,
  Search,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import Papa from "papaparse";
import React, { useMemo, useState } from "react";

import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { DataTableEmptyRow } from "@/components/admin/DataTableEmptyRow";
import { DataTablePagination } from "@/components/admin/DataTablePagination";
import { UserPointsDialog } from "@/components/admin/UserPointsDialog";
import { MembershipBadge } from "@/components/MembershipBadge";
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
import { DatePicker } from "@/components/ui/date-picker";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import { UserAvatar } from "@/components/UserAvatar";
import { MemberFieldType, Role } from "@/constants/enums";
import { queryKeys } from "@/constants/query-keys";
import { ApiRoutes } from "@/constants/routes";
import {
  type BulkImportPayload,
  type BulkImportRow,
  bulkImportRowSchema,
  type CreateActivationPayload,
  type UpdateActivationPayload,
  type UpdateUserPayload,
} from "@/constants/schemas";
import type {
  AdminUser,
  CsvColumn,
  MemberFieldDefinition,
  UserActivation,
} from "@/constants/types";
import { useAuth } from "@/context/auth";
import { useMemberFields } from "@/hooks/useMemberFields";
import { usePoints } from "@/hooks/usePoints";
import { apiClient } from "@/lib/api-client";
import { buildCustomFieldsSchema } from "@/lib/member-fields";
import { exportToCsv, formatDate, formatDateTime, hasAccess, toDateStr } from "@/lib/utils";

const ROLE_LABELS: Record<Role, string> = {
  [Role.USER]: "User",
  [Role.ADMIN]: "Admin",
  [Role.SUPER_ADMIN]: "Super Admin",
};

const ROLE_BADGE_VARIANT: Record<Role, "default" | "secondary" | "outline"> = {
  [Role.USER]: "outline",
  [Role.ADMIN]: "secondary",
  [Role.SUPER_ADMIN]: "default",
};

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

function useColumns(
  defs: MemberFieldDefinition[],
  updateUser: (args: { id: string; payload: UpdateUserPayload }) => void,
  onOpenActivations: (user: AdminUser) => void,
  onDeleteUser: (user: AdminUser) => void,
  onOpenPoints: (user: AdminUser) => void,
  pointsEnabled: boolean,
  isSuperAdmin: boolean,
  currentUserId: string | undefined
): ColumnDef<AdminUser>[] {
  return [
    {
      accessorKey: "name",
      header: "Name",
      cell: ({ row }) => (
        <div className="flex items-center gap-2">
          <UserAvatar
            name={row.original.name}
            imageUrl={row.original.imageUrl}
            className="size-7"
          />
          <span className="font-medium">{row.getValue("name")}</span>
        </div>
      ),
    },
    {
      accessorKey: "email",
      header: "Email",
      cell: ({ row }) => <span className="text-muted-foreground">{row.getValue("email")}</span>,
    },
    ...defs.map<ColumnDef<AdminUser>>((def) => ({
      id: `cf_${def.key}`,
      accessorFn: (row) => row.customFields[def.key] ?? "",
      header: def.label,
      cell: ({ row }) => (
        <span className="text-sm text-muted-foreground">
          {row.original.customFields[def.key] ?? "—"}
        </span>
      ),
    })),
    {
      accessorKey: "profileCompleted",
      header: "Profile",
      cell: ({ row }) =>
        row.getValue<boolean>("profileCompleted") ? (
          <Badge className="bg-green-500 text-white hover:bg-green-500">Complete</Badge>
        ) : (
          <Badge variant="outline" className="text-muted-foreground">
            Incomplete
          </Badge>
        ),
    },
    {
      accessorKey: "role",
      header: "Role",
      cell: ({ row }) => {
        const role = row.getValue<Role>("role");
        if (!isSuperAdmin) {
          return <Badge variant={ROLE_BADGE_VARIANT[role]}>{ROLE_LABELS[role]}</Badge>;
        }
        return (
          <Select
            value={role}
            onValueChange={(value) =>
              updateUser({ id: row.original.id, payload: { role: value as Role } })
            }
          >
            <SelectTrigger className="w-36">
              <SelectValue>
                <Badge variant={ROLE_BADGE_VARIANT[role]}>{ROLE_LABELS[role]}</Badge>
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {Object.values(Role).map((r) => (
                <SelectItem key={r} value={r}>
                  {ROLE_LABELS[r]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        );
      },
    },
    {
      accessorKey: "isActive",
      header: "Active",
      filterFn: (row, _columnId, filterValue: boolean | undefined) => {
        if (filterValue === undefined) return true;
        return row.original.isActive === filterValue;
      },
      cell: ({ row }) => {
        const { isActive, activations } = row.original;
        const today = todayStr();
        const currentPeriod = activations.find((a) => a.startDate <= today && a.endDate >= today);
        const latestExpired = activations[0];
        return (
          <div className="flex flex-col gap-0.5">
            <button onClick={() => onOpenActivations(row.original)} className="w-fit">
              <MembershipBadge isActive={isActive} isAlumni={false} />
            </button>
            {currentPeriod && (
              <span className="text-xs text-muted-foreground">
                until {formatDate(currentPeriod.endDate)}
              </span>
            )}
            {!currentPeriod && latestExpired && (
              <span className="text-xs text-muted-foreground">
                expired {formatDate(latestExpired.endDate)}
              </span>
            )}
          </div>
        );
      },
    },
    {
      id: "activeOnFilter",
      accessorFn: (row) => row.activations,
      header: () => null,
      enableHiding: true,
      filterFn: (row, _columnId, filterDate: string | undefined) => {
        if (!filterDate) return true;
        return row.original.activations.some(
          (a) => a.startDate <= filterDate && a.endDate >= filterDate
        );
      },
      cell: () => null,
    },
    ...(pointsEnabled
      ? [
          {
            accessorKey: "pointsBalance",
            header: "Points",
            cell: ({ row }) => (
              <button
                onClick={() => onOpenPoints(row.original)}
                className="rounded-md px-1.5 py-0.5 hover:bg-accent"
              >
                <PointsAmount amount={row.original.pointsBalance} />
              </button>
            ),
          } satisfies ColumnDef<AdminUser>,
        ]
      : []),
    {
      accessorKey: "isAlumni",
      header: "Alumni",
      filterFn: (row, _columnId, filterValue: boolean | undefined) => {
        if (filterValue === undefined) return true;
        return row.original.isAlumni === filterValue;
      },
      cell: ({ row }) => (
        <Switch
          checked={row.original.isAlumni}
          disabled={!isSuperAdmin}
          onCheckedChange={(checked) =>
            updateUser({ id: row.original.id, payload: { isAlumni: checked } })
          }
        />
      ),
    },
    {
      accessorKey: "createdAt",
      header: "Joined",
      cell: ({ row }) => (
        <span className="text-sm text-muted-foreground">
          {formatDate(row.getValue<string>("createdAt"))}
        </span>
      ),
    },
    ...(isSuperAdmin
      ? [
          {
            id: "actions",
            header: () => null,
            cell: ({ row }) =>
              row.original.id === currentUserId ? null : (
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-7 text-destructive hover:text-destructive"
                  onClick={() => onDeleteUser(row.original)}
                >
                  <Trash2 className="size-3.5" />
                </Button>
              ),
          } satisfies ColumnDef<AdminUser>,
        ]
      : []),
  ];
}

interface InlineEditFormProps {
  form: { startDate: Date | undefined; endDate: Date | undefined };
  onStartChange: (date: Date | undefined) => void;
  onEndChange: (date: Date | undefined) => void;
  onSave: () => void;
  onCancel: () => void;
  error: string | null;
  isSaving: boolean;
}

function InlineEditForm({
  form,
  onStartChange,
  onEndChange,
  onSave,
  onCancel,
  error,
  isSaving,
}: InlineEditFormProps) {
  return (
    <div className="flex flex-col gap-2">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <div className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground">Start date</span>
          <DatePicker value={form.startDate} onChange={onStartChange} placeholder="Start date" />
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground">End date</span>
          <DatePicker
            value={form.endDate}
            onChange={onEndChange}
            placeholder="End date"
            disabled={(date) => (form.startDate ? date < form.startDate : false)}
          />
        </div>
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <div className="flex gap-2">
        <Button size="sm" onClick={onSave} disabled={!form.startDate || !form.endDate || isSaving}>
          Save
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

function buildCsvTemplate(defs: MemberFieldDefinition[]): string {
  const headers = [
    "name",
    "email",
    "role",
    "imageUrl",
    "isAlumni",
    "activationStartDate",
    "activationEndDate",
    ...defs.map((d) => d.key),
  ];
  const example = [
    "Jane Doe",
    "jane@example.com",
    "USER",
    "",
    "false",
    "20.10.2025",
    "20.10.2026",
    ...defs.map((d) => (d.type === MemberFieldType.NUMBER ? "1" : "example")),
  ];
  return [headers.join(","), example.join(",")].join("\n");
}

function downloadCsvTemplate(defs: MemberFieldDefinition[]) {
  const blob = new Blob([buildCsvTemplate(defs)], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "users-import-template.csv";
  a.click();
  URL.revokeObjectURL(url);
}

function parseDateStr(s: string | undefined): string | undefined {
  const trimmed = s?.trim();
  if (!trimmed) return undefined;
  // dd.mm.yyyy → yyyy-mm-dd
  const dotMatch = trimmed.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  if (dotMatch) return `${dotMatch[3]}-${dotMatch[2]}-${dotMatch[1]}`;
  // already yyyy-mm-dd
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
  return trimmed;
}

function preprocessCsvRow(raw: Record<string, string>, defs: MemberFieldDefinition[]) {
  const clean = (s: string | undefined) => s?.trim() || undefined;
  const parseBool = (s: string | undefined) => {
    if (!s?.trim()) return false;
    return ["true", "1", "yes"].includes(s.toLowerCase().trim());
  };
  const parseNum = (s: string | undefined) => {
    if (!s?.trim()) return undefined;
    const n = parseInt(s.trim(), 10);
    return isNaN(n) ? undefined : n;
  };
  return {
    name: clean(raw.name),
    email: clean(raw.email),
    role: clean(raw.role)?.toUpperCase() || undefined,
    imageUrl: clean(raw.imageUrl) ?? clean(raw["image_url"]),
    customFields: Object.fromEntries(
      defs.map((d) => [
        d.key,
        d.type === MemberFieldType.NUMBER
          ? (parseNum(raw[d.key]) ?? null)
          : (clean(raw[d.key]) ?? null),
      ])
    ),
    isAlumni: parseBool(raw.isAlumni ?? raw["is_alumni"]),
    activationStartDate: parseDateStr(raw.activationStartDate ?? raw["activation_start_date"]),
    activationEndDate: parseDateStr(raw.activationEndDate ?? raw["activation_end_date"]),
  };
}

interface ParsedRow {
  raw: Record<string, string>;
  data: BulkImportRow | null;
  error: string | null;
}

interface ImportUsersDialogProps {
  open: boolean;
  defs: MemberFieldDefinition[];
  onClose: () => void;
  onSuccess: () => void;
}

function ImportUsersDialog({ open, defs, onClose, onSuccess }: ImportUsersDialogProps) {
  const [stage, setStage] = useState<"select" | "preview" | "done">("select");
  const [rows, setRows] = useState<ParsedRow[]>([]);
  const [sendWelcomeEmails, setSendWelcomeEmails] = useState(true);
  const [result, setResult] = useState<{ created: number; skipped: number } | null>(null);

  function resetAndClose() {
    setStage("select");
    setRows([]);
    setSendWelcomeEmails(true);
    setResult(null);
    onClose();
  }

  const customFieldsSchema = useMemo(
    () => buildCustomFieldsSchema(defs, { enforceRequired: false }),
    [defs]
  );

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      const parsed = Papa.parse<Record<string, string>>(content, {
        header: true,
        skipEmptyLines: true,
      });
      const validatedRows: ParsedRow[] = parsed.data.map((raw) => {
        const processed = preprocessCsvRow(raw, defs);
        const validation = bulkImportRowSchema.safeParse(processed);
        if (!validation.success) {
          return {
            raw,
            data: null,
            error: validation.error.issues[0]?.message ?? "Invalid row",
          };
        }
        const fieldsValidation = customFieldsSchema.safeParse(validation.data.customFields ?? {});
        if (!fieldsValidation.success) {
          return {
            raw,
            data: null,
            error: fieldsValidation.error.issues[0]?.message ?? "Invalid row",
          };
        }
        return { raw, data: validation.data, error: null };
      });
      setRows(validatedRows);
      if (validatedRows.length > 0) setStage("preview");
    };
    reader.readAsText(file);
    e.target.value = "";
  }

  const validRows = rows.filter((r): r is ParsedRow & { data: BulkImportRow } => r.data !== null);
  const invalidCount = rows.filter((r) => r.error !== null).length;

  const { mutate: importUsers, isPending } = useMutation({
    mutationFn: (payload: BulkImportPayload) =>
      apiClient.post<{ created: number; skipped: Array<{ email: string; reason: string }> }>(
        ApiRoutes.ADMIN_USERS_BULK_IMPORT,
        payload
      ),
    onSuccess: (data) => {
      setResult({ created: data.created, skipped: data.skipped.length });
      setStage("done");
      onSuccess();
    },
  });

  function handleImport() {
    importUsers({ users: validRows.map((r) => r.data), sendWelcomeEmails });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) resetAndClose();
      }}
    >
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {stage === "done" ? "Import complete" : "Import Users from CSV"}
          </DialogTitle>
        </DialogHeader>

        {stage === "select" && (
          <div className="flex flex-col gap-4">
            <p className="text-sm text-muted-foreground">
              Upload a CSV file to bulk-create users. Required columns:{" "}
              <code className="rounded bg-muted px-1 text-xs">name</code>,{" "}
              <code className="rounded bg-muted px-1 text-xs">email</code>.
            </p>
            <label
              htmlFor="csv-upload"
              className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-md border border-dashed px-4 py-8 text-sm text-muted-foreground transition-colors hover:border-primary hover:text-foreground"
            >
              <Upload className="size-6" />
              Click to choose a CSV file
              <input
                id="csv-upload"
                type="file"
                accept=".csv"
                className="sr-only"
                onChange={handleFileChange}
              />
            </label>
            <button
              type="button"
              onClick={() => downloadCsvTemplate(defs)}
              className="self-start text-xs text-primary underline-offset-4 hover:underline"
            >
              Download template CSV
            </button>
            <div className="flex items-center gap-3">
              <Switch checked={sendWelcomeEmails} onCheckedChange={setSendWelcomeEmails} />
              <Label>Send welcome emails</Label>
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Info className="size-4 cursor-help text-muted-foreground" />
                  </TooltipTrigger>
                  <TooltipContent className="max-w-64">
                    Sends a welcome message to each imported user. They will receive a password
                    setup link the first time they try to sign in.
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>
            <div className="flex justify-end">
              <Button variant="outline" onClick={resetAndClose}>
                Cancel
              </Button>
            </div>
          </div>
        )}

        {stage === "preview" && (
          <div className="flex min-w-0 flex-col gap-4">
            <p className="text-sm text-muted-foreground">
              <span className="font-medium text-foreground">{validRows.length} valid</span>
              {invalidCount > 0 && (
                <>
                  {", "}
                  <span className="font-medium text-destructive">{invalidCount} invalid</span>
                  {" — only valid rows will be imported"}
                </>
              )}
            </p>
            <div className="max-h-80 overflow-auto rounded-md border">
              <Table className="min-w-max text-xs">
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-8">#</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead>Image URL</TableHead>
                    {defs.map((def) => (
                      <TableHead key={def.id}>{def.label}</TableHead>
                    ))}
                    <TableHead>Alumni</TableHead>
                    <TableHead>Activation Start</TableHead>
                    <TableHead>Activation End</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row, i) => (
                    <TableRow key={i}>
                      <TableCell className="text-muted-foreground">{i + 1}</TableCell>
                      <TableCell>
                        {row.error ? (
                          <span className="flex items-center gap-1 text-destructive">
                            <AlertCircle className="size-3 shrink-0" />
                            {row.error}
                          </span>
                        ) : (
                          <span className="flex items-center gap-1 text-green-600">
                            <CheckCircle2 className="size-3 shrink-0" />
                            Valid
                          </span>
                        )}
                      </TableCell>
                      <TableCell>{row.raw.name || "—"}</TableCell>
                      <TableCell>{row.raw.email || "—"}</TableCell>
                      <TableCell>{row.raw.role || "USER"}</TableCell>
                      <TableCell className="max-w-32 truncate">
                        {row.raw.imageUrl || row.raw["image_url"] || "—"}
                      </TableCell>
                      {defs.map((def) => (
                        <TableCell key={def.id}>{row.raw[def.key] || "—"}</TableCell>
                      ))}
                      <TableCell>{row.raw.isAlumni || row.raw["is_alumni"] || "false"}</TableCell>
                      <TableCell>
                        {row.raw.activationStartDate || row.raw["activation_start_date"] || "—"}
                      </TableCell>
                      <TableCell>
                        {row.raw.activationEndDate || row.raw["activation_end_date"] || "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <div className="flex items-center gap-3">
              <Switch checked={sendWelcomeEmails} onCheckedChange={setSendWelcomeEmails} />
              <Label>Send welcome emails</Label>
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Info className="size-4 cursor-help text-muted-foreground" />
                  </TooltipTrigger>
                  <TooltipContent className="max-w-64">
                    Sends a welcome message to each imported user. They will receive a password
                    setup link the first time they try to sign in.
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>
            <div className="flex justify-between gap-2">
              <Button variant="outline" onClick={() => setStage("select")} disabled={isPending}>
                Back
              </Button>
              <Button onClick={handleImport} disabled={validRows.length === 0 || isPending}>
                {isPending
                  ? "Importing..."
                  : `Import ${validRows.length} user${validRows.length === 1 ? "" : "s"}`}
              </Button>
            </div>
          </div>
        )}

        {stage === "done" && result && (
          <div className="flex flex-col gap-4">
            <div className="flex items-center gap-3 rounded-md bg-green-50 p-4 text-green-700 dark:bg-green-950 dark:text-green-400">
              <CheckCircle2 className="size-5 shrink-0" />
              <div>
                <p className="font-medium">
                  {result.created} user{result.created === 1 ? "" : "s"} created
                </p>
                {result.skipped > 0 && (
                  <p className="text-sm">{result.skipped} skipped — email already in use</p>
                )}
              </div>
            </div>
            <div className="flex justify-end">
              <Button onClick={resetAndClose}>Close</Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function buildUserCsvColumns(defs: MemberFieldDefinition[]): CsvColumn<AdminUser>[] {
  return [
    { header: "Name", value: (u) => u.name },
    { header: "Email", value: (u) => u.email },
    ...defs.map<CsvColumn<AdminUser>>((def) => ({
      header: def.label,
      value: (u) => String(u.customFields[def.key] ?? ""),
    })),
    { header: "Profile", value: (u) => (u.profileCompleted ? "Complete" : "Incomplete") },
    { header: "Role", value: (u) => ROLE_LABELS[u.role] },
    { header: "Alumni", value: (u) => (u.isAlumni ? "Yes" : "No") },
    { header: "Active", value: (u) => (u.isActive ? "Yes" : "No") },
    {
      header: "Membership Start",
      value: (u) => (u.activations[0] ? formatDate(u.activations[0].startDate) : ""),
    },
    {
      header: "Membership End",
      value: (u) => (u.activations[0] ? formatDate(u.activations[0].endDate) : ""),
    },
    { header: "Joined", value: (u) => formatDateTime(u.createdAt) },
  ];
}

export function UsersPage() {
  const { user } = useAuth();
  const isSuperAdmin = !!user && hasAccess(user.role, Role.SUPER_ADMIN);
  const queryClient = useQueryClient();
  const { enabled: pointsEnabled } = usePoints();
  const [pointsUser, setPointsUser] = useState<AdminUser | undefined>(undefined);

  // Activations popup
  const [activationHistoryUser, setActivationHistoryUser] = useState<AdminUser | null>(null);
  const [inlineEditId, setInlineEditId] = useState<string | "new" | null>(null);
  const [inlineForm, setInlineForm] = useState<{
    startDate: Date | undefined;
    endDate: Date | undefined;
  }>({ startDate: undefined, endDate: undefined });
  const [inlineError, setInlineError] = useState<string | null>(null);

  // Date filter
  const [activeOnDate, setActiveOnDate] = useState<Date | undefined>(undefined);

  // Import dialog
  const [showImportDialog, setShowImportDialog] = useState(false);

  // Delete user dialog
  const [deletingUser, setDeletingUser] = useState<AdminUser | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [updateError, setUpdateError] = useState<string | null>(null);

  const { data: users = [], isLoading } = useQuery({
    queryKey: queryKeys.admin.users(),
    queryFn: () => apiClient.get<AdminUser[]>(ApiRoutes.ADMIN_USERS),
  });

  const { data: fieldDefs } = useMemberFields();
  const defs = useMemo(() => fieldDefs ?? [], [fieldDefs]);

  const { mutate: updateUser } = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: UpdateUserPayload }) =>
      apiClient.patch<AdminUser>(`${ApiRoutes.ADMIN_USERS}/${id}`, payload),
    onSuccess: () => {
      setUpdateError(null);
      queryClient.invalidateQueries({ queryKey: queryKeys.admin.users() });
    },
    onError: (err: unknown) => {
      setUpdateError(err instanceof Error ? err.message : "Failed to update user");
      queryClient.invalidateQueries({ queryKey: queryKeys.admin.users() });
    },
  });

  const { mutate: deleteUser, isPending: isDeleting } = useMutation({
    mutationFn: (id: string) => apiClient.delete(ApiRoutes.ADMIN_USER_BY_ID.replace(":id", id)),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.admin.users() });
      setDeletingUser(null);
      setDeleteError(null);
    },
    onError: (err: unknown) => {
      setDeleteError(err instanceof Error ? err.message : "Failed to delete user");
    },
  });

  function refreshActivationHistoryUser(userId: string) {
    queryClient.invalidateQueries({ queryKey: queryKeys.admin.users() }).then(() => {
      setActivationHistoryUser((prev) => {
        if (!prev || prev.id !== userId) return prev;
        const fresh = queryClient.getQueryData<AdminUser[]>(queryKeys.admin.users());
        return fresh?.find((u) => u.id === userId) ?? prev;
      });
    });
  }

  const { mutate: createActivation, isPending: isCreating } = useMutation({
    mutationFn: ({ userId, payload }: { userId: string; payload: CreateActivationPayload }) =>
      apiClient.post<UserActivation>(
        ApiRoutes.ADMIN_USER_ACTIVATIONS.replace(":id", userId),
        payload
      ),
    onSuccess: (_data, { userId }) => {
      setInlineEditId(null);
      setInlineError(null);
      refreshActivationHistoryUser(userId);
    },
    onError: (err: unknown) => {
      const msg = err instanceof Error ? err.message : "Failed to save activation period";
      setInlineError(msg);
    },
  });

  const { mutate: updateActivation, isPending: isUpdating } = useMutation({
    mutationFn: ({
      activationId,
      payload,
    }: {
      activationId: string;
      userId: string;
      payload: UpdateActivationPayload;
    }) =>
      apiClient.patch<UserActivation>(
        ApiRoutes.ADMIN_ACTIVATION_BY_ID.replace(":id", activationId),
        payload
      ),
    onSuccess: (_data, { userId }) => {
      setInlineEditId(null);
      setInlineError(null);
      refreshActivationHistoryUser(userId);
    },
    onError: (err: unknown) => {
      const msg = err instanceof Error ? err.message : "Failed to save activation period";
      setInlineError(msg);
    },
  });

  const { mutate: deleteActivation } = useMutation({
    mutationFn: ({ activationId }: { activationId: string; userId: string }) =>
      apiClient.delete(ApiRoutes.ADMIN_ACTIVATION_BY_ID.replace(":id", activationId)),
    onSuccess: (_data, { userId }) => {
      refreshActivationHistoryUser(userId);
    },
    onError: (err: unknown) => {
      const msg = err instanceof Error ? err.message : "Failed to delete activation period";
      setInlineError(msg);
    },
  });

  function handleOpenActivations(targetUser: AdminUser) {
    setActivationHistoryUser(targetUser);
    setInlineEditId(null);
    setInlineError(null);
  }

  function handleStartInlineEdit(activation: UserActivation | "new") {
    setInlineError(null);
    if (activation === "new") {
      setInlineForm({ startDate: undefined, endDate: undefined });
    } else {
      setInlineForm({
        startDate: new Date(activation.startDate),
        endDate: new Date(activation.endDate),
      });
    }
    setInlineEditId(activation === "new" ? "new" : activation.id);
  }

  function handleStartDateChange(date: Date | undefined) {
    setInlineError(null);
    setInlineForm((prev) => {
      // Auto-set end date to 1 year after start only when creating and end date not yet chosen
      const shouldAutoEnd = inlineEditId === "new" && !prev.endDate && date;
      if (shouldAutoEnd) {
        const autoEnd = new Date(date);
        autoEnd.setFullYear(autoEnd.getFullYear() + 1);
        return { startDate: date, endDate: autoEnd };
      }
      return { ...prev, startDate: date };
    });
  }

  function checkClientOverlap(startDate: string, endDate: string, excludeId?: string): boolean {
    if (!activationHistoryUser) return false;
    return activationHistoryUser.activations.some(
      (a) => a.id !== excludeId && a.startDate <= endDate && a.endDate >= startDate
    );
  }

  function handleSaveInline() {
    if (!activationHistoryUser || !inlineForm.startDate || !inlineForm.endDate) return;
    const startDate = toDateStr(inlineForm.startDate);
    const endDate = toDateStr(inlineForm.endDate);

    const excludeId = inlineEditId !== "new" ? (inlineEditId ?? undefined) : undefined;
    if (checkClientOverlap(startDate, endDate, excludeId)) {
      setInlineError("Activation period overlaps an existing one.");
      return;
    }

    setInlineError(null);
    if (inlineEditId === "new") {
      createActivation({ userId: activationHistoryUser.id, payload: { startDate, endDate } });
    } else if (inlineEditId) {
      updateActivation({
        activationId: inlineEditId,
        userId: activationHistoryUser.id,
        payload: { startDate, endDate },
      });
    }
  }

  function handleOpenDelete(targetUser: AdminUser) {
    setDeleteError(null);
    setDeletingUser(targetUser);
  }

  const columns = useColumns(
    defs,
    updateUser,
    handleOpenActivations,
    handleOpenDelete,
    setPointsUser,
    pointsEnabled,
    isSuperAdmin,
    user?.id
  );

  const table = useReactTable({
    data: users,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    globalFilterFn: "includesString",
    initialState: {
      pagination: { pageSize: 10 },
      columnVisibility: { activeOnFilter: false },
    },
  });

  function handleExport() {
    const filtered = table.getFilteredRowModel().rows.map((r) => r.original);
    exportToCsv(
      filtered,
      buildUserCsvColumns(defs),
      `users-${new Date().toISOString().slice(0, 10)}.csv`
    );
  }

  function handleActiveOnChange(date: Date | undefined) {
    setActiveOnDate(date);
    table.getColumn("activeOnFilter")?.setFilterValue(date ? toDateStr(date) : undefined);
    table.setPageIndex(0);
  }

  if (isLoading) {
    return <div className="text-sm text-muted-foreground">Loading users...</div>;
  }

  const isSaving = isCreating || isUpdating;

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div className="flex flex-col gap-6">
        <AdminPageHeader
          eyebrow="Members"
          title="Users"
          description={`${table.getFilteredRowModel().rows.length} of ${users.length} users`}
          actions={
            <>
              {isSuperAdmin && (
                <Button variant="outline" size="sm" onClick={() => setShowImportDialog(true)}>
                  <Upload className="size-4" />
                  Import CSV
                </Button>
              )}
              <Button variant="outline" size="sm" onClick={handleExport}>
                <FileDown className="size-4" />
                Export CSV
              </Button>
            </>
          }
        />
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
          <Select
            value={
              table.getColumn("isAlumni")?.getFilterValue() === undefined
                ? "all"
                : table.getColumn("isAlumni")?.getFilterValue()
                  ? "alumni"
                  : "non-alumni"
            }
            onValueChange={(value) => {
              const filterValue = value === "all" ? undefined : value === "alumni" ? true : false;
              table.getColumn("isAlumni")?.setFilterValue(filterValue);
              table.setPageIndex(0);
            }}
          >
            <SelectTrigger className="w-full sm:w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All members</SelectItem>
              <SelectItem value="alumni">Alumni only</SelectItem>
              <SelectItem value="non-alumni">Non-alumni only</SelectItem>
            </SelectContent>
          </Select>
          <Select
            value={
              table.getColumn("isActive")?.getFilterValue() === undefined
                ? "all"
                : table.getColumn("isActive")?.getFilterValue()
                  ? "active"
                  : "inactive"
            }
            onValueChange={(value) => {
              const filterValue = value === "all" ? undefined : value === "active" ? true : false;
              table.getColumn("isActive")?.setFilterValue(filterValue);
              table.setPageIndex(0);
            }}
          >
            <SelectTrigger className="w-full sm:w-36">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All members</SelectItem>
              <SelectItem value="active">Active only</SelectItem>
              <SelectItem value="inactive">Inactive only</SelectItem>
            </SelectContent>
          </Select>
          <div className="flex min-w-0 items-center gap-1">
            <DatePicker
              value={activeOnDate}
              onChange={handleActiveOnChange}
              placeholder="Active on..."
              className="flex-1"
            />
            {activeOnDate && (
              <Button
                variant="ghost"
                size="icon"
                className="size-9 shrink-0"
                onClick={() => handleActiveOnChange(undefined)}
              >
                <X className="size-4" />
              </Button>
            )}
          </div>
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
            <Input
              placeholder="Search by name or email..."
              value={(table.getState().globalFilter as string) ?? ""}
              onChange={(e) => {
                table.setGlobalFilter(e.target.value);
                table.setPageIndex(0);
              }}
              className="w-full pl-8 sm:w-64"
            />
          </div>
        </div>
      </div>

      {updateError && <p className="text-sm text-destructive">{updateError}</p>}

      <div className="overflow-x-auto rounded-md border">
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <TableHead key={header.id}>
                    {flexRender(header.column.columnDef.header, header.getContext())}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows.length === 0 ? (
              <DataTableEmptyRow colSpan={columns.length} message="No users found." />
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

      <DataTablePagination table={table} />

      {/* Activations dialog */}
      <Dialog
        open={!!activationHistoryUser}
        onOpenChange={(open) => {
          if (!open) {
            setActivationHistoryUser(null);
            setInlineEditId(null);
            setInlineError(null);
          }
        }}
      >
        <DialogContent className="flex max-h-[90vh] flex-col sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Activations — {activationHistoryUser?.name}</DialogTitle>
          </DialogHeader>

          <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto py-2">
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Start</TableHead>
                    <TableHead>End</TableHead>
                    {isSuperAdmin && <TableHead className="w-20" />}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {activationHistoryUser?.activations.length === 0 && inlineEditId !== "new" ? (
                    <TableRow>
                      <TableCell
                        colSpan={isSuperAdmin ? 3 : 2}
                        className="text-center text-sm text-muted-foreground"
                      >
                        No activation periods yet.
                      </TableCell>
                    </TableRow>
                  ) : (
                    activationHistoryUser?.activations.map((activation) => {
                      const today = todayStr();
                      const isCurrent =
                        activation.startDate <= today && activation.endDate >= today;
                      const isEditing = inlineEditId === activation.id;

                      if (isEditing) {
                        return (
                          <TableRow key={activation.id}>
                            <TableCell colSpan={isSuperAdmin ? 3 : 2} className="py-2">
                              <InlineEditForm
                                form={inlineForm}
                                onStartChange={handleStartDateChange}
                                onEndChange={(date) => {
                                  setInlineError(null);
                                  setInlineForm((prev) => ({ ...prev, endDate: date }));
                                }}
                                onSave={handleSaveInline}
                                onCancel={() => {
                                  setInlineEditId(null);
                                  setInlineError(null);
                                }}
                                error={inlineError}
                                isSaving={isSaving}
                              />
                            </TableCell>
                          </TableRow>
                        );
                      }

                      return (
                        <TableRow key={activation.id}>
                          <TableCell>
                            <div className="flex items-center gap-1.5">
                              <span className="text-sm">{formatDate(activation.startDate)}</span>
                              {isCurrent && (
                                <Badge className="h-4 rounded-sm bg-green-500 px-1 text-[10px] text-white hover:bg-green-500">
                                  Active
                                </Badge>
                              )}
                            </div>
                          </TableCell>
                          <TableCell className="text-sm">
                            {formatDate(activation.endDate)}
                          </TableCell>
                          {isSuperAdmin && (
                            <TableCell>
                              <div className="flex items-center gap-1">
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="size-7"
                                  onClick={() => handleStartInlineEdit(activation)}
                                >
                                  <Pencil className="size-3.5" />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="size-7 text-destructive hover:text-destructive"
                                  onClick={() =>
                                    deleteActivation({
                                      activationId: activation.id,
                                      userId: activationHistoryUser.id,
                                    })
                                  }
                                >
                                  <Trash2 className="size-3.5" />
                                </Button>
                              </div>
                            </TableCell>
                          )}
                        </TableRow>
                      );
                    })
                  )}

                  {/* Inline new row */}
                  {inlineEditId === "new" && (
                    <TableRow>
                      <TableCell colSpan={isSuperAdmin ? 3 : 2} className="py-2">
                        <InlineEditForm
                          form={inlineForm}
                          onStartChange={handleStartDateChange}
                          onEndChange={(date) => {
                            setInlineError(null);
                            setInlineForm((prev) => ({ ...prev, endDate: date }));
                          }}
                          onSave={handleSaveInline}
                          onCancel={() => {
                            setInlineEditId(null);
                            setInlineError(null);
                          }}
                          error={inlineError}
                          isSaving={isSaving}
                        />
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>

            {isSuperAdmin && inlineEditId === null && (
              <div className="flex justify-end">
                <Button variant="outline" size="sm" onClick={() => handleStartInlineEdit("new")}>
                  + Add period
                </Button>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <ImportUsersDialog
        open={showImportDialog}
        defs={defs}
        onClose={() => setShowImportDialog(false)}
        onSuccess={() => queryClient.invalidateQueries({ queryKey: queryKeys.admin.users() })}
      />

      <AlertDialog
        open={!!deletingUser}
        onOpenChange={(open) => {
          if (!open) {
            setDeletingUser(null);
            setDeleteError(null);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete user</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes {deletingUser?.name} ({deletingUser?.email}) along with their
              project and workshop registrations, certificates, membership and points history. This
              cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {deleteError && <p className="text-sm text-destructive">{deleteError}</p>}
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={isDeleting}
              onClick={(e) => {
                e.preventDefault();
                if (deletingUser) deleteUser(deletingUser.id);
              }}
            >
              {isDeleting ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <UserPointsDialog
        user={pointsUser}
        canAdjust={isSuperAdmin}
        onOpenChange={(open) => !open && setPointsUser(undefined)}
      />
    </div>
  );
}
