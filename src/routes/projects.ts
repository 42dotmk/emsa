import { and, count, desc, eq, gte, inArray, lte, ne } from "drizzle-orm";
import { z } from "zod";

import { AuditAction, AuditEntityType, Role } from "@/constants/enums";
import { ApiRoutes } from "@/constants/routes";
import { projectSchema, updateProjectSchema } from "@/constants/schemas";
import {
  pillars,
  projectCapacityPools,
  projectImages,
  projectPackages,
  projectRegistrations,
  projects,
  registrationCertificates,
  userActivations,
  users,
  workshopRegistrations,
  workshops,
} from "@/db/schema";
import {
  createdChanges,
  deletedChanges,
  diffChanges,
  lookupPillarName,
  lookupProjectTitle,
  lookupUserName,
  recordAudit,
  relabelReference,
} from "@/lib/audit";
import { db } from "@/lib/db";
import { type BunRequest, HttpError, parseBody, withRole } from "@/lib/middleware";
import {
  deleteObject,
  deleteObjects,
  getPresignedUploadUrl,
  validateCertificateContentType,
  validateImageContentType,
} from "@/lib/s3";

async function getRegistrationContext(registrationId: string) {
  const [row] = await db
    .select({
      userId: projectRegistrations.userId,
      userName: users.name,
      projectId: projects.id,
      projectTitle: projects.title,
    })
    .from(projectRegistrations)
    .innerJoin(users, eq(projectRegistrations.userId, users.id))
    .innerJoin(projects, eq(projectRegistrations.projectId, projects.id))
    .where(eq(projectRegistrations.id, registrationId))
    .limit(1);
  return row;
}

async function projectMetadata(projectId: string) {
  return { projectId, projectTitle: (await lookupProjectTitle(projectId)) ?? null };
}

// Helper: compute per-package availableSpots given registration counts
async function buildPackagesWithAvailability(projectIds: string[]) {
  if (projectIds.length === 0) return {};

  const allPackages = await db
    .select({
      id: projectPackages.id,
      projectId: projectPackages.projectId,
      capacityPoolId: projectPackages.capacityPoolId,
      capacityPoolName: projectCapacityPools.name,
      capacityPoolMax: projectCapacityPools.maxParticipants,
      name: projectPackages.name,
      description: projectPackages.description,
      maxParticipants: projectPackages.maxParticipants,
      order: projectPackages.order,
      createdAt: projectPackages.createdAt,
    })
    .from(projectPackages)
    .leftJoin(projectCapacityPools, eq(projectPackages.capacityPoolId, projectCapacityPools.id))
    .where(inArray(projectPackages.projectId, projectIds))
    .orderBy(projectPackages.order);

  if (allPackages.length === 0) return {};

  // Count registrations per package
  const packageIds = allPackages.map((p) => p.id);
  const regCounts = await db
    .select({ packageId: projectRegistrations.packageId, count: count() })
    .from(projectRegistrations)
    .where(inArray(projectRegistrations.packageId, packageIds))
    .groupBy(projectRegistrations.packageId);

  const countByPackage: Record<string, number> = {};
  for (const r of regCounts) {
    if (r.packageId) countByPackage[r.packageId] = r.count;
  }

  // Count registrations per pool (sum across all packages in the pool)
  const countByPool: Record<string, number> = {};
  for (const pkg of allPackages) {
    if (pkg.capacityPoolId) {
      countByPool[pkg.capacityPoolId] =
        (countByPool[pkg.capacityPoolId] ?? 0) + (countByPackage[pkg.id] ?? 0);
    }
  }

  const byProject: Record<string, (typeof allPackages)[number][]> = {};
  for (const pkg of allPackages) {
    (byProject[pkg.projectId] ??= []).push(pkg);
  }

  const result: Record<
    string,
    {
      id: string;
      projectId: string;
      capacityPoolId: string | null;
      capacityPoolName: string | null;
      capacityPoolMax: number | null;
      name: string;
      description: string;
      maxParticipants: number | null;
      availableSpots: number | null;
      order: number;
      createdAt: Date;
    }[]
  > = {};

  for (const [projectId, pkgs] of Object.entries(byProject)) {
    result[projectId] = pkgs.map((pkg) => {
      let availableSpots: number | null = null;
      if (pkg.capacityPoolId !== null) {
        const used = countByPool[pkg.capacityPoolId] ?? 0;
        availableSpots = Math.max(0, (pkg.capacityPoolMax ?? 0) - used);
      } else if (pkg.maxParticipants !== null) {
        const used = countByPackage[pkg.id] ?? 0;
        availableSpots = Math.max(0, pkg.maxParticipants - used);
      }
      return {
        id: pkg.id,
        projectId: pkg.projectId,
        capacityPoolId: pkg.capacityPoolId,
        capacityPoolName: pkg.capacityPoolName ?? null,
        capacityPoolMax: pkg.capacityPoolMax ?? null,
        name: pkg.name,
        description: pkg.description,
        maxParticipants: pkg.maxParticipants,
        availableSpots,
        order: pkg.order,
        createdAt: pkg.createdAt,
      };
    });
  }

  return result;
}

function toPublicPackage(pkg: {
  id: string;
  name: string;
  description: string;
  order: number;
  availableSpots: number | null;
}) {
  return {
    id: pkg.id,
    name: pkg.name,
    description: pkg.description,
    order: pkg.order,
    canRegister: pkg.availableSpots === null || pkg.availableSpots > 0,
  };
}

// Public
const getProjects = async () => {
  const rows = await db
    .select({
      id: projects.id,
      title: projects.title,
      description: projects.description,
      startingAt: projects.startingAt,
      endingAt: projects.endingAt,
      pillarId: projects.pillarId,
      pillarName: pillars.name,
      registrationOpensAt: projects.registrationOpensAt,
      registrationClosesAt: projects.registrationClosesAt,
      maxParticipants: projects.maxParticipants,
      activeMembersOnly: projects.activeMembersOnly,
      isPinned: projects.isPinned,
    })
    .from(projects)
    .leftJoin(pillars, eq(projects.pillarId, pillars.id))
    .orderBy(desc(projects.startingAt));

  const projectIds = rows.map((p) => p.id);
  const imagesByProject: Record<string, string[]> = {};
  const countByProject: Record<string, number> = {};

  if (projectIds.length > 0) {
    const allImages = await db
      .select({ projectId: projectImages.projectId, url: projectImages.url })
      .from(projectImages)
      .where(inArray(projectImages.projectId, projectIds))
      .orderBy(projectImages.order);

    for (const img of allImages) {
      (imagesByProject[img.projectId] ??= []).push(img.url);
    }

    const counts = await db
      .select({ projectId: projectRegistrations.projectId, count: count() })
      .from(projectRegistrations)
      .where(inArray(projectRegistrations.projectId, projectIds))
      .groupBy(projectRegistrations.projectId);

    for (const row of counts) {
      countByProject[row.projectId] = row.count;
    }
  }

  const packagesByProject = await buildPackagesWithAvailability(projectIds);
  const now = new Date();

  return Response.json(
    rows.map((p) => {
      const pkgs = packagesByProject[p.id] ?? [];
      const publicPackages = pkgs.map(toPublicPackage);
      const participantCount = countByProject[p.id] ?? 0;
      const registrationOpen =
        p.registrationOpensAt !== null &&
        new Date(p.registrationOpensAt) <= now &&
        (p.registrationClosesAt === null || new Date(p.registrationClosesAt) > now);
      const canRegister =
        registrationOpen &&
        (pkgs.length > 0
          ? publicPackages.some((pkg) => pkg.canRegister)
          : p.maxParticipants === null || participantCount < p.maxParticipants);
      return {
        id: p.id,
        title: p.title,
        description: p.description,
        startingAt: p.startingAt,
        endingAt: p.endingAt,
        pillarId: p.pillarId,
        pillarName: p.pillarName,
        registrationOpensAt: p.registrationOpensAt,
        registrationClosesAt: p.registrationClosesAt,
        activeMembersOnly: p.activeMembersOnly,
        isPinned: p.isPinned,
        images: imagesByProject[p.id] ?? [],
        canRegister,
        packages: publicPackages,
      };
    })
  );
};

const getProjectById = async (req: BunRequest<{ id: string }>) => {
  const { id } = req.params;

  const [row] = await db
    .select({
      id: projects.id,
      title: projects.title,
      description: projects.description,
      startingAt: projects.startingAt,
      endingAt: projects.endingAt,
      pillarId: projects.pillarId,
      pillarName: pillars.name,
      registrationOpensAt: projects.registrationOpensAt,
      registrationClosesAt: projects.registrationClosesAt,
      maxParticipants: projects.maxParticipants,
      activeMembersOnly: projects.activeMembersOnly,
    })
    .from(projects)
    .leftJoin(pillars, eq(projects.pillarId, pillars.id))
    .where(eq(projects.id, id))
    .limit(1);

  if (!row) return Response.json({ error: "Not found" }, { status: 404 });

  const [images, [participantRow], packagesByProject] = await Promise.all([
    db
      .select({ url: projectImages.url })
      .from(projectImages)
      .where(eq(projectImages.projectId, id))
      .orderBy(projectImages.order),
    db
      .select({ count: count() })
      .from(projectRegistrations)
      .where(eq(projectRegistrations.projectId, id)),
    buildPackagesWithAvailability([id]),
  ]);

  const pkgs = packagesByProject[id] ?? [];
  const publicPackages = pkgs.map(toPublicPackage);
  const participantCount = participantRow?.count ?? 0;
  const now = new Date();
  const registrationOpen =
    row.registrationOpensAt !== null &&
    new Date(row.registrationOpensAt) <= now &&
    (row.registrationClosesAt === null || new Date(row.registrationClosesAt) > now);
  const canRegister =
    registrationOpen &&
    (pkgs.length > 0
      ? publicPackages.some((pkg) => pkg.canRegister)
      : row.maxParticipants === null || participantCount < row.maxParticipants);

  return Response.json({
    id: row.id,
    title: row.title,
    description: row.description,
    startingAt: row.startingAt,
    endingAt: row.endingAt,
    pillarId: row.pillarId,
    pillarName: row.pillarName,
    registrationOpensAt: row.registrationOpensAt,
    registrationClosesAt: row.registrationClosesAt,
    activeMembersOnly: row.activeMembersOnly,
    images: images.map((i) => i.url),
    canRegister,
    packages: publicPackages,
  });
};

const getMyRegistration = withRole<{ id: string }>(Role.USER, async (req, user) => {
  const { id } = req.params;

  const [reg] = await db
    .select({
      id: projectRegistrations.id,
      packageId: projectRegistrations.packageId,
      packageName: projectPackages.name,
      createdAt: projectRegistrations.createdAt,
      certificateUrl: registrationCertificates.url,
      certificateFilename: registrationCertificates.filename,
    })
    .from(projectRegistrations)
    .leftJoin(projectPackages, eq(projectRegistrations.packageId, projectPackages.id))
    .leftJoin(
      registrationCertificates,
      eq(registrationCertificates.registrationId, projectRegistrations.id)
    )
    .where(and(eq(projectRegistrations.projectId, id), eq(projectRegistrations.userId, user.sub)))
    .limit(1);

  return Response.json(
    reg
      ? {
          registered: true,
          id: reg.id,
          packageId: reg.packageId ?? null,
          packageName: reg.packageName ?? null,
          createdAt: reg.createdAt,
          certificateUrl: reg.certificateUrl ?? null,
          certificateFilename: reg.certificateFilename ?? null,
        }
      : { registered: false }
  );
});

const unregisterFromProject = withRole<{ id: string }>(Role.USER, async (req, user) => {
  const { id } = req.params;

  const [project] = await db
    .select({ registrationClosesAt: projects.registrationClosesAt })
    .from(projects)
    .where(eq(projects.id, id))
    .limit(1);

  if (!project) return Response.json({ error: "Project not found" }, { status: 404 });

  const now = new Date();
  if (project.registrationClosesAt && project.registrationClosesAt < now) {
    return Response.json({ error: "Registration has already closed" }, { status: 422 });
  }

  const [deleted] = await db.transaction(async (tx) => {
    // Cancel all workshop registrations for this user within this project
    const projectWorkshops = await tx
      .select({ id: workshops.id })
      .from(workshops)
      .where(eq(workshops.projectId, id));

    if (projectWorkshops.length > 0) {
      await tx.delete(workshopRegistrations).where(
        and(
          inArray(
            workshopRegistrations.workshopId,
            projectWorkshops.map((w) => w.id)
          ),
          eq(workshopRegistrations.userId, user.sub)
        )
      );
    }

    return tx
      .delete(projectRegistrations)
      .where(and(eq(projectRegistrations.projectId, id), eq(projectRegistrations.userId, user.sub)))
      .returning({ id: projectRegistrations.id });
  });

  if (!deleted) return Response.json({ error: "Registration not found" }, { status: 404 });

  return Response.json({ success: true });
});

const registerForProject = withRole<{ id: string }>(Role.USER, async (req, user) => {
  const { id } = req.params;
  const body = await parseBody(req, z.object({ packageId: z.uuid().nullable().optional() }));
  const packageId = body.packageId ?? null;

  const [project] = await db
    .select({
      registrationOpensAt: projects.registrationOpensAt,
      registrationClosesAt: projects.registrationClosesAt,
      maxParticipants: projects.maxParticipants,
      activeMembersOnly: projects.activeMembersOnly,
    })
    .from(projects)
    .where(eq(projects.id, id))
    .limit(1);

  if (!project) return Response.json({ error: "Project not found" }, { status: 404 });

  const now = new Date();

  if (!project.registrationOpensAt || project.registrationOpensAt > now) {
    return Response.json({ error: "Registration is not open yet" }, { status: 422 });
  }

  if (project.registrationClosesAt && project.registrationClosesAt < now) {
    return Response.json({ error: "Registration has closed" }, { status: 422 });
  }

  if (project.activeMembersOnly) {
    const today = now.toISOString().split("T")[0]!;
    const [activation] = await db
      .select({ id: userActivations.id })
      .from(userActivations)
      .where(
        and(
          eq(userActivations.userId, user.sub),
          lte(userActivations.startDate, today),
          gte(userActivations.endDate, today)
        )
      )
      .limit(1);

    if (!activation) {
      return Response.json(
        { error: "Registration is open for active members only" },
        { status: 403 }
      );
    }
  }

  // Validate package belongs to this project (if provided)
  let selectedPackage: {
    id: string;
    maxParticipants: number | null;
    capacityPoolId: string | null;
    capacityPoolMax: number | null;
  } | null = null;

  if (packageId !== null) {
    const [pkg] = await db
      .select({
        id: projectPackages.id,
        maxParticipants: projectPackages.maxParticipants,
        capacityPoolId: projectPackages.capacityPoolId,
        capacityPoolMax: projectCapacityPools.maxParticipants,
      })
      .from(projectPackages)
      .leftJoin(projectCapacityPools, eq(projectPackages.capacityPoolId, projectCapacityPools.id))
      .where(and(eq(projectPackages.id, packageId), eq(projectPackages.projectId, id)))
      .limit(1);

    if (!pkg) return Response.json({ error: "Package not found" }, { status: 404 });
    selectedPackage = pkg;
  } else {
    // If the project has packages, a packageId is required
    const [pkgExists] = await db
      .select({ id: projectPackages.id })
      .from(projectPackages)
      .where(eq(projectPackages.projectId, id))
      .limit(1);

    if (pkgExists) {
      return Response.json({ error: "A registration package must be selected" }, { status: 422 });
    }
  }

  try {
    const [registration] = await db.transaction(async (tx) => {
      if (selectedPackage !== null) {
        if (selectedPackage.capacityPoolId !== null) {
          // Shared pool capacity: lock project row, count across all packages in pool
          await tx
            .select({ id: projects.id })
            .from(projects)
            .where(eq(projects.id, id))
            .for("update")
            .limit(1);

          const poolPackages = await tx
            .select({ id: projectPackages.id })
            .from(projectPackages)
            .where(eq(projectPackages.capacityPoolId, selectedPackage.capacityPoolId));

          const [countRow] = await tx
            .select({ count: count() })
            .from(projectRegistrations)
            .where(
              inArray(
                projectRegistrations.packageId,
                poolPackages.map((p) => p.id)
              )
            );

          if (selectedPackage.capacityPoolMax === null) {
            throw new HttpError(500, "Capacity pool data unavailable");
          }
          if ((countRow?.count ?? 0) >= selectedPackage.capacityPoolMax) {
            throw new HttpError(422, "No spots remaining");
          }
        } else if (selectedPackage.maxParticipants !== null) {
          // Per-package capacity: lock project row, count for this package
          await tx
            .select({ id: projects.id })
            .from(projects)
            .where(eq(projects.id, id))
            .for("update")
            .limit(1);

          const [countRow] = await tx
            .select({ count: count() })
            .from(projectRegistrations)
            .where(eq(projectRegistrations.packageId, selectedPackage.id));

          if ((countRow?.count ?? 0) >= selectedPackage.maxParticipants) {
            throw new HttpError(422, "No spots remaining");
          }
        }
      } else if (project.maxParticipants !== null) {
        // Legacy project-level capacity
        await tx
          .select({ id: projects.id })
          .from(projects)
          .where(eq(projects.id, id))
          .for("update")
          .limit(1);

        const [countRow] = await tx
          .select({ count: count() })
          .from(projectRegistrations)
          .where(eq(projectRegistrations.projectId, id));

        if ((countRow?.count ?? 0) >= project.maxParticipants) {
          throw new HttpError(422, "No spots remaining");
        }
      }

      return tx
        .insert(projectRegistrations)
        .values({ projectId: id, userId: user.sub, packageId })
        .returning();
    });

    return Response.json(registration, { status: 201 });
  } catch (err) {
    if (err instanceof HttpError) throw err;
    // Unique constraint violation — user already registered
    if ((err as { code?: string }).code === "23505") {
      return Response.json({ error: "Already registered" }, { status: 409 });
    }
    throw err;
  }
});

// Admin
const getProjectsAdmin = withRole(Role.ADMIN, async () => {
  const rows = await db
    .select({
      id: projects.id,
      title: projects.title,
      description: projects.description,
      startingAt: projects.startingAt,
      endingAt: projects.endingAt,
      pillarId: projects.pillarId,
      pillarName: pillars.name,
      registrationOpensAt: projects.registrationOpensAt,
      registrationClosesAt: projects.registrationClosesAt,
      maxParticipants: projects.maxParticipants,
      activeMembersOnly: projects.activeMembersOnly,
      isPinned: projects.isPinned,
      createdAt: projects.createdAt,
      updatedAt: projects.updatedAt,
    })
    .from(projects)
    .leftJoin(pillars, eq(projects.pillarId, pillars.id))
    .orderBy(desc(projects.startingAt));

  const adminProjectIds = rows.map((p) => p.id);
  const adminImagesByProject: Record<string, string[]> = {};

  if (adminProjectIds.length > 0) {
    const allImages = await db
      .select({ projectId: projectImages.projectId, url: projectImages.url })
      .from(projectImages)
      .where(inArray(projectImages.projectId, adminProjectIds))
      .orderBy(projectImages.order);

    for (const img of allImages) {
      (adminImagesByProject[img.projectId] ??= []).push(img.url);
    }
  }

  const packagesByProject = await buildPackagesWithAvailability(adminProjectIds);

  return Response.json(
    rows.map((p) => ({
      ...p,
      images: adminImagesByProject[p.id] ?? [],
      packages: packagesByProject[p.id] ?? [],
    }))
  );
});

const createProject = withRole(Role.ADMIN, async (req, user) => {
  const { imageUrls, startingAt, endingAt, registrationOpensAt, registrationClosesAt, ...rest } =
    await parseBody(req, projectSchema);

  const project = await db.transaction(async (tx) => {
    const [newProject] = await tx
      .insert(projects)
      .values({
        ...rest,
        isPinned: false,
        startingAt: new Date(startingAt),
        endingAt: endingAt ? new Date(endingAt) : null,
        registrationOpensAt: registrationOpensAt ? new Date(registrationOpensAt) : null,
        registrationClosesAt: registrationClosesAt ? new Date(registrationClosesAt) : null,
      })
      .returning();

    if (!newProject) throw new HttpError(500, "Failed to create project");

    if (imageUrls.length > 0) {
      await tx
        .insert(projectImages)
        .values(imageUrls.map((url, i) => ({ projectId: newProject.id, url, order: i })));
    }

    return newProject;
  });

  await recordAudit(user, {
    action: AuditAction.CREATE,
    entityType: AuditEntityType.PROJECT,
    entityId: project.id,
    entityLabel: project.title,
    changes: await relabelReference(
      createdChanges(project),
      "pillarId",
      "pillar",
      lookupPillarName
    ),
    metadata: imageUrls.length > 0 ? { imagesAdded: imageUrls.length } : null,
  });

  return Response.json(project, { status: 201 });
});

const updateProject = withRole<{ id: string }>(Role.ADMIN, async (req, user) => {
  const { id } = req.params;
  const { imageUrls, startingAt, endingAt, registrationOpensAt, registrationClosesAt, ...rest } =
    await parseBody(req, updateProjectSchema);

  const [before] = await db.select().from(projects).where(eq(projects.id, id)).limit(1);

  let imagesToDelete: { url: string }[] = [];
  let imagesAdded = 0;

  const updated = await db.transaction(async (tx) => {
    if (rest.isPinned === true) {
      await tx
        .update(projects)
        .set({ isPinned: false })
        .where(and(eq(projects.isPinned, true), ne(projects.id, id)));
    }

    const [project] = await tx
      .update(projects)
      .set({
        ...rest,
        ...(startingAt !== undefined && { startingAt: new Date(startingAt) }),
        ...(endingAt !== undefined && { endingAt: endingAt ? new Date(endingAt) : null }),
        ...(registrationOpensAt !== undefined && {
          registrationOpensAt: registrationOpensAt ? new Date(registrationOpensAt) : null,
        }),
        ...(registrationClosesAt !== undefined && {
          registrationClosesAt: registrationClosesAt ? new Date(registrationClosesAt) : null,
        }),
        updatedAt: new Date(),
      })
      .where(eq(projects.id, id))
      .returning();

    if (!project) throw new HttpError(404, "Project not found");

    if (imageUrls !== undefined) {
      const existingImages = await tx
        .select({ id: projectImages.id, url: projectImages.url })
        .from(projectImages)
        .where(eq(projectImages.projectId, id));

      const existingByUrl = new Map(existingImages.map((img) => [img.url, img]));
      const newUrlOrder = new Map(imageUrls.map((url, i) => [url, i]));

      const toDelete = existingImages.filter((img) => !newUrlOrder.has(img.url));
      const toInsert = imageUrls.filter((url) => !existingByUrl.has(url));

      if (toDelete.length > 0) {
        await tx.delete(projectImages).where(
          and(
            eq(projectImages.projectId, id),
            inArray(
              projectImages.id,
              toDelete.map((img) => img.id)
            )
          )
        );
        imagesToDelete = toDelete;
      }

      if (toInsert.length > 0) {
        await tx
          .insert(projectImages)
          .values(toInsert.map((url) => ({ projectId: id, url, order: newUrlOrder.get(url)! })));
        imagesAdded = toInsert.length;
      }

      const toUpdateOrder = existingImages.filter((img) => newUrlOrder.has(img.url));
      await Promise.all(
        toUpdateOrder.map((img) =>
          tx
            .update(projectImages)
            .set({ order: newUrlOrder.get(img.url)! })
            .where(and(eq(projectImages.projectId, id), eq(projectImages.id, img.id)))
        )
      );
    }

    return project;
  });

  await deleteObjects(imagesToDelete.map((img) => img.url));

  const changes = await relabelReference(
    diffChanges(before ?? {}, updated),
    "pillarId",
    "pillar",
    lookupPillarName
  );
  const imagesChanged = imagesAdded > 0 || imagesToDelete.length > 0;
  if (changes || imagesChanged) {
    await recordAudit(user, {
      action: AuditAction.UPDATE,
      entityType: AuditEntityType.PROJECT,
      entityId: updated.id,
      entityLabel: updated.title,
      changes,
      metadata: imagesChanged ? { imagesAdded, imagesRemoved: imagesToDelete.length } : null,
    });
  }

  return Response.json(updated);
});

const deleteProject = withRole<{ id: string }>(Role.ADMIN, async (req, user) => {
  const { id } = req.params;

  const { deleted, images } = await db.transaction(async (tx) => {
    const projectImages_ = await tx
      .select({ url: projectImages.url })
      .from(projectImages)
      .where(eq(projectImages.projectId, id));

    const [deletedProject] = await tx.delete(projects).where(eq(projects.id, id)).returning();

    return { deleted: deletedProject, images: projectImages_ };
  });

  if (!deleted) {
    return Response.json({ error: "Project not found" }, { status: 404 });
  }

  await deleteObjects(images.map((img) => img.url));

  await recordAudit(user, {
    action: AuditAction.DELETE,
    entityType: AuditEntityType.PROJECT,
    entityId: deleted.id,
    entityLabel: deleted.title,
    changes: await relabelReference(
      deletedChanges(deleted),
      "pillarId",
      "pillar",
      lookupPillarName
    ),
  });

  return Response.json({ success: true });
});

const getProjectUploadUrl = withRole(Role.ADMIN, async (req) => {
  const contentType = new URL(req.url).searchParams.get("contentType") ?? "image/jpeg";
  const ext = validateImageContentType(contentType);
  const key = `project-images/${crypto.randomUUID()}.${ext}`;
  const { uploadUrl, fileUrl } = await getPresignedUploadUrl(key, contentType);

  return Response.json({ uploadUrl, fileUrl, key });
});

const getProjectRegistrations = withRole<{ id: string }>(Role.ADMIN, async (req) => {
  const { id } = req.params;
  const packageIdFilter = new URL(req.url).searchParams.get("packageId");

  const conditions = [eq(projectRegistrations.projectId, id)];
  if (packageIdFilter) conditions.push(eq(projectRegistrations.packageId, packageIdFilter));

  const rows = await db
    .select({
      id: projectRegistrations.id,
      userId: projectRegistrations.userId,
      userName: users.name,
      userEmail: users.email,
      packageId: projectRegistrations.packageId,
      packageName: projectPackages.name,
      attended: projectRegistrations.attended,
      certificateUrl: registrationCertificates.url,
      certificateFilename: registrationCertificates.filename,
      createdAt: projectRegistrations.createdAt,
    })
    .from(projectRegistrations)
    .innerJoin(users, eq(projectRegistrations.userId, users.id))
    .leftJoin(projectPackages, eq(projectRegistrations.packageId, projectPackages.id))
    .leftJoin(
      registrationCertificates,
      eq(registrationCertificates.registrationId, projectRegistrations.id)
    )
    .where(and(...conditions))
    .orderBy(projectRegistrations.createdAt);

  return Response.json(
    rows.map((r) => ({
      ...r,
      packageId: r.packageId ?? null,
      packageName: r.packageName ?? null,
      certificateUrl: r.certificateUrl ?? null,
      certificateFilename: r.certificateFilename ?? null,
    }))
  );
});

const updateRegistrationAttended = withRole<{ id: string }>(Role.ADMIN, async (req) => {
  const { id } = req.params;
  const body = await parseBody(req, z.object({ attended: z.boolean() }));

  const [updated] = await db
    .update(projectRegistrations)
    .set({ attended: body.attended })
    .where(eq(projectRegistrations.id, id))
    .returning();

  if (!updated) return Response.json({ error: "Registration not found" }, { status: 404 });

  return Response.json(updated);
});

const addProjectRegistration = withRole<{ id: string }>(Role.SUPER_ADMIN, async (req, user) => {
  const { id } = req.params;
  const body = await parseBody(
    req,
    z.object({ userId: z.uuid(), packageId: z.uuid().nullable().optional() })
  );

  const [existing] = await db
    .select({ id: projectRegistrations.id })
    .from(projectRegistrations)
    .where(
      and(eq(projectRegistrations.projectId, id), eq(projectRegistrations.userId, body.userId))
    )
    .limit(1);

  if (existing) return Response.json({ error: "User already registered" }, { status: 409 });

  if (body.packageId) {
    const [pkg] = await db
      .select({ id: projectPackages.id })
      .from(projectPackages)
      .where(and(eq(projectPackages.id, body.packageId), eq(projectPackages.projectId, id)))
      .limit(1);
    if (!pkg) return Response.json({ error: "Package not found" }, { status: 404 });
  }

  const [registration] = await db
    .insert(projectRegistrations)
    .values({ projectId: id, userId: body.userId, packageId: body.packageId ?? null })
    .returning();

  if (registration) {
    await recordAudit(user, {
      action: AuditAction.CREATE,
      entityType: AuditEntityType.REGISTRATION,
      entityId: registration.id,
      entityLabel: (await lookupUserName(body.userId)) ?? body.userId,
      metadata: { ...(await projectMetadata(id)), userId: body.userId },
    });
  }

  return Response.json(registration, { status: 201 });
});

const deleteProjectRegistration = withRole<{ id: string }>(Role.SUPER_ADMIN, async (req, user) => {
  const { id } = req.params;

  const reg = await getRegistrationContext(id);

  if (!reg) return Response.json({ error: "Registration not found" }, { status: 404 });

  await db.transaction(async (tx) => {
    const projectWorkshops = await tx
      .select({ id: workshops.id })
      .from(workshops)
      .where(eq(workshops.projectId, reg.projectId));

    if (projectWorkshops.length > 0) {
      await tx.delete(workshopRegistrations).where(
        and(
          inArray(
            workshopRegistrations.workshopId,
            projectWorkshops.map((w) => w.id)
          ),
          eq(workshopRegistrations.userId, reg.userId)
        )
      );
    }

    await tx.delete(projectRegistrations).where(eq(projectRegistrations.id, id));
  });

  await recordAudit(user, {
    action: AuditAction.DELETE,
    entityType: AuditEntityType.REGISTRATION,
    entityId: id,
    entityLabel: reg.userName,
    metadata: { projectId: reg.projectId, projectTitle: reg.projectTitle, userId: reg.userId },
  });

  return Response.json({ success: true });
});

const getCertificateUploadUrl = withRole<{ id: string }>(Role.ADMIN, async (req) => {
  const { id } = req.params;
  const contentType = new URL(req.url).searchParams.get("contentType") ?? "application/pdf";
  const ext = validateCertificateContentType(contentType);

  const [reg] = await db
    .select({ id: projectRegistrations.id })
    .from(projectRegistrations)
    .where(eq(projectRegistrations.id, id))
    .limit(1);

  if (!reg) return Response.json({ error: "Registration not found" }, { status: 404 });

  const key = `certificates/${id}/${crypto.randomUUID()}.${ext}`;
  const { uploadUrl, fileUrl } = await getPresignedUploadUrl(key, contentType);
  return Response.json({ uploadUrl, fileUrl });
});

const saveCertificate = withRole<{ id: string }>(Role.ADMIN, async (req, user) => {
  const { id } = req.params;
  const body = await parseBody(req, z.object({ url: z.url(), filename: z.string().min(1) }));

  const reg = await getRegistrationContext(id);

  if (!reg) return Response.json({ error: "Registration not found" }, { status: 404 });

  const auditCertificate = (action: AuditAction, previousFilename: string | null) =>
    recordAudit(user, {
      action,
      entityType: AuditEntityType.CERTIFICATE,
      entityId: id,
      entityLabel: reg.userName,
      changes: { filename: { from: previousFilename, to: body.filename } },
      metadata: { projectId: reg.projectId, projectTitle: reg.projectTitle, userId: reg.userId },
    });

  const [existing] = await db
    .select({ url: registrationCertificates.url, filename: registrationCertificates.filename })
    .from(registrationCertificates)
    .where(eq(registrationCertificates.registrationId, id))
    .limit(1);

  if (existing) {
    const [updated] = await db
      .update(registrationCertificates)
      .set({ url: body.url, filename: body.filename, uploadedAt: new Date() })
      .where(eq(registrationCertificates.registrationId, id))
      .returning();
    deleteObject(existing.url).catch(console.error);
    await auditCertificate(AuditAction.UPDATE, existing.filename);
    return Response.json(updated);
  }

  const [created] = await db
    .insert(registrationCertificates)
    .values({ registrationId: id, url: body.url, filename: body.filename })
    .returning();
  await auditCertificate(AuditAction.CREATE, null);
  return Response.json(created, { status: 201 });
});

const deleteCertificate = withRole<{ id: string }>(Role.ADMIN, async (req, user) => {
  const { id } = req.params;

  const [cert] = await db
    .select({ url: registrationCertificates.url, filename: registrationCertificates.filename })
    .from(registrationCertificates)
    .where(eq(registrationCertificates.registrationId, id))
    .limit(1);

  if (!cert) return Response.json({ error: "Certificate not found" }, { status: 404 });

  await db.delete(registrationCertificates).where(eq(registrationCertificates.registrationId, id));

  deleteObject(cert.url).catch(console.error);

  const reg = await getRegistrationContext(id);
  await recordAudit(user, {
    action: AuditAction.DELETE,
    entityType: AuditEntityType.CERTIFICATE,
    entityId: id,
    entityLabel: reg?.userName ?? id,
    changes: { filename: { from: cert.filename, to: null } },
    metadata: reg
      ? { projectId: reg.projectId, projectTitle: reg.projectTitle, userId: reg.userId }
      : null,
  });

  return Response.json({ success: true });
});

// Package CRUD
const getProjectPackages = withRole<{ id: string }>(Role.ADMIN, async (req) => {
  const { id } = req.params;
  const packagesByProject = await buildPackagesWithAvailability([id]);
  return Response.json(packagesByProject[id] ?? []);
});

const createProjectPackage = withRole<{ id: string }>(Role.ADMIN, async (req, user) => {
  const { id } = req.params;
  const body = await parseBody(
    req,
    z.object({
      name: z.string().min(1),
      description: z.string().default(""),
      maxParticipants: z.number().int().min(1).nullable().optional(),
      capacityPoolId: z.uuid().nullable().optional(),
      order: z.number().int().min(0).default(0),
    })
  );

  const [project] = await db
    .select({ id: projects.id, title: projects.title })
    .from(projects)
    .where(eq(projects.id, id))
    .limit(1);
  if (!project) return Response.json({ error: "Project not found" }, { status: 404 });

  if (body.capacityPoolId) {
    const [pool] = await db
      .select({ id: projectCapacityPools.id })
      .from(projectCapacityPools)
      .where(
        and(
          eq(projectCapacityPools.id, body.capacityPoolId),
          eq(projectCapacityPools.projectId, id)
        )
      )
      .limit(1);
    if (!pool) return Response.json({ error: "Capacity pool not found" }, { status: 404 });
  }

  const [pkg] = await db
    .insert(projectPackages)
    .values({
      projectId: id,
      name: body.name,
      description: body.description,
      maxParticipants: body.capacityPoolId ? null : (body.maxParticipants ?? null),
      capacityPoolId: body.capacityPoolId ?? null,
      order: body.order,
    })
    .returning();

  if (pkg) {
    await recordAudit(user, {
      action: AuditAction.CREATE,
      entityType: AuditEntityType.PACKAGE,
      entityId: pkg.id,
      entityLabel: pkg.name,
      changes: createdChanges({ ...pkg, projectId: undefined }),
      metadata: { projectId: id, projectTitle: project.title },
    });
  }

  return Response.json(pkg, { status: 201 });
});

const updateProjectPackage = withRole<{ id: string; packageId: string }>(
  Role.ADMIN,
  async (req, user) => {
    const { packageId, id } = req.params;
    const body = await parseBody(
      req,
      z.object({
        name: z.string().min(1).optional(),
        description: z.string().optional(),
        maxParticipants: z.number().int().min(1).nullable().optional(),
        capacityPoolId: z.uuid().nullable().optional(),
        order: z.number().int().min(0).optional(),
      })
    );

    if (body.capacityPoolId) {
      const [pool] = await db
        .select({ id: projectCapacityPools.id })
        .from(projectCapacityPools)
        .where(
          and(
            eq(projectCapacityPools.id, body.capacityPoolId),
            eq(projectCapacityPools.projectId, id)
          )
        )
        .limit(1);
      if (!pool) return Response.json({ error: "Capacity pool not found" }, { status: 404 });
    }

    const clearIndividualMax = body.capacityPoolId !== undefined && body.capacityPoolId !== null;

    const [before] = await db
      .select()
      .from(projectPackages)
      .where(and(eq(projectPackages.id, packageId), eq(projectPackages.projectId, id)))
      .limit(1);

    const [updated] = await db
      .update(projectPackages)
      .set({
        ...(body.name !== undefined && { name: body.name }),
        ...(body.description !== undefined && { description: body.description }),
        ...(body.order !== undefined && { order: body.order }),
        ...(body.capacityPoolId !== undefined && { capacityPoolId: body.capacityPoolId }),
        ...(clearIndividualMax
          ? { maxParticipants: null }
          : body.maxParticipants !== undefined && { maxParticipants: body.maxParticipants }),
      })
      .where(and(eq(projectPackages.id, packageId), eq(projectPackages.projectId, id)))
      .returning();

    if (!updated) return Response.json({ error: "Package not found" }, { status: 404 });

    const changes = diffChanges(before ?? {}, updated);
    if (changes) {
      await recordAudit(user, {
        action: AuditAction.UPDATE,
        entityType: AuditEntityType.PACKAGE,
        entityId: updated.id,
        entityLabel: updated.name,
        changes,
        metadata: await projectMetadata(id),
      });
    }

    return Response.json(updated);
  }
);

const deleteProjectPackage = withRole<{ id: string; packageId: string }>(
  Role.ADMIN,
  async (req, user) => {
    const { packageId, id } = req.params;

    const [deleted] = await db
      .delete(projectPackages)
      .where(and(eq(projectPackages.id, packageId), eq(projectPackages.projectId, id)))
      .returning();

    if (!deleted) return Response.json({ error: "Package not found" }, { status: 404 });

    await recordAudit(user, {
      action: AuditAction.DELETE,
      entityType: AuditEntityType.PACKAGE,
      entityId: deleted.id,
      entityLabel: deleted.name,
      changes: deletedChanges({ ...deleted, projectId: undefined }),
      metadata: await projectMetadata(id),
    });

    return Response.json({ success: true });
  }
);

// Capacity pool CRUD
const getProjectCapacityPools = withRole<{ id: string }>(Role.ADMIN, async (req) => {
  const { id } = req.params;

  const pools = await db
    .select()
    .from(projectCapacityPools)
    .where(eq(projectCapacityPools.projectId, id))
    .orderBy(projectCapacityPools.createdAt);

  return Response.json(pools);
});

const createProjectCapacityPool = withRole<{ id: string }>(Role.ADMIN, async (req, user) => {
  const { id } = req.params;
  const body = await parseBody(
    req,
    z.object({ name: z.string().min(1), maxParticipants: z.number().int().min(1) })
  );

  const [project] = await db
    .select({ id: projects.id, title: projects.title })
    .from(projects)
    .where(eq(projects.id, id))
    .limit(1);
  if (!project) return Response.json({ error: "Project not found" }, { status: 404 });

  const [pool] = await db
    .insert(projectCapacityPools)
    .values({ projectId: id, name: body.name, maxParticipants: body.maxParticipants })
    .returning();

  if (pool) {
    await recordAudit(user, {
      action: AuditAction.CREATE,
      entityType: AuditEntityType.CAPACITY_POOL,
      entityId: pool.id,
      entityLabel: pool.name,
      changes: createdChanges({ ...pool, projectId: undefined }),
      metadata: { projectId: id, projectTitle: project.title },
    });
  }

  return Response.json(pool, { status: 201 });
});

const updateProjectCapacityPool = withRole<{ id: string; poolId: string }>(
  Role.ADMIN,
  async (req, user) => {
    const { poolId, id } = req.params;
    const body = await parseBody(
      req,
      z
        .object({
          name: z.string().min(1).optional(),
          maxParticipants: z.number().int().min(1).optional(),
        })
        .refine((d) => d.name !== undefined || d.maxParticipants !== undefined, {
          message: "At least one field must be provided",
        })
    );

    const [before] = await db
      .select()
      .from(projectCapacityPools)
      .where(and(eq(projectCapacityPools.id, poolId), eq(projectCapacityPools.projectId, id)))
      .limit(1);

    const [updated] = await db
      .update(projectCapacityPools)
      .set({
        ...(body.name !== undefined && { name: body.name }),
        ...(body.maxParticipants !== undefined && { maxParticipants: body.maxParticipants }),
      })
      .where(and(eq(projectCapacityPools.id, poolId), eq(projectCapacityPools.projectId, id)))
      .returning();

    if (!updated) return Response.json({ error: "Capacity pool not found" }, { status: 404 });

    const changes = diffChanges(before ?? {}, updated);
    if (changes) {
      await recordAudit(user, {
        action: AuditAction.UPDATE,
        entityType: AuditEntityType.CAPACITY_POOL,
        entityId: updated.id,
        entityLabel: updated.name,
        changes,
        metadata: await projectMetadata(id),
      });
    }

    return Response.json(updated);
  }
);

const deleteProjectCapacityPool = withRole<{ id: string; poolId: string }>(
  Role.ADMIN,
  async (req, user) => {
    const { poolId, id } = req.params;

    const [deleted] = await db
      .delete(projectCapacityPools)
      .where(and(eq(projectCapacityPools.id, poolId), eq(projectCapacityPools.projectId, id)))
      .returning();

    if (!deleted) return Response.json({ error: "Capacity pool not found" }, { status: 404 });

    await recordAudit(user, {
      action: AuditAction.DELETE,
      entityType: AuditEntityType.CAPACITY_POOL,
      entityId: deleted.id,
      entityLabel: deleted.name,
      changes: deletedChanges({ ...deleted, projectId: undefined }),
      metadata: await projectMetadata(id),
    });
    return Response.json({ success: true });
  }
);

export const projectRoutes = {
  [ApiRoutes.PROJECTS]: { GET: getProjects },
  [ApiRoutes.PROJECT_BY_ID]: { GET: getProjectById },
  [ApiRoutes.PROJECT_REGISTER]: { POST: registerForProject, DELETE: unregisterFromProject },
  [ApiRoutes.PROJECT_MY_REGISTRATION]: { GET: getMyRegistration },
  [ApiRoutes.ADMIN_PROJECTS_UPLOAD]: { GET: getProjectUploadUrl },
  [ApiRoutes.ADMIN_PROJECTS]: { GET: getProjectsAdmin, POST: createProject },
  [ApiRoutes.ADMIN_PROJECT_BY_ID]: { PATCH: updateProject, DELETE: deleteProject },
  [ApiRoutes.ADMIN_PROJECT_REGISTRATIONS]: {
    GET: getProjectRegistrations,
    POST: addProjectRegistration,
  },
  [ApiRoutes.ADMIN_PROJECT_REGISTRATION_BY_ID]: {
    PATCH: updateRegistrationAttended,
    DELETE: deleteProjectRegistration,
  },
  [ApiRoutes.ADMIN_REGISTRATION_CERTIFICATE_UPLOAD]: { GET: getCertificateUploadUrl },
  [ApiRoutes.ADMIN_REGISTRATION_CERTIFICATE]: {
    POST: saveCertificate,
    DELETE: deleteCertificate,
  },
  [ApiRoutes.ADMIN_PROJECT_PACKAGES]: {
    GET: getProjectPackages,
    POST: createProjectPackage,
  },
  [ApiRoutes.ADMIN_PROJECT_PACKAGE_BY_ID]: {
    PATCH: updateProjectPackage,
    DELETE: deleteProjectPackage,
  },
  [ApiRoutes.ADMIN_PROJECT_CAPACITY_POOLS]: {
    GET: getProjectCapacityPools,
    POST: createProjectCapacityPool,
  },
  [ApiRoutes.ADMIN_PROJECT_CAPACITY_POOL_BY_ID]: {
    PATCH: updateProjectCapacityPool,
    DELETE: deleteProjectCapacityPool,
  },
};
