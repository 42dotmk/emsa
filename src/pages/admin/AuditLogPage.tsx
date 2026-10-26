import { keepPreviousData, useQuery } from "@tanstack/react-query";
import {
  type ColumnDef,
  flexRender,
  getCoreRowModel,
  type PaginationState,
  useReactTable,
} from "@tanstack/react-table";
import { Search, X } from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";

import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { AuditLogDetailDialog } from "@/components/admin/AuditLogDetailDialog";
import { DataTableEmptyRow } from "@/components/admin/DataTableEmptyRow";
import { DataTablePagination } from "@/components/admin/DataTablePagination";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { UserAvatar } from "@/components/UserAvatar";
import { AuditAction, AuditEntityType } from "@/constants/enums";
import { queryKeys } from "@/constants/query-keys";
import { ApiRoutes, PageRoutes } from "@/constants/routes";
import type { AuditLogQuery } from "@/constants/schemas";
import type {
  AuditActor,
  AuditLogEntry,
  AuditLogPage as AuditLogPageData,
} from "@/constants/types";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { usePillarLabels } from "@/hooks/usePillarLabels";
import { apiClient } from "@/lib/api-client";
import { cn, formatDateTime, humanizeFieldName } from "@/lib/utils";

const ALL = "all";
const MAX_SUMMARY_FIELDS = 3;

const ACTION_LABELS: Record<AuditAction, string> = {
  [AuditAction.CREATE]: "Created",
  [AuditAction.UPDATE]: "Updated",
  [AuditAction.DELETE]: "Deleted",
  [AuditAction.IMPORT]: "Imported",
  [AuditAction.REORDER]: "Reordered",
  [AuditAction.SEND_EMAIL]: "Emailed",
};

const ACTION_BADGE_VARIANTS: Record<AuditAction, "secondary" | "destructive" | "outline"> = {
  [AuditAction.CREATE]: "secondary",
  [AuditAction.UPDATE]: "outline",
  [AuditAction.DELETE]: "destructive",
  [AuditAction.IMPORT]: "outline",
  [AuditAction.REORDER]: "outline",
  [AuditAction.SEND_EMAIL]: "outline",
};

function useEntityTypeLabels(): Record<AuditEntityType, string> {
  const { singular } = usePillarLabels();
  return {
    [AuditEntityType.PROJECT]: "Project",
    [AuditEntityType.PILLAR]: singular,
    [AuditEntityType.USER]: "User",
    [AuditEntityType.ORGANIZATION]: "Organization",
    [AuditEntityType.POSITION]: "Board position",
    [AuditEntityType.SUPPORTER]: "Supporter",
    [AuditEntityType.MEMBER_FIELD]: "Member field",
    [AuditEntityType.ACTIVATION]: "Membership",
    [AuditEntityType.WORKSHOP]: "Workshop",
    [AuditEntityType.PACKAGE]: "Package",
    [AuditEntityType.CAPACITY_POOL]: "Capacity pool",
    [AuditEntityType.REGISTRATION]: "Registration",
    [AuditEntityType.CERTIFICATE]: "Certificate",
  };
}

function entityLink(entry: AuditLogEntry): string | null {
  const projectId = entry.metadata?.projectId;
  if (typeof projectId === "string") {
    return PageRoutes.ADMIN_PROJECT_DETAIL.replace(":id", projectId);
  }
  if (entry.action === AuditAction.DELETE) return null;
  switch (entry.entityType) {
    case AuditEntityType.PROJECT:
      return entry.entityId ? PageRoutes.ADMIN_PROJECT_DETAIL.replace(":id", entry.entityId) : null;
    case AuditEntityType.PILLAR:
      return PageRoutes.ADMIN_PILLARS;
    case AuditEntityType.USER:
    case AuditEntityType.ACTIVATION:
      return PageRoutes.ADMIN_USERS;
    case AuditEntityType.ORGANIZATION:
    case AuditEntityType.POSITION:
    case AuditEntityType.SUPPORTER:
    case AuditEntityType.MEMBER_FIELD:
      return PageRoutes.ADMIN_ORGANIZATION;
    default:
      return null;
  }
}

function summarize(entry: AuditLogEntry): string {
  const count = entry.metadata?.count ?? entry.metadata?.created;
  switch (entry.action) {
    case AuditAction.UPDATE: {
      const fields = Object.keys(entry.changes ?? {}).map((f) =>
        humanizeFieldName(f).toLowerCase()
      );
      const images = entry.metadata?.imagesAdded || entry.metadata?.imagesRemoved ? ["images"] : [];
      const all = [...fields, ...images];
      if (all.length === 0) return "Updated";
      const shown = all.slice(0, MAX_SUMMARY_FIELDS).join(", ");
      const extra = all.length - MAX_SUMMARY_FIELDS;
      return `Changed ${shown}${extra > 0 ? ` +${extra} more` : ""}`;
    }
    case AuditAction.IMPORT: {
      const skipped = Number(entry.metadata?.skipped ?? 0);
      return `Imported ${count ?? 0} users${skipped > 0 ? `, ${skipped} skipped` : ""}`;
    }
    case AuditAction.REORDER:
      return `Reordered ${count ?? ""} items`;
    case AuditAction.SEND_EMAIL:
      return `Sent welcome email to ${count ?? 0} users`;
    case AuditAction.CREATE:
      return "Created";
    case AuditAction.DELETE:
      return "Deleted";
  }
}

function useColumns(entityTypeLabels: Record<AuditEntityType, string>): ColumnDef<AuditLogEntry>[] {
  return [
    {
      accessorKey: "createdAt",
      header: "When",
      cell: ({ row }) => (
        <span className="text-sm whitespace-nowrap text-muted-foreground">
          {formatDateTime(row.original.createdAt)}
        </span>
      ),
    },
    {
      accessorKey: "actorName",
      header: "Who",
      cell: ({ row }) => (
        <div className="flex min-w-0 items-center gap-2">
          <UserAvatar
            name={row.original.actorName}
            imageUrl={row.original.actorImageUrl}
            className="size-7"
          />
          <span className="truncate text-sm font-medium">{row.original.actorName}</span>
        </div>
      ),
    },
    {
      accessorKey: "action",
      header: "Action",
      cell: ({ row }) => (
        <Badge variant={ACTION_BADGE_VARIANTS[row.original.action]}>
          {ACTION_LABELS[row.original.action]}
        </Badge>
      ),
    },
    {
      accessorKey: "entityLabel",
      header: "Entity",
      cell: ({ row }) => {
        const entry = row.original;
        const link = entityLink(entry);
        const context = entry.metadata?.workshopTitle ?? entry.metadata?.projectTitle;
        return (
          <div className="flex min-w-0 flex-col">
            <span className="text-xs text-muted-foreground">
              {entityTypeLabels[entry.entityType]}
              {context ? ` · ${context}` : ""}
            </span>
            {link ? (
              <Link
                to={link}
                onClick={(e) => e.stopPropagation()}
                className="truncate text-sm font-medium hover:underline"
              >
                {entry.entityLabel}
              </Link>
            ) : (
              <span className="truncate text-sm font-medium">{entry.entityLabel}</span>
            )}
          </div>
        );
      },
    },
    {
      id: "summary",
      header: "Details",
      cell: ({ row }) => (
        <span className="line-clamp-2 max-w-xs text-sm text-muted-foreground">
          {summarize(row.original)}
        </span>
      ),
    },
  ];
}

function startOfDay(date: Date): string {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

function endOfDay(date: Date): string {
  const d = new Date(date);
  d.setHours(23, 59, 59, 999);
  return d.toISOString();
}

export function AuditLogPage() {
  const entityTypeLabels = useEntityTypeLabels();
  const [search, setSearch] = useState("");
  const [entityType, setEntityType] = useState<AuditEntityType | typeof ALL>(ALL);
  const [action, setAction] = useState<AuditAction | typeof ALL>(ALL);
  const [actorId, setActorId] = useState<string>(ALL);
  const [from, setFrom] = useState<Date | undefined>(undefined);
  const [to, setTo] = useState<Date | undefined>(undefined);
  const [pagination, setPagination] = useState<PaginationState>({ pageIndex: 0, pageSize: 20 });
  const [selected, setSelected] = useState<AuditLogEntry | undefined>(undefined);
  const debouncedSearch = useDebouncedValue(search.trim());

  const query = useMemo<AuditLogQuery>(
    () => ({
      page: pagination.pageIndex + 1,
      pageSize: pagination.pageSize,
      ...(entityType !== ALL && { entityType }),
      ...(action !== ALL && { action }),
      ...(actorId !== ALL && { actorId }),
      ...(from && { from: startOfDay(from) }),
      ...(to && { to: endOfDay(to) }),
      ...(debouncedSearch && { q: debouncedSearch }),
    }),
    [pagination, entityType, action, actorId, from, to, debouncedSearch]
  );

  const { data, isLoading, isFetching } = useQuery({
    queryKey: queryKeys.admin.auditLogs(query),
    queryFn: () => {
      const params = new URLSearchParams(
        Object.entries(query).map(([key, value]) => [key, String(value)])
      );
      return apiClient.get<AuditLogPageData>(`${ApiRoutes.ADMIN_AUDIT_LOGS}?${params}`);
    },
    placeholderData: keepPreviousData,
    staleTime: 0,
  });

  const { data: actors = [] } = useQuery({
    queryKey: queryKeys.admin.auditLogActors(),
    queryFn: () => apiClient.get<AuditActor[]>(ApiRoutes.ADMIN_AUDIT_LOG_ACTORS),
  });

  const items = data?.items ?? [];
  const total = data?.total ?? 0;
  const columns = useColumns(entityTypeLabels);

  const table = useReactTable({
    data: items,
    columns,
    getCoreRowModel: getCoreRowModel(),
    manualPagination: true,
    rowCount: total,
    state: { pagination },
    onPaginationChange: setPagination,
  });

  const hasFilters =
    search !== "" ||
    entityType !== ALL ||
    action !== ALL ||
    actorId !== ALL ||
    from !== undefined ||
    to !== undefined;

  function resetPage() {
    setPagination((p) => ({ ...p, pageIndex: 0 }));
  }

  function clearFilters() {
    setSearch("");
    setEntityType(ALL);
    setAction(ALL);
    setActorId(ALL);
    setFrom(undefined);
    setTo(undefined);
    resetPage();
  }

  if (isLoading) {
    return <div className="text-sm text-muted-foreground">Loading audit log...</div>;
  }

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <AdminPageHeader
        eyebrow="Governance"
        title="Audit log"
        description={`${total} ${total === 1 ? "event" : "events"} recorded`}
      />

      <div className="flex flex-col gap-2 lg:flex-row lg:flex-wrap lg:items-center">
        <div className="relative">
          <Search className="absolute top-2.5 left-2.5 size-4 text-muted-foreground" />
          <Input
            placeholder="Search name or person..."
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              resetPage();
            }}
            className="w-full pl-8 lg:w-64"
          />
        </div>
        <Select
          value={entityType}
          onValueChange={(value) => {
            setEntityType(value as AuditEntityType | typeof ALL);
            resetPage();
          }}
        >
          <SelectTrigger className="w-full lg:w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All types</SelectItem>
            {Object.values(AuditEntityType).map((type) => (
              <SelectItem key={type} value={type}>
                {entityTypeLabels[type]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={action}
          onValueChange={(value) => {
            setAction(value as AuditAction | typeof ALL);
            resetPage();
          }}
        >
          <SelectTrigger className="w-full lg:w-36">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All actions</SelectItem>
            {Object.values(AuditAction).map((value) => (
              <SelectItem key={value} value={value}>
                {ACTION_LABELS[value]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={actorId}
          onValueChange={(value) => {
            setActorId(value);
            resetPage();
          }}
        >
          <SelectTrigger className="w-full lg:w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Everyone</SelectItem>
            {actors.map((actor) => (
              <SelectItem key={actor.id} value={actor.id}>
                {actor.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="grid grid-cols-2 gap-2 lg:flex">
          <DatePicker
            value={from}
            onChange={(date) => {
              setFrom(date);
              resetPage();
            }}
            disabled={(date) => (to ? date > to : false)}
            placeholder="From"
            className="lg:w-40"
          />
          <DatePicker
            value={to}
            onChange={(date) => {
              setTo(date);
              resetPage();
            }}
            disabled={(date) => (from ? date < from : false)}
            placeholder="To"
            className="lg:w-40"
          />
        </div>
        {hasFilters && (
          <Button variant="ghost" onClick={clearFilters}>
            <X className="size-4" />
            Clear
          </Button>
        )}
      </div>

      <div
        className={cn(
          "overflow-x-auto rounded-md border transition-opacity",
          isFetching && "opacity-60"
        )}
      >
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
              <DataTableEmptyRow
                colSpan={columns.length}
                message={hasFilters ? "No events match these filters." : "No events recorded yet."}
              />
            ) : (
              table.getRowModel().rows.map((row) => (
                <TableRow
                  key={row.id}
                  onClick={() => setSelected(row.original)}
                  className="cursor-pointer"
                >
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

      <AuditLogDetailDialog
        entry={selected}
        entityTypeLabel={selected ? entityTypeLabels[selected.entityType] : ""}
        actionLabel={selected ? ACTION_LABELS[selected.action] : ""}
        onOpenChange={(open) => !open && setSelected(undefined)}
      />
    </div>
  );
}
