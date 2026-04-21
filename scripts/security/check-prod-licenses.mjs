import fs from "fs";
import path from "path";
import { spawnSync } from "child_process";

const rootDir = process.cwd();
const allowPath = path.join(rootDir, "scripts/security/allowed-licenses.json");
const exceptionPath = path.join(rootDir, "scripts/security/license-exceptions.json");

if (!fs.existsSync(allowPath)) {
  console.error(`[security:licenses] missing allowlist file: ${allowPath}`);
  process.exit(1);
}

const allowedLicenses = new Set(JSON.parse(fs.readFileSync(allowPath, "utf8")));
const licenseExceptions = new Map();

if (fs.existsSync(exceptionPath)) {
  const rawExceptions = JSON.parse(fs.readFileSync(exceptionPath, "utf8"));
  if (!Array.isArray(rawExceptions)) {
    console.error(`[security:licenses] exceptions file must be an array: ${exceptionPath}`);
    process.exit(1);
  }
  for (const exception of rawExceptions) {
    const dependency = String(exception?.dependency || "").trim();
    const version = String(exception?.version || "").trim();
    const license = String(exception?.license || "").trim();
    const reason = String(exception?.reason || "").trim();
    if (!dependency || !version || !license || !reason) {
      console.error("[security:licenses] exception entries require dependency, version, license, and reason");
      process.exit(1);
    }
    licenseExceptions.set(`${dependency}@${version}|${license}`, reason);
  }
}

const runNpmLs = (cwd) => {
  const commandResult = spawnSync(
    "npm",
    ["ls", "--omit=dev", "--json", "--long"],
    { cwd, encoding: "utf8" },
  );

  if (commandResult.status !== 0) {
    console.error(`[security:licenses] npm ls failed in ${cwd}`);
    process.stderr.write(commandResult.stderr || "");
    process.exit(commandResult.status || 1);
  }

  try {
    return JSON.parse(commandResult.stdout);
  } catch (error) {
    console.error(`[security:licenses] failed to parse npm ls output in ${cwd}: ${error.message}`);
    process.exit(1);
  }
};

const splitLicenseExpression = (license) => {
  const normalized = String(license || "")
    .replace(/[()]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!normalized) return [];

  return normalized
    .split(/\s+(?:OR|AND|\/|\|)\s+/i)
    .map((item) => item.trim())
    .filter(Boolean);
};

const checkTree = (tree, scopeName) => {
  const violations = [];
  const visited = new Set();

  const walk = (depName, node) => {
    if (!node || typeof node !== "object") return;

    const version = String(node.version || "unknown");
    const key = `${depName}@${version}`;
    if (visited.has(key)) return;
    visited.add(key);

    const rawLicense = String(node.license || "").trim();
    const parts = splitLicenseExpression(rawLicense);

    if (!rawLicense || parts.length === 0) {
      violations.push({
        dependency: key,
        license: rawLicense || "<missing>",
        reason: "license metadata missing or unparsable",
      });
    } else {
      const disallowed = parts.filter((item) => !allowedLicenses.has(item));
      const exceptionReason = licenseExceptions.get(`${key}|${rawLicense}`);
      if (disallowed.length > 0 && !exceptionReason) {
        violations.push({
          dependency: key,
          license: rawLicense,
          reason: `contains non-allowlisted license terms: ${disallowed.join(", ")}`,
        });
      }
    }

    const nextDeps = node.dependencies || {};
    for (const [childName, childNode] of Object.entries(nextDeps)) {
      walk(childName, childNode);
    }
  };

  const deps = tree.dependencies || {};
  for (const [depName, node] of Object.entries(deps)) {
    walk(depName, node);
  }

  return {
    scopeName,
    dependencyCount: visited.size,
    violations,
  };
};

const rootTree = runNpmLs(rootDir);
const backendTree = runNpmLs(path.join(rootDir, "backend"));

const reports = [
  checkTree(rootTree, "frontend+workspace root"),
  checkTree(backendTree, "backend"),
];

let hasViolation = false;
for (const report of reports) {
  console.log(`[security:licenses] ${report.scopeName}: checked ${report.dependencyCount} production dependencies`);
  if (report.violations.length > 0) {
    hasViolation = true;
    for (const violation of report.violations) {
      console.error(`- ${violation.dependency} | ${violation.license} | ${violation.reason}`);
    }
  }
}

if (hasViolation) {
  console.error("[security:licenses] license policy check failed");
  process.exit(1);
}

console.log("[security:licenses] license policy check passed");
