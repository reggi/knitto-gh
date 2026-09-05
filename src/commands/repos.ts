import { renderTable } from "../render/table.js";
import type { GlobalOptions } from "../types.js";
import { fleetContext } from "./context.js";

export async function repos(options: GlobalOptions): Promise<void> {
  const { template, repositories } = await fleetContext(options);
  if (options.json) {
    console.log(JSON.stringify({ template, repositories }, null, 2));
    return;
  }
  const visible = repositories.filter((repository) =>
    ["managed", "missing-workflow", "malformed-config"].includes(
      repository.classification,
    ),
  );
  process.stdout.write(
    `${renderTable(
      ["REPOSITORY", "DEFAULT", "LOCKED REVISION", "STATE"],
      visible.map((repository) => [
        repository.nameWithOwner,
        repository.defaultBranch,
        repository.lock?.revision?.slice(0, 12) ?? "-",
        repository.classification,
      ]),
    )}\n`,
  );
}
