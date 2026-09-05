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

function branchName(template: TemplateIdentity): string {
  return `automation/update-knitto-${template.revision.slice(0, 12)}`;
}

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
  template: TemplateIdentity,
  workspace: string,
): CommandSpec[] {
  const checkout = path.join(workspace, ...repository.nameWithOwner.split("/"));
  const branch = branchName(template);
  const commands: CommandSpec[] = [
    {
      command: "gh",
      args: ["repo", "clone", repository.nameWithOwner, checkout],
    },
    {
      command: "git",
      args: ["switch", "--create", branch, `origin/${repository.defaultBranch}`],
      cwd: checkout,
    },
  ];
  commands.push(
    {
      command: "npx",
      args: [
        "--yes",
        "knitto-gh@latest",
        ...(template.release ? ["--ref", template.release.tag] : []),
        "update",
        checkout,
        "--body-file",
        path.join(checkout, ".git", "knitto-gh-pr-body"),
      ],
      cwd: checkout,
    },
    { command: "git", args: ["add", "--all"], cwd: checkout },
    {
      command: "git",
      args: ["commit", "-m", "chore: update Knitto template"],
      cwd: checkout,
    },
    {
      command: "git",
      args: ["push", "--set-upstream", "origin", branch],
      cwd: checkout,
    },
    {
      command: "gh",
      args: [
        "pr",
        "create",
        "--repo",
        repository.nameWithOwner,
        "--base",
        repository.defaultBranch,
        "--head",
        branch,
        "--title",
        "chore: update Knitto template",
        "--body-file",
        path.join(checkout, ".git", "knitto-gh-pr-body"),
      ],
      cwd: checkout,
    },
  );
  return commands;
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
      options.mode !== "local" &&
      repository.classification === "managed" &&
      template.workflow;
    if (options.mode === "workflow" && !useWorkflow) {
      return { repository, commands: [] as CommandSpec[], skipped: true };
    }
    return {
      repository,
      commands: useWorkflow
        ? [workflowCommand(repository, template)]
        : localCommands(repository, template, workspace),
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
    }
  }
}
