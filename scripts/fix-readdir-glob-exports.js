#!/usr/bin/env node
/**
 * readdir-glob@2.0.3+ (a transitive dependency of archiver, used by
 * src/workers/auditorPackage.ts for ZIP report generation) ships a
 * package.json "exports" map with "default" listed BEFORE "types" inside
 * each condition. Per Node's own packaging docs, "default" must always be
 * the LAST key in a conditions object — this ordering bug makes webpack's
 * resolver (as used by Next.js's dev/build compiler) reject the whole
 * module with "Module not found: Default condition should be last one",
 * which breaks every page in the app since report.ts (which imports
 * auditorPackage.ts) is bundled into the shared server router graph.
 *
 * Neither downgrading (2.0.0-2.0.2 have the same bug in a different form —
 * actually correct ordering, but npm's "overrides" field reproducibly
 * failed to apply the downgrade in this environment) nor patch-package
 * (hit an unrelated internal bug resolving nested dependency paths) worked
 * reliably, so this postinstall script just corrects the ordering directly
 * in the installed package on disk — cheap, deterministic, and easy to
 * delete once upstream ships a fix.
 *
 * Safe to remove once https://github.com/Yqnn/node-readdir-glob ships a
 * corrected exports map (check `npm view readdir-glob@latest exports`).
 */

const fs = require("fs");
const path = require("path");

const candidatePaths = [
  path.join(__dirname, "..", "node_modules", "archiver", "node_modules", "readdir-glob", "package.json"),
  path.join(__dirname, "..", "node_modules", "readdir-glob", "package.json"),
];

function fixExportsOrder(exportsField) {
  let changed = false;
  for (const condition of ["import", "require"]) {
    const entry = exportsField?.[condition];
    if (entry && typeof entry === "object" && "default" in entry && "types" in entry) {
      const keys = Object.keys(entry);
      if (keys.indexOf("default") < keys.indexOf("types")) {
        exportsField[condition] = { types: entry.types, default: entry.default };
        changed = true;
      }
    }
  }
  return changed;
}

for (const pkgJsonPath of candidatePaths) {
  if (!fs.existsSync(pkgJsonPath)) continue;

  const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, "utf-8"));
  if (fixExportsOrder(pkg.exports)) {
    fs.writeFileSync(pkgJsonPath, JSON.stringify(pkg, null, 2) + "\n");
    console.log(`[fix-readdir-glob-exports] Fixed exports ordering in ${pkgJsonPath}`);
  }
}
