import { type ClassValue, clsx } from "clsx";
import { type NavigateFunction } from "react-router-dom";
import { twMerge } from "tailwind-merge";

import { PointReason, Role } from "@/constants/enums";
import { PageRoutes } from "@/constants/routes";
import {
  type AuditValue,
  type CsvColumn,
  type ImageEntry,
  type PublicProject,
  type RegistrationStatus,
} from "@/constants/types";
import { apiClient } from "@/lib/api-client";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const ROLE_HIERARCHY: Record<Role, number> = {
  [Role.USER]: 0,
  [Role.ADMIN]: 1,
  [Role.SUPER_ADMIN]: 2,
};

export function hasAccess(userRole: Role, requiredRole: Role): boolean {
  return ROLE_HIERARCHY[userRole] >= ROLE_HIERARCHY[requiredRole];
}

export function navigateAfterLogin(
  user: { role: Role } | null | undefined,
  navigate: NavigateFunction
) {
  navigate(user && hasAccess(user.role, Role.ADMIN) ? PageRoutes.ADMIN : PageRoutes.HOME);
}

export function getInitials(name: string): string {
  return name
    .split(" ")
    .filter(Boolean)
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

export function getImageSrc(img: ImageEntry): string | null {
  if (img.type === "existing") return img.url;
  if (img.type === "new") return img.previewUrl;
  return null;
}

export function getImageId(img: Exclude<ImageEntry, { type: "none" }>): string {
  return img.type === "existing" ? img.url : img.previewUrl;
}

export function toDatetimeLocalValue(isoString: string): string {
  const d = new Date(isoString);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function presignedUpload(file: File, uploadRoute: string): Promise<string> {
  const { uploadUrl, fileUrl } = await apiClient.get<{ uploadUrl: string; fileUrl: string }>(
    `${uploadRoute}?contentType=${encodeURIComponent(file.type)}`
  );
  const res = await fetch(uploadUrl, {
    method: "PUT",
    body: file,
    headers: { "Content-Type": file.type },
  });
  if (!res.ok) throw new Error(`Upload failed: ${res.status}`);
  return fileUrl;
}

export async function uploadImageToS3(file: File, uploadRoute: string): Promise<string> {
  return presignedUpload(file, uploadRoute);
}

export async function uploadFileToR2(file: File, uploadRoute: string): Promise<string> {
  return presignedUpload(file, uploadRoute);
}

export async function resolveImageEntry(
  entry: ImageEntry,
  uploadRoute: string
): Promise<string | null> {
  if (entry.type === "new") return uploadImageToS3(entry.file, uploadRoute);
  if (entry.type === "existing") return entry.url;
  return null;
}

export function getRegistrationStatus(project: PublicProject): RegistrationStatus {
  if (!project.registrationOpensAt) return "none";
  const now = new Date();
  if (new Date(project.registrationOpensAt) > now) return "not_open";
  if (project.registrationClosesAt && new Date(project.registrationClosesAt) < now) return "closed";
  return project.canRegister ? "open" : "full";
}

export function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString("en-GB");
}

export function formatDateTime(dateStr: string): string {
  return new Date(dateStr).toLocaleString("en-GB", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

export function toDateStr(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function escapeHtml(str: string) {
  return str
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export async function cropImage(
  src: string,
  pixelCrop: { x: number; y: number; width: number; height: number },
  mimeType: string
): Promise<File> {
  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
  const canvas = document.createElement("canvas");
  canvas.width = pixelCrop.width;
  canvas.height = pixelCrop.height;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(
    image,
    pixelCrop.x,
    pixelCrop.y,
    pixelCrop.width,
    pixelCrop.height,
    0,
    0,
    pixelCrop.width,
    pixelCrop.height
  );
  return new Promise<File>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error("Canvas is empty"));
        return;
      }
      resolve(new File([blob], "cropped", { type: mimeType }));
    }, mimeType);
  });
}

export function getPageNumbers(totalPages: number, currentPage: number): (number | "ellipsis")[] {
  if (totalPages <= 7) return Array.from({ length: totalPages }, (_, i) => i + 1);
  if (currentPage <= 4) return [1, 2, 3, 4, 5, "ellipsis", totalPages];
  if (currentPage >= totalPages - 3)
    return [
      1,
      "ellipsis",
      totalPages - 4,
      totalPages - 3,
      totalPages - 2,
      totalPages - 1,
      totalPages,
    ];
  return [1, "ellipsis", currentPage - 1, currentPage, currentPage + 1, "ellipsis", totalPages];
}

export function exportToCsv<T>(rows: T[], columns: CsvColumn<T>[], filename: string): void {
  const header = columns.map((c) => c.header).join(",");
  const body = rows
    .map((row) =>
      columns
        .map((c) => {
          const cell = c.value(row);
          return /[",\n\r]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell;
        })
        .join(",")
    )
    .join("\n");
  const blob = new Blob([`${header}\n${body}`], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function humanizeFieldName(path: string): string {
  const field = path.split(".").pop() ?? path;
  const words = field
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export function formatAuditValue(value: AuditValue): string {
  if (value === null || value === "") return "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}T/.test(value)) return formatDateTime(value);
  return String(value);
}

const POINT_REASON_LABELS: Record<PointReason, string> = {
  [PointReason.PROJECT_ATTENDANCE]: "Project attendance",
  [PointReason.PROJECT_ATTENDANCE_REVOKED]: "Attendance removed",
  [PointReason.MEMBERSHIP_ACTIVE]: "Active membership",
  [PointReason.MEMBERSHIP_ADJUSTED]: "Membership points changed",
  [PointReason.MEMBERSHIP_ENDED]: "Membership ended",
  [PointReason.MANUAL]: "Manual adjustment",
};

export function pointReasonLabel(reason: string): string {
  return POINT_REASON_LABELS[reason as PointReason] ?? reason;
}

export function getDocumentOffsetTop(element: HTMLElement): number {
  let top = 0;
  for (
    let node: HTMLElement | null = element;
    node;
    node = node.offsetParent as HTMLElement | null
  ) {
    top += node.offsetTop;
  }
  return top;
}
