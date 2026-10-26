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
} as const;
export type AuditEntityType = (typeof AuditEntityType)[keyof typeof AuditEntityType];
