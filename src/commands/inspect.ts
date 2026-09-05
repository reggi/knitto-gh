import { renderTable } from "../render/table.js";
import type { GlobalOptions } from "../types.js";
import { templateContext } from "./context.js";

export async function inspect(options: GlobalOptions): Promise<void> {
  const template = await templateContext(options);
  const result = {
    repository: `${template.owner}/${template.repository}`,
    path: template.path,
    ref: template.ref,
    revision: template.revision,
    release: template.release,
    engine: template.engine,
    workflow: template.workflow,
    checkoutRoot: template.checkoutRoot,
  };
  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  process.stdout.write(
    `${renderTable(
      ["FIELD", "VALUE"],
      [
        ["Template", result.repository],
        ["Path", result.path],
        ["Ref", result.ref],
        ["Revision", result.revision],
        ["Engine", result.engine ? `${result.engine.package}@${result.engine.version}` : "-"],
        ["Workflow", result.workflow?.workflow ?? "local only"],
      ],
    )}\n`,
  );
}
