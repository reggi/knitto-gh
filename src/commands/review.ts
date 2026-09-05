import { updatePullRequests } from "../queries/pull-requests.js";
import { renderCommand } from "../render/commands.js";
import type {
  CommandSpec,
  GlobalOptions,
} from "../types.js";
import { fleetContext } from "./context.js";

export async function review(
  options: GlobalOptions,
): Promise<void> {
  const { template, repositories } = await fleetContext(options);
  const managed = repositories.filter((repository) =>
    ["managed", "missing-workflow"].includes(repository.classification),
  );
  const pulls = await updatePullRequests(managed, template, options.limit);
  const eligible = pulls.filter(
    ({ pull, repository }) =>
      pull &&
      pull.baseRefName === repository.defaultBranch &&
      !pull.isDraft &&
      pull.checksSuccessful &&
      pull.mergeable !== "CONFLICTING" &&
      pull.reviewDecision !== "APPROVED",
  );
  const commands = eligible.map(
    ({ repository, pull }): CommandSpec => ({
      command: "gh",
      args: [
        "pr",
        "review",
        String(pull?.number),
        "--repo",
        repository.nameWithOwner,
        "--approve",
      ],
    }),
  );
  if (options.json) console.log(JSON.stringify({ eligible, commands }, null, 2));
  else commands.forEach((command) => console.log(renderCommand(command)));
}
