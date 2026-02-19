require("dotenv").config();
const { spawnSync, execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const env = require("../src/config/env");

if (!env.DATABASE_URL) {
  console.error("DATABASE_URL is required to run the backup.");
  process.exit(1);
}

const backupsDir = path.join(__dirname, "..", "backups");
fs.mkdirSync(backupsDir, { recursive: true });

const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
const filename = path.join(backupsDir, `backup-${timestamp}.sql`);

console.log(`Starting backup to ${filename}...`);

const pgDumpCmd = (process.env.PG_DUMP_PATH || "").trim() || "pg_dump";
const args = [env.DATABASE_URL, "--file", filename];

if (pgDumpCmd === "pg_dump") {
  const versionCheck = spawnSync("pg_dump", ["--version"], {
    shell: true,
    stdio: "ignore",
  });

  if (versionCheck.error && versionCheck.error.code === "ENOENT") {
    console.error(
      "pg_dump not found. Set PG_DUMP_PATH in .env, e.g.\n" +
        "PG_DUMP_PATH=C:\\Program Files\\PostgreSQL\\18\\bin\\pg_dump.exe"
    );
    process.exit(1);
  }

  const result = spawnSync("pg_dump", args, {
    stdio: "inherit",
    shell: true,
  });

  if (result.error) {
    console.error("pg_dump failed:", result.error.message);
    process.exit(1);
  }

  if (result.status !== 0) {
    console.error("pg_dump exited with status", result.status);
    process.exit(result.status);
  }
} else {
  try {
    execFileSync(pgDumpCmd, args, {
      stdio: "inherit",
      env: process.env,
    });
  } catch (error) {
    console.error("pg_dump failed:", error.message || error);
    process.exit(error.code || 1);
  }
}

console.log("Backup complete.");
