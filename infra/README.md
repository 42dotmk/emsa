# Infrastructure

Pulumi program that provisions a Hetzner VPS with Traefik as a reverse proxy and deploys the app per environment with Docker Compose. One Pulumi project, two deploy types selected via the `deployType` config:

- **`infra`** — provisions the server, firewall, Docker, and Traefik. One stack, deployed first.
- **`app`** — deploys an app environment (build, `.env`, migrations, optional DB backups) onto the server from the `infra` stack. One stack per environment (e.g. `dev`, `prod`). `appEnv` sets the app's `ENV` value (`production` or `development`); `dbHostPort` is the localhost port Postgres binds to on the server and must be unique per environment.

## Prerequisites

- A [Pulumi](https://www.pulumi.com/) account and organization.
- A [Hetzner Cloud](https://www.hetzner.com/cloud) API token.
- An SSH key pair uploaded to Hetzner; the private key must be at `~/.ssh/<sshKeyName>`.
- Cloudflare R2 bucket(s), Google OAuth credentials, and a Resend API key for the app stacks (see the root README).

## Setup

```bash
cd infra
bun install
```

The example files mark secrets with `Secret[...]` placeholders — each one is replaced with real encrypted ciphertext when you run the corresponding `pulumi config set --secret` command below.

### 1. Infra stack

```bash
pulumi stack init infra
cp Pulumi.infra.example.yaml Pulumi.infra.yaml   # then edit values
pulumi config set --secret hcloud:token <token>
pulumi up
```

### 2. App stack (one per environment)

```bash
pulumi stack init prod
cp Pulumi.app.example.yaml Pulumi.prod.yaml      # then edit values
pulumi up
```

Set the app secrets on each app stack:

```bash
pulumi config set --secret dbPassword <value>
pulumi config set --secret jwtSecret <value>
pulumi config set --secret googleClientId <value>
pulumi config set --secret googleClientSecret <value>
pulumi config set --secret resendApiKey <value>
pulumi config set --secret r2AccessKeyId <value>
pulumi config set --secret r2SecretAccessKey <value>
pulumi config set --secret r2AccountId <value>
```

`fromEmail` defaults to `noreply@<domain>` when unset and must be an address on a domain verified in Resend, or outgoing emails will fail.

`appTimeZone` is an IANA time zone name (e.g. `Europe/Skopje`, the default when unset). It sets `APP_TIME_ZONE`, which decides the local time scheduled emails such as the membership-ended notice are sent at.

## Backups

When `enableBackup` is `"true"`, a weekly cron job (Sundays at 02:00) runs `pg_dump` on the environment's database, gzips it, and streams it to `r2BackupBucket` via rclone (`r2BackupBucket` is only read when backups are enabled). Logs are written to `/var/log/pg-backup-<env>.log` on the server.
