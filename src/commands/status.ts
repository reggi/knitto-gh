import { renderTable } from "../render/table.js";
import type { GlobalOptions } from "../types.js";
import { updatePullRequests } from "../queries/pull-requests.js";
import { latestWorkflowRun } from "../github/runs.js";
import { fleetContext } from "./context.js";

export async function status(options: GlobalOptions): Promise<void> {
  const { template, repositories } = await fleetContext(options);
  const managed = repositories.filter((repository) =>
    ["managed", "missing-workflow"].includes(repository.classification),
  );
  const states = await updatePullRequests(managed, template, options.limit);
  const workflowRuns = template.workflow
    ? await Promise.all(
        managed.map((repository) =>
          latestWorkflowRun(
            repository.nameWithOwner,
            template.workflow!.workflow,
          ),
        ),
      )
    : managed.map(() => undefined);
  const result = states.map(({ repository, pull }, index) => {
    const workflow = workflowRuns[index];
    let state = "dispatch-needed";
    if (repository.lock?.revision === template.revision) state = "current";
    else if (pull)
      state = pull.checksSuccessful
        ? pull.reviewDecision === "APPROVED"
          ? "pr-ready"
          : "pr-open"
        : "pr-blocked";
    else if (workflow?.status === "in_progress") state = "workflow-running";
    else if (workflow?.status === "queued") state = "workflow-queued";
    else if (workflow?.conclusion === "failure") state = "workflow-failed";
    return { repository, pull, workflow, state };
  });
  if (options.json) {
    console.log(JSON.stringify({ template, repositories: result }, null, 2));
    return;
  }
  process.stdout.write(
    `${renderTable(
      ["REPOSITORY", "STATE", "PR", "CHECKS", "REVIEW"],
      result.map(({ repository, pull, workflow, state }) => [
        repository.nameWithOwner,
        state,
        pull ? `#${pull.number}` : "-",
        pull
          ? pull.checksSuccessful
            ? "success"
            : "pending/failed"
          : workflow?.conclusion || workflow?.status || "-",
        pull?.reviewDecision || "-",
      ]),
    )}\n`,
  );
}
