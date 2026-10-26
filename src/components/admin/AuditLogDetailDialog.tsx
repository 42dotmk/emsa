import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { UserAvatar } from "@/components/UserAvatar";
import { AuditAction } from "@/constants/enums";
import type { AuditLogEntry, AuditMetadata } from "@/constants/types";
import { formatAuditValue, formatDateTime, humanizeFieldName } from "@/lib/utils";

const HIDDEN_METADATA_KEYS = new Set(["projectId", "workshopId", "userId", "emails"]);

interface AuditLogDetailDialogProps {
  entry: AuditLogEntry | undefined;
  entityTypeLabel: string;
  actionLabel: string;
  onOpenChange: (open: boolean) => void;
}

function metadataRows(metadata: AuditMetadata | null) {
  if (!metadata) return [];
  return Object.entries(metadata).filter(
    (entry): entry is [string, Exclude<AuditMetadata[string], string[]>] =>
      !HIDDEN_METADATA_KEYS.has(entry[0]) && !Array.isArray(entry[1])
  );
}

export function AuditLogDetailDialog({
  entry,
  entityTypeLabel,
  actionLabel,
  onOpenChange,
}: AuditLogDetailDialogProps) {
  const changes = entry?.changes ? Object.entries(entry.changes) : [];
  const details = metadataRows(entry?.metadata ?? null);
  const emails = entry?.metadata?.emails;
  const showBefore = entry?.action !== AuditAction.CREATE;
  const showAfter = entry?.action !== AuditAction.DELETE;

  return (
    <Dialog open={!!entry} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        {entry && (
          <>
            <DialogHeader>
              <DialogTitle>
                {actionLabel} · {entityTypeLabel}
              </DialogTitle>
              <DialogDescription>{entry.entityLabel}</DialogDescription>
            </DialogHeader>

            <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
              <dt className="text-muted-foreground">When</dt>
              <dd>{formatDateTime(entry.createdAt)}</dd>
              <dt className="text-muted-foreground">By</dt>
              <dd className="flex min-w-0 items-center gap-2">
                <UserAvatar
                  name={entry.actorName}
                  imageUrl={entry.actorImageUrl}
                  className="size-6"
                />
                <span className="truncate">
                  {entry.actorName}{" "}
                  <span className="text-muted-foreground">({entry.actorEmail})</span>
                </span>
              </dd>
              {details.map(([key, value]) => (
                <div key={key} className="contents">
                  <dt className="text-muted-foreground">{humanizeFieldName(key)}</dt>
                  <dd className="break-words">{formatAuditValue(value)}</dd>
                </div>
              ))}
            </dl>

            {changes.length > 0 && (
              <div className="overflow-x-auto rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Field</TableHead>
                      {showBefore && <TableHead>Before</TableHead>}
                      {showAfter && <TableHead>After</TableHead>}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {changes.map(([field, { from, to }]) => (
                      <TableRow key={field}>
                        <TableCell className="align-top font-medium">
                          {humanizeFieldName(field)}
                        </TableCell>
                        {showBefore && (
                          <TableCell className="max-w-56 align-top whitespace-normal break-words text-muted-foreground">
                            {formatAuditValue(from)}
                          </TableCell>
                        )}
                        {showAfter && (
                          <TableCell className="max-w-56 align-top whitespace-normal break-words">
                            {formatAuditValue(to)}
                          </TableCell>
                        )}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}

            {Array.isArray(emails) && emails.length > 0 && (
              <div className="flex flex-col gap-2">
                <p className="text-sm font-medium">
                  {`${entry.action === AuditAction.IMPORT ? "Imported users" : "Recipients"} (${emails.length})`}
                </p>
                <ul className="max-h-48 overflow-y-auto rounded-md border p-3 text-sm text-muted-foreground">
                  {emails.map((email) => (
                    <li key={email} className="truncate">
                      {email}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
