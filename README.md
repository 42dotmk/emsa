<div align="center">

# emsa

**A self-hosted member platform for organizations.**

Members, projects, pillars, and organisational info — one app, one process, your brand.

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
[![Bun](https://img.shields.io/badge/runtime-Bun-f9f1e1?logo=bun&logoColor=black)](https://bun.sh)
[![PostgreSQL](https://img.shields.io/badge/database-PostgreSQL-336791?logo=postgresql&logoColor=white)](https://www.postgresql.org)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](#contributing)

[Features](#features) · [Quick Start](#quick-start) · [Make It Yours](#make-it-yours) · [Deployment](#deployment) · [Contributing](#contributing)

<img src="https://github.com/user-attachments/assets/3754bb7b-ad54-42f8-80c7-f844973e8b63" alt="Home page" width="90%" />

</div>

Originally built for **EMSA Macedonia** (European Medical Students' Association), now open source. The name, logo, brand color, and labels are all configurable — any organization can run it as its own.

## Features

- **Public site** — landing page, project pages with image galleries, organisational pillars, board positions, and a scrolling supporter logo strip, all editable from the admin panel
- **Members** — email/password and Google OAuth login, profiles with avatars, admin-defined custom profile fields with a completion gate
- **Projects** — registration windows, participant caps, self-service sign-up, attendance tracking
- **Roles** — `USER` → `ADMIN` → `SUPER_ADMIN`, enforced server-side; the first registered account becomes the instance owner
- **Points** — an optional, renameable points system (e.g. "EMSA Credits") with its own logo: members earn points for attending projects and for holding an active membership, super admins can add or remove points with a note, and every change is kept in a per-member history and the audit log
- **Audit log** — every admin change to projects, workshops, users, memberships, pillars, organization settings, positions, supporters, and member fields is recorded with who, when, and a before/after diff, browsable and filterable by super admins
- **Rebrandable** — organization name, logo, tagline, socials, and even the "pillars" label (call them committees, departments, chapters, ...) are editable at runtime
- **Self-contained** — a single Bun process serves both the API and the React SPA; images upload straight to any S3-compatible storage via presigned URLs

<div align="center">
  <img src="https://github.com/user-attachments/assets/9666aec8-f8bf-43e2-83d6-739957b79713" alt="Projects page" width="90%" />
</div>

## Tech Stack

[Bun](https://bun.sh) · React 19 + React Router v7 · Tailwind CSS v4 + shadcn/ui · TanStack Query · React Hook Form + Zod · Drizzle ORM + PostgreSQL · Tiptap · Motion · JWT + Google OAuth · Cloudflare R2 (or any S3-compatible storage) · [Resend](https://resend.com)

## Quick Start

You'll need [Bun](https://bun.sh) >= 1.4.4 and a PostgreSQL database. For the full experience also grab an S3-compatible bucket (e.g. Cloudflare R2), Google OAuth credentials, and a Resend API key.

```bash
git clone https://github.com/AtanasovskiPetar/emsa.git
cd emsa
bun install

cp .env.example .env       # fill in your values — validated at startup in src/lib/env.ts

bunx drizzle-kit migrate   # apply database migrations
bun dev                    # http://localhost:3000
```

Register your first account — on a fresh install it automatically becomes `SUPER_ADMIN`, so the instance has an owner from day one.

For production:

```bash
bun run build
bun start
```

## Make It Yours

Almost everything is configured at runtime from the **Organization** admin page: name, logo, tagline, description, socials, board positions, supporters, custom member fields, the label used for pillars, and the points system (on/off, name, logo, and points for active membership).

The only code change for a full rebrand is the brand color (default: red), in two places:

1. [`styles/globals.css`](./styles/globals.css) — the `--primary` and `--sidebar-primary` token pairs in both the `:root` and `.dark` blocks
2. [`src/lib/email.ts`](./src/lib/email.ts) — the `theme` object used by transactional email templates

## Deployment

A production [`Dockerfile`](./Dockerfile) is included. There's also a complete [Pulumi setup](./infra/README.md) that provisions a Hetzner VPS with Traefik and deploys per-environment with Docker Compose — batteries included, but entirely optional.

## Contributing

Contributions are welcome! To get set up:

```bash
bun install
bun dev            # dev server with hot reload
bun run lint       # ESLint
bun run prettier   # format
```

The codebase conventions live in [`CLAUDE.md`](./CLAUDE.md) — worth a skim before opening a PR.

## Acknowledgements

A significant portion of this codebase was built with the assistance of Claude (Anthropic). All generated code has been reviewed, tested, and adapted to fit the project's requirements.

## License

[MIT](./LICENSE)
