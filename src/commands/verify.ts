import { KnittoGhError } from "../errors.js";
import { renderTable } from "../render/table.js";
import { updatePullRequests } from "../queries/pull-requests.js";
import type { GlobalOptions } from "../types.js";
import { fleetContext } from "./context.js";

export async function verify(options: GlobalOptions): Promise<void> {
  const { template, repositories } = await fleetContext(options);
  const managed = repositories.filter((repository) =>
    ["managed", "missing-workflow"].includes(repository.classification),
  );
  const pullStates = await updatePullRequests(managed, template, options.limit);
  const results = pullStates.map(({ repository, pull }) => ({
      repository: repository.nameWithOwner,
      revision: repository.lock?.revision,
      digest: repository.lock?.digest,
      result: pull
        ? "pr-open"
        : repository.lock?.revision === template.revision
          ? "current"
          : repository.lock
            ? "outdated"
            : "unlocked",
    }));
  if (options.json) console.log(JSON.stringify({ template, results }, null, 2));
  else
    process.stdout.write(
      `${renderTable(
        ["REPOSITORY", "REVISION", "DIGEST", "RESULT"],
        results.map((result) => [
          result.repository,
          result.revision?.slice(0, 12) ?? "-",
          result.digest?.slice(0, 19) ?? "-",
          result.result,
        ]),
      )}\n`,
    );
  if (results.some((result) => result.result !== "current")) {
    throw new KnittoGhError(
      "One or more managed repositories are not current",
      "VERIFY",
    );
  }
}
