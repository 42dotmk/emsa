import { serve } from "bun";
import { eq } from "drizzle-orm";

import { organization, pillars, projects } from "./db/schema";
import index from "./index.html";
import { db } from "./lib/db";
import { env } from "./lib/env";
import { startPointsScheduler } from "./lib/points";
import { escapeHtml } from "./lib/utils";
import { auditLogRoutes } from "./routes/audit-logs";
import { authRoutes } from "./routes/auth";
import { dashboardRoutes } from "./routes/dashboard";
import { galleryRoutes } from "./routes/gallery";
import { memberFieldRoutes } from "./routes/member-fields";
import { organizationRoutes } from "./routes/organization";
import { pillarRoutes } from "./routes/pillars";
import { pointRoutes } from "./routes/points";
import { positionRoutes } from "./routes/positions";
import { projectRoutes } from "./routes/projects";
import { supporterRoutes } from "./routes/supporters";
import { userRoutes } from "./routes/users";
import { workshopRoutes } from "./routes/workshops";

const isProd = process.env.NODE_ENV === "production";

type OrgMeta = { name: string; logoUrl: string; description: string };
let orgMetaPromise: Promise<OrgMeta> | null = null;

function getOrgMeta(): Promise<OrgMeta> {
  if (!orgMetaPromise) {
    orgMetaPromise = db
      .select({
        name: organization.name,
        logoUrl: organization.logoUrl,
        description: organization.description,
      })
      .from(organization)
      .where(eq(organization.id, 1))
      .limit(1)
      .then(([org]) => ({
        name: org?.name || "emsa",
        logoUrl: org?.logoUrl || "",
        description: org?.description || "emsa — a self-hosted member platform for organizations.",
      }));
  }
  return orgMetaPromise;
}

async function buildSitemap(): Promise<string> {
  const base = env.APP_URL.replace(/\/$/, "");
  const now = new Date().toISOString().split("T")[0];

  const [projectRows, pillarRows] = await Promise.all([
    db.select({ id: projects.id, updatedAt: projects.updatedAt }).from(projects),
    db.select({ id: pillars.id, updatedAt: pillars.updatedAt }).from(pillars),
  ]);

  const staticUrls = [
    `<url><loc>${base}/</loc><changefreq>weekly</changefreq><priority>1.0</priority><lastmod>${now}</lastmod></url>`,
    `<url><loc>${base}/projects</loc><changefreq>weekly</changefreq><priority>0.8</priority><lastmod>${now}</lastmod></url>`,
  ];

  const projectUrls = projectRows.map(
    (p) =>
      `<url><loc>${base}/projects/${p.id}</loc><changefreq>monthly</changefreq><priority>0.7</priority><lastmod>${p.updatedAt.toISOString().split("T")[0]}</lastmod></url>`
  );

  const pillarUrls = pillarRows.map(
    (p) =>
      `<url><loc>${base}/pillars/${p.id}</loc><changefreq>monthly</changefreq><priority>0.7</priority><lastmod>${p.updatedAt.toISOString().split("T")[0]}</lastmod></url>`
  );

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${[...staticUrls, ...projectUrls, ...pillarUrls].join("\n")}
</urlset>`;
}

const server = serve({
  port: env.PORT,
  routes: {
    "/robots.txt": () =>
      new Response(
        `User-agent: *\nAllow: /\nDisallow: /admin\nDisallow: /api\n\nSitemap: ${env.APP_URL.replace(/\/$/, "")}/sitemap.xml\n`,
        { headers: { "Content-Type": "text/plain; charset=utf-8" } }
      ),
    "/sitemap.xml": async () => {
      const xml = await buildSitemap();
      return new Response(xml, {
        headers: { "Content-Type": "application/xml; charset=utf-8" },
      });
    },
    "/*": isProd
      ? async (req: Request) => {
          const pathname = new URL(req.url).pathname;
          const file = Bun.file(`./dist${pathname}`);
          if (await file.exists()) return new Response(file);
          const org = await getOrgMeta();
          const html = (await Bun.file("./dist/index.html").text())
            .replaceAll("%APP_URL%", env.APP_URL)
            .replaceAll("%ORG_NAME%", escapeHtml(org.name))
            .replaceAll("%ORG_LOGO_URL%", escapeHtml(org.logoUrl))
            .replaceAll("%ORG_DESCRIPTION%", escapeHtml(org.description))
            .replace(
              "<!--FAVICON-->",
              org.logoUrl ? `<link rel="icon" href="${escapeHtml(org.logoUrl)}" />` : ""
            );
          return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
        }
      : index,
    ...auditLogRoutes,
    ...authRoutes,
    ...galleryRoutes,
    ...memberFieldRoutes,
    ...organizationRoutes,
    ...pillarRoutes,
    ...pointRoutes,
    ...positionRoutes,
    ...projectRoutes,
    ...supporterRoutes,
    ...workshopRoutes,
    ...userRoutes,
    ...dashboardRoutes,
  },

  development: !isProd && {
    hmr: true,
    console: true,
  },
});

startPointsScheduler();

console.log(`🚀 Server running at ${server.url}`);
