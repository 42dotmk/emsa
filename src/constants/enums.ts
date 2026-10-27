export const Role = {
  USER: "USER",
  ADMIN: "ADMIN",
  SUPER_ADMIN: "SUPER_ADMIN",
} as const;
export type Role = (typeof Role)[keyof typeof Role];

export const MemberFieldType = {
  TEXT: "TEXT",
  NUMBER: "NUMBER",
} as const;
export type MemberFieldType = (typeof MemberFieldType)[keyof typeof MemberFieldType];

export const AuditAction = {
  CREATE: "CREATE",
  UPDATE: "UPDATE",
  DELETE: "DELETE",
  IMPORT: "IMPORT",
  REORDER: "REORDER",
  SEND_EMAIL: "SEND_EMAIL",
} as const;
export type AuditAction = (typeof AuditAction)[keyof typeof AuditAction];

export const AuditEntityType = {
  PROJECT: "PROJECT",
  PILLAR: "PILLAR",
  USER: "USER",
  ORGANIZATION: "ORGANIZATION",
  POSITION: "POSITION",
  SUPPORTER: "SUPPORTER",
  MEMBER_FIELD: "MEMBER_FIELD",
  ACTIVATION: "ACTIVATION",
  WORKSHOP: "WORKSHOP",
  PACKAGE: "PACKAGE",
  CAPACITY_POOL: "CAPACITY_POOL",
  REGISTRATION: "REGISTRATION",
  CERTIFICATE: "CERTIFICATE",
  POINTS: "POINTS",
} as const;
export type AuditEntityType = (typeof AuditEntityType)[keyof typeof AuditEntityType];

export const PointReason = {
  PROJECT_ATTENDANCE: "PROJECT_ATTENDANCE",
  PROJECT_ATTENDANCE_REVOKED: "PROJECT_ATTENDANCE_REVOKED",
  MEMBERSHIP_ACTIVE: "MEMBERSHIP_ACTIVE",
  MEMBERSHIP_ADJUSTED: "MEMBERSHIP_ADJUSTED",
  MEMBERSHIP_ENDED: "MEMBERSHIP_ENDED",
  MANUAL: "MANUAL",
} as const;
export type PointReason = (typeof PointReason)[keyof typeof PointReason];
