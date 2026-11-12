import * as pulumi from "@pulumi/pulumi";

export const installDockerCmd = `
if ! command -v docker &>/dev/null; then
  apt-get update -y
  apt-get install -y ca-certificates curl gnupg lsb-release
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
  chmod a+r /etc/apt/keyrings/docker.gpg
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(lsb_release -cs) stable" > /etc/apt/sources.list.d/docker.list
  apt-get update -y
  apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
  systemctl enable docker
  systemctl start docker
fi
docker network create emsa-shared 2>/dev/null || true
`;

interface EnvFileParams {
  appDir: string;
  envName: string;
  appEnv: string;
  domain: string;
  dbHostPort: string;
  dbPassword: pulumi.Output<string>;
  jwtSecret: pulumi.Output<string>;
  googleClientId: pulumi.Output<string>;
  googleClientSecret: pulumi.Output<string>;
  r2AccessKeyId: pulumi.Output<string>;
  r2SecretAccessKey: pulumi.Output<string>;
  r2AccountId: pulumi.Output<string>;
  r2Bucket: string;
  r2PublicUrl: string;
  resendApiKey: pulumi.Output<string>;
  fromEmail: string;
  appTimeZone: string;
}

export function makeEnvFileCmd(p: EnvFileParams): pulumi.Output<string> {
  return pulumi.interpolate`cat > ${p.appDir}/.env << 'ENVEOF'
ENV_NAME=${p.envName}
DOMAIN=${p.domain}
PORT=3000
ENV=${p.appEnv}
DB_HOST=postgres-${p.envName}
DB_PORT=5432
DB_HOST_PORT=${p.dbHostPort}
DB_USER=emsa
DB_PASS=${p.dbPassword}
DB_NAME=emsa_${p.envName}
DB_SCHEMA=public
JWT_SECRET=${p.jwtSecret}
JWT_EXPIRES_IN=7d
GOOGLE_CLIENT_ID=${p.googleClientId}
GOOGLE_CLIENT_SECRET=${p.googleClientSecret}
GOOGLE_REDIRECT_URI=https://${p.domain}/api/auth/google/callback
APP_URL=https://${p.domain}
APP_TIME_ZONE=${p.appTimeZone}
R2_ACCESS_KEY_ID=${p.r2AccessKeyId}
R2_SECRET_ACCESS_KEY=${p.r2SecretAccessKey}
R2_ACCOUNT_ID=${p.r2AccountId}
R2_BUCKET=${p.r2Bucket}
R2_PUBLIC_URL=${p.r2PublicUrl}
RESEND_API_KEY=${p.resendApiKey}
FROM_EMAIL=${p.fromEmail}
ENVEOF`;
}

export function makeDeployCmd(appDir: string, envName: string, domain: string): string {
  return `
cd ${appDir}
ENV_NAME=${envName} DOMAIN=${domain} docker compose -p emsa-${envName} build
ENV_NAME=${envName} DOMAIN=${domain} docker compose -p emsa-${envName} up -d
`;
}

export function makeMigrateCmd(envName: string): string {
  return `
for i in $(seq 1 20); do
  echo "Migration attempt $i/20..."
  if docker exec app-${envName} bunx drizzle-kit migrate 2>&1; then
    echo "Migrations applied successfully"
    exit 0
  fi
  sleep 3
done
echo "Migrations failed after 20 attempts" >&2
exit 1
`;
}

interface BackupParams {
  envName: string;
  r2AccessKeyId: pulumi.Output<string>;
  r2SecretAccessKey: pulumi.Output<string>;
  r2AccountId: pulumi.Output<string>;
  r2BackupBucket: string;
  dbPassword: pulumi.Output<string>;
}

export function makeSetupBackupCmd(p: BackupParams): pulumi.Output<string> {
  return pulumi.interpolate`
if ! command -v rclone &>/dev/null; then
  curl https://rclone.org/install.sh | bash
fi

mkdir -p /root/.config/rclone
cat > /root/.config/rclone/rclone.conf << 'EOF'
[r2]
type = s3
provider = Cloudflare
access_key_id = ${p.r2AccessKeyId}
secret_access_key = ${p.r2SecretAccessKey}
endpoint = https://${p.r2AccountId}.r2.cloudflarestorage.com
no_check_bucket = true
EOF

cat > /usr/local/bin/pg-backup-${p.envName}.sh << 'SCRIPT'
#!/bin/bash
set -euo pipefail
TIMESTAMP=$(date +%Y-%m-%d_%H-%M-%S)
docker exec -e PGPASSWORD=${p.dbPassword} postgres-${p.envName} pg_dump -U emsa emsa_${p.envName} | gzip | \
  rclone rcat r2:${p.r2BackupBucket}/emsa_${p.envName}-$TIMESTAMP.sql.gz
SCRIPT
chmod +x /usr/local/bin/pg-backup-${p.envName}.sh

(crontab -l 2>/dev/null | grep -v "pg-backup-${p.envName}.sh"; echo "0 2 * * 0 /usr/local/bin/pg-backup-${p.envName}.sh >> /var/log/pg-backup-${p.envName}.log 2>&1") | crontab -
`;
}
