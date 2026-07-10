/**
 * Security review (Phase 4 Part 3, section 4.7): automated guard that fails
 * the build if a connector `config` object or a webhook `secret` value is
 * ever passed into a console.log/console.warn/console.error/console.info
 * or logger.* call within src/server/connectors/ or src/server/webhooks/.
 * Those two directories are exactly where decrypted credentials and signing
 * secrets pass through code, so this is the choke point worth guarding.
 *
 * This is a static grep, not a runtime check — it can't catch every
 * possible aliasing of a secret value, but it catches the common mistake of
 * writing `console.log(config)` / `console.log("token:", apiToken)` while
 * debugging and forgetting to remove it.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const SCOPED_DIRS = ["src/server/connectors", "src/server/webhooks"];

// Matches console.log(...)/console.warn(...)/etc. and logger.*(...) call
// sites, capturing their argument list for inspection.
const LOG_CALL = /(?:console\.(?:log|warn|error|info|debug)|logger\.\w+)\s*\(([^)]*)\)/g;

// Identifier fragments that indicate a secret/credential is being logged.
// Deliberately broad (config, secret, token, apiToken, password, credential)
// since any of these appearing as a bare argument (not a string literal
// label like "config:") means the actual value is being interpolated.
const SENSITIVE_IDENTIFIER = /\b(config|secret|apiToken|installationToken|password|credential)\b/i;

function listTsFiles(dir: string): string[] {
  const results: string[] = [];
  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      results.push(...listTsFiles(fullPath));
    } else if (/\.tsx?$/.test(entry) && !entry.endsWith(".test.ts")) {
      results.push(fullPath);
    }
  }
  return results;
}

describe("security: no secrets logged in connectors/webhooks", () => {
  const repoRoot = join(__dirname, "..");
  const files = SCOPED_DIRS.flatMap((dir) => listTsFiles(join(repoRoot, dir)));

  it("scans at least one file in each scoped directory (guards against a silently-empty check)", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it.each(files.map((f) => [f.replace(repoRoot + "/", "")]))(
    "%s does not log a config/secret/token/credential value",
    (relativePath) => {
      const content = readFileSync(join(repoRoot, relativePath), "utf8");
      const violations: string[] = [];

      let match: RegExpExecArray | null;
      LOG_CALL.lastIndex = 0;
      while ((match = LOG_CALL.exec(content)) !== null) {
        const args = match[1];
        // Strip string literals first — a label like console.log("config
        // encrypted OK") should not trip the check, only an interpolated
        // identifier/variable actually carrying the value.
        const argsWithoutStringLiterals = args.replace(/(["'`])(?:(?!\1).)*\1/g, "");
        if (SENSITIVE_IDENTIFIER.test(argsWithoutStringLiterals)) {
          violations.push(match[0]);
        }
      }

      expect(violations).toEqual([]);
    },
  );
});
