import path from "node:path";
import os from "node:os";
import { KnittoGhError } from "../errors.js";
import { renderCommand } from "../render/commands.js";
import { updatePullRequests } from "../queries/pull-requests.js";
import type {
  CommandSpec,
  GlobalOptions,
  ManagedRepository,
  TemplateIdentity,
} from "../types.js";
import { fleetContext } from "./context.js";

export type PropagationMode = "auto" | "workflow" | "local";

export function workflowCommand(
  repository: ManagedRepository,
  template: TemplateIdentity,
): CommandSpec {
  const workflow = template.workflow?.workflow;
  if (!workflow) {
    throw new KnittoGhError(
      "Template does not declare a workflow backend",
      "CONFIG",
    );
  }
  const args = [
    "workflow",
    "run",
    workflow,
    "--repo",
    repository.nameWithOwner,
    "--ref",
    repository.defaultBranch,
  ];
  if (template.release && template.workflow?.refInput) {
    args.push("-f", `${template.workflow.refInput}=${template.release.tag}`);
  }
  return { command: "gh", args };
}

export function localCommands(
  repository: ManagedRepository,
  _template: TemplateIdentity,
  workspace: string,
  requestedRef?: string,
): CommandSpec[] {
  const checkout = path.join(workspace, ...repository.nameWithOwner.split("/"));
  return [
    {
      command: "gh",
      args: ["repo", "clone", repository.nameWithOwner, checkout],
    },
    {
      command: "npx",
      args: [
        "--yes",
        "knitto-gh@latest",
        ...(requestedRef && requestedRef !== "latest"
          ? ["--ref", requestedRef]
          : []),
        "update",
        ".",
      ],
      cwd: checkout,
    },
  ];
}

export function canUseWorkflow(
  repository: ManagedRepository,
  template: TemplateIdentity,
): boolean {
  if (repository.classification !== "managed" || !template.workflow) {
    return false;
  }
  if (!template.engine) return true;
  return (
    repository.config?.engine?.package === template.engine.package &&
    repository.config.engine.version === template.engine.version
  );
}

export async function propagate(
  options: GlobalOptions & {
    mode: PropagationMode;
    workspace?: string;
    rerun: boolean;
  },
): Promise<void> {
  const { template, repositories } = await fleetContext(options);
  const candidates = repositories.filter((repository) =>
    ["managed", "missing-workflow"].includes(repository.classification),
  );
  const pullStates = await updatePullRequests(
    candidates,
    template,
    options.limit,
  );
  const targets = pullStates
    .filter(
      ({ repository, pull }) =>
        options.rerun ||
        (repository.lock?.revision !== template.revision && !pull),
    )
    .map(({ repository }) => repository);
  const workspace =
    options.workspace ??
    path.join(
      process.env.XDG_CACHE_HOME ?? path.join(os.homedir(), ".cache"),
      "knitto-gh",
      "worktrees",
    );
  const batches = targets.map((repository) => {
    const useWorkflow =
      options.mode !== "local" && canUseWorkflow(repository, template);
    if (options.mode === "workflow" && !useWorkflow) {
      return { repository, commands: [] as CommandSpec[], skipped: true };
    }
    return {
      repository,
      commands: useWorkflow
        ? [workflowCommand(repository, template)]
        : localCommands(repository, template, workspace, options.ref),
      skipped: false,
    };
  });
  const skipped = pullStates
    .filter(({ repository }) => !targets.includes(repository))
    .map(({ repository, pull }) => ({
      repository: repository.nameWithOwner,
      reason:
        repository.lock?.revision === template.revision
          ? "already current"
          : pull
            ? `update PR already open: ${pull.url}`
            : "not selected",
    }));
  if (options.json) {
    console.log(JSON.stringify({ batches, skipped }, null, 2));
  } else {
    for (const item of skipped) {
      console.log(`# ${item.repository}: skipped (${item.reason})`);
    }
    for (const batch of batches) {
      console.log(`# ${batch.repository.nameWithOwner}`);
      if (batch.skipped) console.log("# skipped: workflow unavailable");
      for (const command of batch.commands) console.log(renderCommand(command));
      if (
        !batch.skipped &&
        batch.commands.some(
          (command) =>
            command.command === "npx" && command.args.includes("update"),
        )
      ) {
        console.log("# Review the local changes, then create a branch and pull request.");
      }
    }
  }
}
