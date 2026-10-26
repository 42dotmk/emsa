import { eq } from "drizzle-orm";

import { AuditAction, AuditEntityType, Role } from "@/constants/enums";
import { ApiRoutes } from "@/constants/routes";
import { updateOrganizationSchema } from "@/constants/schemas";
import { organization } from "@/db/schema";
import { diffChanges, recordAudit } from "@/lib/audit";
import { db } from "@/lib/db";
import { parseBody, withRole } from "@/lib/middleware";
import { deleteObject, getPresignedUploadUrl, validateImageContentType } from "@/lib/s3";

const ORG_ID = 1;

// Public
const getOrganization = async () => {
  const [org] = await db
    .select({
      name: organization.name,
      tagline: organization.tagline,
      logoUrl: organization.logoUrl,
      description: organization.description,
      aboutUs: organization.aboutUs,
      instagramUrl: organization.instagramUrl,
      facebookUrl: organization.facebookUrl,
      location: organization.location,
      email: organization.email,
      phone: organization.phone,
      pillarLabel: organization.pillarLabel,
    })
    .from(organization)
    .where(eq(organization.id, ORG_ID))
    .limit(1);

  return Response.json(org ?? null);
};

// Admin
const getOrganizationAdmin = withRole(Role.SUPER_ADMIN, async () => {
  const [org] = await db.select().from(organization).where(eq(organization.id, ORG_ID)).limit(1);
  return Response.json(org ?? null);
});

const updateOrganization = withRole(Role.SUPER_ADMIN, async (req, user) => {
  const data = await parseBody(req, updateOrganizationSchema);

  const [existing] = await db
    .select()
    .from(organization)
    .where(eq(organization.id, ORG_ID))
    .limit(1);

  const [updated] = await db
    .insert(organization)
    .values({ id: ORG_ID, ...data, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: organization.id,
      set: { ...data, updatedAt: new Date() },
    })
    .returning();

  if (existing?.logoUrl && data.logoUrl !== undefined && data.logoUrl !== existing.logoUrl) {
    deleteObject(existing.logoUrl).catch(console.error);
  }

  if (updated) {
    const changes = diffChanges(existing ?? {}, updated);
    if (changes) {
      await recordAudit(user, {
        action: existing ? AuditAction.UPDATE : AuditAction.CREATE,
        entityType: AuditEntityType.ORGANIZATION,
        entityId: ORG_ID,
        entityLabel: updated.name || "Organization",
        changes,
      });
    }
  }

  return Response.json(updated);
});

const getOrganizationUploadUrl = withRole(Role.SUPER_ADMIN, async (req) => {
  const contentType = new URL(req.url).searchParams.get("contentType") ?? "image/jpeg";
  const ext = validateImageContentType(contentType);
  const key = `organization/${crypto.randomUUID()}.${ext}`;
  const { uploadUrl, fileUrl } = await getPresignedUploadUrl(key, contentType);

  return Response.json({ uploadUrl, fileUrl, key });
});

export const organizationRoutes = {
  [ApiRoutes.ORGANIZATION]: { GET: getOrganization },
  [ApiRoutes.ADMIN_ORGANIZATION_UPLOAD]: { GET: getOrganizationUploadUrl },
  [ApiRoutes.ADMIN_ORGANIZATION]: { GET: getOrganizationAdmin, PATCH: updateOrganization },
};
