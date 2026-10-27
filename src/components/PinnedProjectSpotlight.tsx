import { ArrowRight, CalendarDays, Layers, Pin } from "lucide-react";
import { motion } from "motion/react";
import { Link } from "react-router-dom";

import { ProjectPointsBadge } from "@/components/ProjectPointsBadge";
import { RegistrationStatusBadge } from "@/components/RegistrationStatusBadge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PageRoutes } from "@/constants/routes";
import { type PublicProject } from "@/constants/types";
import { spring } from "@/lib/motion";
import { getRegistrationStatus, stripHtml } from "@/lib/utils";

interface PinnedProjectSpotlightProps {
  project: PublicProject;
}

export function PinnedProjectSpotlight({ project }: PinnedProjectSpotlightProps) {
  const cover = project.images[0];
  const regStatus = getRegistrationStatus(project);
  const description = stripHtml(project.description);

  const formatDate = (dateStr: string, opts?: Intl.DateTimeFormatOptions) =>
    new Date(dateStr).toLocaleDateString("en-GB", {
      month: "short",
      day: "numeric",
      year: "numeric",
      ...opts,
    });
  const startOpts: Intl.DateTimeFormatOptions =
    project.endingAt &&
    new Date(project.startingAt).getFullYear() === new Date(project.endingAt).getFullYear()
      ? { month: "short", day: "numeric" }
      : {};
  const date = project.endingAt
    ? `${formatDate(project.startingAt, startOpts)} – ${formatDate(project.endingAt)}`
    : formatDate(project.startingAt);

  return (
    <section className="border-t">
      <Link
        to={PageRoutes.PROJECT_DETAIL.replace(":id", project.id)}
        className="group relative flex min-h-[520px] w-full overflow-hidden lg:min-h-[600px]"
      >
        {/* Background image */}
        {cover ? (
          <img
            src={cover}
            alt={project.title}
            className="absolute inset-0 size-full object-cover transition-transform duration-700 group-hover:scale-105"
          />
        ) : (
          <div className="absolute inset-0 bg-gradient-to-br from-primary/30 via-background to-chart-2/20" />
        )}

        {/* Atmospheric glow blobs */}
        <div className="pointer-events-none absolute inset-0">
          <div className="absolute left-0 top-0 size-[600px] -translate-x-1/3 -translate-y-1/3 rounded-full bg-primary/20 blur-[120px]" />
          <div className="absolute bottom-0 right-1/3 size-[400px] translate-y-1/3 rounded-full bg-chart-2/15 blur-[100px]" />
        </div>

        {/* Gradient overlays — left-heavy for text legibility, bottom fade */}
        <div className="absolute inset-0 bg-gradient-to-r from-black/90 via-black/60 to-black/10" />
        <div className="absolute inset-0 bg-gradient-to-t from-black/50 via-transparent to-transparent" />

        {/* Content */}
        <div className="relative flex w-full items-end">
          <div className="mx-auto w-full max-w-6xl px-6 py-14 lg:px-8">
            <motion.div
              initial={{ opacity: 0, y: 32 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={spring.smooth}
              className="max-w-2xl"
            >
              {/* Label */}
              <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-primary/40 bg-primary/20 px-3 py-1 text-xs font-semibold uppercase tracking-widest text-primary backdrop-blur-sm">
                <Pin className="size-3" />
                Featured Project
              </div>

              {/* Title */}
              <h2 className="mb-4 text-title text-white drop-shadow-md">{project.title}</h2>

              {/* Description excerpt */}
              {description && (
                <p className="mb-6 line-clamp-2 max-w-xl text-base leading-relaxed text-white/65">
                  {description}
                </p>
              )}

              {/* Meta row */}
              <div className="mb-8 flex flex-wrap items-center gap-3">
                <div className="flex items-center gap-1.5 text-sm text-white/55">
                  <CalendarDays className="size-3.5" />
                  {date}
                </div>
                {project.pillarName && (
                  <Badge className="border-white/20 bg-white/15 text-white backdrop-blur-sm hover:bg-white/25">
                    {project.pillarName}
                  </Badge>
                )}
                <ProjectPointsBadge points={project.points} variant="overlay" />
                <RegistrationStatusBadge status={regStatus} overlay />
              </div>

              {/* CTA */}
              <Button
                size="lg"
                className="gap-2 shadow-lg transition-all duration-300 group-hover:gap-3"
              >
                View Project
                <ArrowRight className="size-4 transition-transform duration-300 group-hover:translate-x-0.5" />
              </Button>
            </motion.div>

            {/* No-image placeholder icon */}
            {!cover && (
              <div className="pointer-events-none absolute right-16 top-1/2 -translate-y-1/2 opacity-10">
                <Layers className="size-48 text-white" />
              </div>
            )}
          </div>
        </div>
      </Link>
    </section>
  );
}
