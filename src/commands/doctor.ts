import { runCommand } from "../execution/process.js";
import { assertGhAuth } from "../github/gh.js";
import { renderTable } from "../render/table.js";
import type { GlobalOptions } from "../types.js";
import { identifyTemplate } from "../template/identify.js";

export async function doctor(options: GlobalOptions): Promise<void> {
  const checks: Array<[string, string]> = [];
  for (const command of ["git", "gh"]) {
    const result = await runCommand(
      { command, args: ["--version"] },
      { allowFailure: true },
    );
    checks.push([command, result.exitCode === 0 ? "ok" : "missing"]);
  }
  await assertGhAuth();
  checks.push(["gh authentication", "ok"]);
  const template = await identifyTemplate(options);
  checks.push([
    "template",
    `${template.owner}/${template.repository}:${template.path}@${template.ref}`,
  ]);
  process.stdout.write(`${renderTable(["CHECK", "RESULT"], checks)}\n`);
}
