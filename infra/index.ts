import * as command from "@pulumi/command";
import * as hcloud from "@pulumi/hcloud";
import * as pulumi from "@pulumi/pulumi";
import * as crypto from "crypto";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import {
  installDockerCmd,
  makeDeployCmd,
  makeEnvFileCmd,
  makeMigrateCmd,
  makeSetupBackupCmd,
} from "./scripts";

const config = new pulumi.Config();
const deployType = config.require("deployType");
const sshKeyName = config.require("sshKeyName");
const sshKeyPath = path.join(os.homedir(), ".ssh", sshKeyName);

let privateKeyRaw: string;
try {
  privateKeyRaw = fs.readFileSync(sshKeyPath, "utf-8");
} catch {
  throw new Error(`SSH private key not found at ${sshKeyPath}. Set sshKeyName in stack config.`);
}
const privateKey = pulumi.secret(privateKeyRaw);

export let serverIp: pulumi.Output<string> | undefined;

// ==========================================
// MODE 1: INFRASTRUCTURE (Traefik on existing server)
// ==========================================
if (deployType === "infra") {
  const server = new hcloud.Server(
    "emsa-server",
    {
      image: config.require("serverImage"),
      location: config.require("serverLocation"),
      name: config.require("serverName"),
      serverType: config.require("serverType"),
      sshKeys: [sshKeyName],
    },
    {
      protect: true,
      ignoreChanges: ["sshKeys", "allowDeprecatedImages", "ignoreRemoteFirewallIds"],
    }
  );

  new hcloud.Firewall(
    "emsa-firewall",
    {
      name: "emsa-firewall",
      rules: [
        { direction: "in", protocol: "tcp", port: "22", sourceIps: ["0.0.0.0/0", "::/0"] },
        { direction: "in", protocol: "tcp", port: "80", sourceIps: ["0.0.0.0/0", "::/0"] },
        { direction: "in", protocol: "tcp", port: "443", sourceIps: ["0.0.0.0/0", "::/0"] },
        { direction: "in", protocol: "icmp", sourceIps: ["0.0.0.0/0", "::/0"] },
      ],
      applyTos: [{ server: server.id.apply((id) => parseInt(id, 10)) }],
    },
    { dependsOn: [server] }
  );

  const connection = { host: server.ipv4Address, user: "root", privateKey };

  const installDocker = new command.remote.Command("install-docker", {
    connection,
    create: installDockerCmd,
  });

  const setupTraefik = new command.remote.Command(
    "setup-traefik",
    {
      connection,
      create: "mkdir -p /root/traefik",
    },
    { dependsOn: [installDocker] }
  );

  const traefikComposeHash = crypto
    .createHash("sha256")
    .update(fs.readFileSync(path.join(__dirname, "docker/traefik/docker-compose.yml")))
    .digest("hex")
    .substring(0, 8);

  const copyTraefikCompose = new command.remote.CopyToRemote(
    "copy-traefik-compose",
    {
      connection,
      source: new pulumi.asset.FileAsset(path.join(__dirname, "docker/traefik/docker-compose.yml")),
      remotePath: "/root/traefik/docker-compose.yml",
      triggers: [traefikComposeHash],
    },
    { dependsOn: [setupTraefik] }
  );

  new command.remote.Command(
    "start-traefik",
    {
      connection,
      create: "cd /root/traefik && docker compose up -d",
      update: "cd /root/traefik && docker compose pull && docker compose up -d",
      triggers: [traefikComposeHash],
    },
    { dependsOn: [copyTraefikCompose] }
  );

  serverIp = server.ipv4Address;
}

// ==========================================
// MODE 2: APPLICATION (per environment)
// ==========================================
if (deployType === "app") {
  const envName = pulumi.getStack();
  const dbHostPort = config.require("dbHostPort");
  const domain = config.require("domain");
  const dbPassword = config.requireSecret("dbPassword");
  const jwtSecret = config.requireSecret("jwtSecret");
  const googleClientId = config.requireSecret("googleClientId");
  const googleClientSecret = config.requireSecret("googleClientSecret");
  const r2AccessKeyId = config.requireSecret("r2AccessKeyId");
  const r2SecretAccessKey = config.requireSecret("r2SecretAccessKey");
  const r2AccountId = config.requireSecret("r2AccountId");
  const r2Bucket = config.require("r2Bucket");
  const r2PublicUrl = config.require("r2PublicUrl");
  const resendApiKey = config.requireSecret("resendApiKey");
  const fromEmail = config.get("fromEmail") ?? `noreply@${domain}`;
  const appEnv = config.require("appEnv");
  const appTimeZone = config.get("appTimeZone") ?? "Europe/Skopje";

  const pulumiOrg = config.require("pulumiOrg");
  const infraStack = new pulumi.StackReference(`${pulumiOrg}/emsa/infra`);
  const infraServerIp = infraStack.getOutput("serverIp") as pulumi.Output<string>;

  const appHash = getContentHash(path.join(__dirname, ".."), [
    "src",
    "drizzle",
    "package.json",
    "bun.lock",
    "build.ts",
    "Dockerfile",
    "tsconfig.json",
    "drizzle.config.ts",
  ]);

  const composeHash = crypto
    .createHash("sha256")
    .update(fs.readFileSync(path.join(__dirname, "docker/app/docker-compose.yml")))
    .digest("hex")
    .substring(0, 8);

  const appDir = `/root/apps/${envName}`;
  const connection = { host: infraServerIp, user: "root", privateKey };

  const mkDir = new command.remote.Command(`mkdir-${envName}`, {
    connection,
    create: `mkdir -p ${appDir}`,
  });

  // --delete-after removes files only after a successful transfer, so the
  // destination is never left empty if rsync fails partway through.
  const syncCode = new command.local.Command(
    `sync-code-${envName}`,
    {
      create: pulumi.interpolate`rsync -az --delete-after \
        --exclude=node_modules \
        --exclude=dist \
        --exclude=.git \
        --exclude=.claude \
        --exclude=.vscode \
        --exclude=.env \
        --exclude=infra \
        -e "ssh -o StrictHostKeyChecking=no -i ${sshKeyPath}" \
        ${path.join(__dirname, "../")} root@${infraServerIp}:${appDir}/`,
      triggers: [appHash],
    },
    { dependsOn: [mkDir] }
  );

  // copyCompose and writeEnv must run AFTER syncCode — rsync --delete-after
  // would otherwise remove files placed on the server before the sync runs.
  const copyCompose = new command.remote.CopyToRemote(
    `copy-compose-${envName}`,
    {
      connection,
      source: new pulumi.asset.FileAsset(path.join(__dirname, "docker/app/docker-compose.yml")),
      remotePath: `${appDir}/docker-compose.yml`,
      triggers: [appHash, composeHash],
    },
    { dependsOn: [syncCode] }
  );

  const envFileCmd = makeEnvFileCmd({
    appDir,
    envName,
    appEnv,
    domain,
    dbHostPort,
    dbPassword,
    jwtSecret,
    googleClientId,
    googleClientSecret,
    r2AccessKeyId,
    r2SecretAccessKey,
    r2AccountId,
    r2Bucket,
    r2PublicUrl,
    resendApiKey,
    fromEmail,
    appTimeZone,
  });

  const writeEnv = new command.remote.Command(
    `write-env-${envName}`,
    {
      connection,
      create: envFileCmd,
      update: envFileCmd,
      triggers: [appHash],
    },
    { dependsOn: [syncCode] }
  );

  serverIp = infraServerIp;

  // Triggers cause replacement, so `update` rarely fires — both branches
  // use the same command and rely on Docker's layer cache for incremental builds.
  const deployCmd = makeDeployCmd(appDir, envName, domain);
  const deploy = new command.remote.Command(
    `deploy-${envName}`,
    {
      connection,
      create: deployCmd,
      update: deployCmd,
      triggers: [appHash, composeHash],
    },
    { dependsOn: [syncCode, copyCompose, writeEnv] }
  );

  new command.remote.Command(
    `migrate-${envName}`,
    {
      connection,
      create: makeMigrateCmd(envName),
      triggers: [appHash],
    },
    { dependsOn: [deploy] }
  );

  if (config.getBoolean("enableBackup")) {
    const r2BackupBucket = config.require("r2BackupBucket");
    const setupBackupCmd = makeSetupBackupCmd({
      envName,
      r2AccessKeyId,
      r2SecretAccessKey,
      r2AccountId,
      r2BackupBucket,
      dbPassword,
    });

    new command.remote.Command(
      `setup-backup-${envName}`,
      {
        connection,
        create: setupBackupCmd,
        update: setupBackupCmd,
      },
      { dependsOn: [deploy] }
    );
  }
}

function getContentHash(root: string, relPaths: string[]): string {
  const hash = crypto.createHash("sha256");
  const ignoreList = ["node_modules", ".git", "dist", "infra"];

  const walk = (currentPath: string) => {
    const rel = path.relative(root, currentPath);
    if (ignoreList.some((ig) => rel.split(path.sep).includes(ig))) return;

    const stats = fs.statSync(currentPath);
    if (stats.isDirectory()) {
      for (const file of fs.readdirSync(currentPath).sort()) {
        walk(path.join(currentPath, file));
      }
    } else {
      hash.update(rel);
      hash.update(fs.readFileSync(currentPath));
    }
  };

  for (const relPath of relPaths) {
    const full = path.join(root, relPath);
    if (fs.existsSync(full)) walk(full);
  }

  return hash.digest("hex").substring(0, 8);
}
