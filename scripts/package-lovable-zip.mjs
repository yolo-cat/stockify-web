import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const MAX_ZIP_BYTES = 250 * 1024 * 1024;
const ROOT_DIR = process.cwd();
const OUTPUT_REL = "dist/stockify-web-lovable.zip";
const OUTPUT_PATH = path.join(ROOT_DIR, OUTPUT_REL);

const REQUIRED_PATHS = [
  "package.json",
  "vite.config.ts",
  "index.html",
  "src",
  "src/App.tsx",
  "supabase",
  "supabase/config.toml",
  "supabase/migrations/0001_initial_schema.sql",
];

const EXCLUDED_DIR_NAMES = new Set([
  "node_modules",
  "dist",
  ".git",
  ".agents",
  "coverage",
  ".vite",
]);

const EXCLUDED_FILE_NAMES = new Set([".DS_Store", "Thumbs.db", ".git"]);

function isExcludedEnvFile(name) {
  return /^\.env($|\.)/i.test(name);
}

function isExcludedFile(name) {
  if (EXCLUDED_FILE_NAMES.has(name)) {
    return true;
  }
  if (isExcludedEnvFile(name)) {
    return true;
  }
  if (name.endsWith(".log") || name.endsWith(".tsbuildinfo")) {
    return true;
  }
  return false;
}

function assertRequiredPathsExist() {
  const missing = REQUIRED_PATHS.filter(
    (relPath) => !fs.existsSync(path.join(ROOT_DIR, relPath)),
  );
  if (missing.length > 0) {
    throw new Error(
      `Missing required Lovable project files/directories: ${missing.join(", ")}`,
    );
  }
}

function collectFiles(currentDir, relPrefix, files) {
  const entries = fs.readdirSync(currentDir, { withFileTypes: true });
  entries.sort((a, b) => a.name.localeCompare(b.name));

  for (const entry of entries) {
    const relPath = relPrefix ? `${relPrefix}/${entry.name}` : entry.name;
    const fullPath = path.join(currentDir, entry.name);

    if (entry.isDirectory()) {
      if (EXCLUDED_DIR_NAMES.has(entry.name)) {
        continue;
      }
      collectFiles(fullPath, relPath, files);
    } else if (entry.isFile()) {
      if (isExcludedFile(entry.name)) {
        continue;
      }
      files.push(relPath);
    }
  }
}

function auditZipArchive(zipPath) {
  const rawList = execFileSync("unzip", ["-Z1", zipPath], {
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
  });
  const zipEntries = rawList
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const forbiddenMatches = zipEntries.filter((entry) => {
    const parts = entry.split("/");
    const fileName = parts[parts.length - 1] ?? "";
    return (
      parts.some((part) => EXCLUDED_DIR_NAMES.has(part)) ||
      isExcludedFile(fileName)
    );
  });

  if (forbiddenMatches.length > 0) {
    throw new Error(
      `ZIP audit failed: found forbidden entries: ${forbiddenMatches.slice(0, 10).join(", ")}`,
    );
  }

  for (const req of REQUIRED_PATHS) {
    const hasMatch = zipEntries.some(
      (entry) => entry === req || entry.startsWith(`${req}/`),
    );
    if (!hasMatch) {
      throw new Error(`ZIP audit failed: missing required entry "${req}"`);
    }
  }

  return zipEntries.length;
}

function main() {
  assertRequiredPathsExist();

  const files = [];
  collectFiles(ROOT_DIR, "", files);

  if (files.length === 0) {
    throw new Error("No files collected for Lovable ZIP package.");
  }

  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  if (fs.existsSync(OUTPUT_PATH)) {
    fs.unlinkSync(OUTPUT_PATH);
  }

  execFileSync("zip", ["-q", "-@", OUTPUT_PATH], {
    cwd: ROOT_DIR,
    input: `${files.join("\n")}\n`,
    stdio: ["pipe", "inherit", "inherit"],
  });

  const stats = fs.statSync(OUTPUT_PATH);
  if (stats.size > MAX_ZIP_BYTES) {
    fs.unlinkSync(OUTPUT_PATH);
    throw new Error(
      `Lovable ZIP exceeds 250 MB limit (${(stats.size / (1024 * 1024)).toFixed(2)} MB).`,
    );
  }

  const archivedCount = auditZipArchive(OUTPUT_PATH);
  const sizeMb = (stats.size / (1024 * 1024)).toFixed(2);
  console.log(
    `[zip:lovable] Created ${OUTPUT_REL} (${archivedCount} entries, ${sizeMb} MB <= 250 MB limit).`,
  );
}

main();
