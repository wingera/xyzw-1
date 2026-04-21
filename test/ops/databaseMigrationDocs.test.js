import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const authoritativeDocPath = path.join(
  repoRoot,
  "docs",
  "database-postgresql-migration.md",
);
const draftDocPath = path.join(
  repoRoot,
  "backend",
  "src",
  "docs",
  "DATABASE_MIGRATION_PLAN_DRAFT.md",
);
const startupDocPath = path.join(repoRoot, "docs", "startup.md");

test("authoritative PostgreSQL migration design exists and covers required sections", () => {
  assert.equal(fs.existsSync(authoritativeDocPath), true);
  const content = fs.readFileSync(authoritativeDocPath, "utf8");

  assert.match(content, /schema mapping/i);
  assert.match(content, /migration path/i);
  assert.match(content, /backup\/restore/i);
  assert.match(content, /rollback/i);
  assert.match(content, /concurrency\/transaction strategy/i);
});

test("legacy draft no longer describes the current engine as sql.js and points to the new design", () => {
  const content = fs.readFileSync(draftDocPath, "utf8");

  assert.doesNotMatch(content, /current runtime db engine:\s*`?sql\.js`?/i);
  assert.match(content, /docs\/database-postgresql-migration\.md/);
  assert.match(content, /better-sqlite3|SQLite/i);
});

test("startup documentation describes owner-only sqlite runtime paths and references the migration design", () => {
  const content = fs.readFileSync(startupDocPath, "utf8");

  assert.match(content, /owner-only|chmod 700|chmod 600/i);
  assert.match(content, /database-postgresql-migration\.md/);
});
