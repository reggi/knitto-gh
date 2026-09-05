import path from "node:path";
import {
  access,
  appendFile,
  mkdir,
  readFile,
  writeFile,
} from "node:fs/promises";
import { KnittoGhError } from "../errors.js";
import { runCommand } from "../execution/process.js";
import type { CommandResult, CommandSpec } from "../types.js";
import { parseKnittoConfig, parseKnittoLock } from "../template/config.js";
import { normalizeGitHubRepository } from "../template/normalize.js";

export interface UpdateOptions {
  project: string;
  ref?: string;
  setJson: string;
  bodyFile?: string;
  githubOutput?: string;
  json: boolean;
}

interface UpdateResult {
  template: string;
  path: string;
  ref: string;
  revision: string;
  digest: string;
  bodyFile: string;
}

type CommandExecutor = (spec: CommandSpec) => Promise<CommandResult>;

async function optionalText(file: string): Promise<string | undefined> {
  try {
    return await readFile(file, "utf8");
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return undefined;
    }
    throw error;
  }
}

function setArguments(text: string): string[] {
  let value: unknown;
  try {
    value = JSON.parse(text) as unknown;
  } catch (error) {
    throw new KnittoGhError("--set-json must be valid JSON", "USAGE", {
      cause: error,
    });
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new KnittoGhError("--set-json must contain an object", "USAGE");
  }
  const args: string[] = [];
  for (const [inputPath, inputValue] of Object.entries(value)) {
    if (
      inputValue === null ||
      !["string", "number", "boolean"].includes(typeof inputValue)
    ) {
      throw new KnittoGhError(
        `The set value for ${inputPath} must be a string, number, or boolean`,
        "USAGE",
      );
    }
    args.push("--set", `${inputPath}=${String(inputValue)}`);
  }
  return args;
}

function pullRequestBody(result: Omit<UpdateResult, "bodyFile">): string {
  return [
    "Applies the selected Knitto template release and refreshes generated package state.",
    "",
    `Knitto-Template: ${result.template}`,
    `Knitto-Path: ${result.path}`,
    `Knitto-Ref: ${result.ref}`,
    `Knitto-Revision: ${result.revision}`,
    `Knitto-Digest: ${result.digest}`,
    "",
  ].join("\n");
}

async function defaultBodyFile(
  project: string,
  execute: CommandExecutor,
): Promise<string> {
  const gitPath = await execute({
    command: "git",
    args: ["rev-parse", "--git-path", "knitto-gh-pr-body"],
    cwd: project,
  });
  return path.resolve(project, gitPath.stdout.trim());
}

export async function update(
  options: UpdateOptions,
  execute: CommandExecutor = runCommand,
): Promise<UpdateResult> {
  const project = path.resolve(options.project);
  const configFile = path.join(project, ".knitto.json");
  const packageFile = path.join(project, "package.json");
  const packageLock = path.join(project, "package-lock.json");
  const initialConfig = parseKnittoConfig(await readFile(configFile, "utf8"));

  const targetRef = options.ref ?? "latest";
  if (targetRef === "latest") {
    console.error("knitto gh: resolving latest template release");
    await execute({
      command: "npx",
      args: [
        "--yes",
        "knitto@latest",
        "source",
        "set",
        initialConfig.source.url,
        project,
        ...(initialConfig.source.path
          ? ["--template-path", initialConfig.source.path]
          : []),
      ],
      cwd: project,
    });
  } else if (initialConfig.source.ref !== targetRef) {
    console.error(`knitto gh: selecting template release ${targetRef}`);
    await execute({
      command: "npx",
      args: [
        "--yes",
        "knitto@latest",
        "source",
        "pin",
        project,
        "--ref",
        targetRef,
      ],
      cwd: project,
    });
  }

  if (
    await access(packageLock)
      .then(() => true)
      .catch(() => false)
  ) {
    console.error("knitto gh: installing repository dependencies");
    await execute({
      command: "npm",
      args: ["ci"],
      cwd: project,
    });
  }

  const packageBefore = await optionalText(packageFile);
  console.error("knitto gh: applying template update");
  await execute({
    command: "npx",
    args: [
      "--yes",
      "knitto@latest",
      "apply",
      project,
      "--update",
      ...setArguments(options.setJson),
    ],
    cwd: project,
  });
  const packageAfter = await optionalText(packageFile);
  if (packageAfter !== undefined && packageAfter !== packageBefore) {
    console.error("knitto gh: refreshing npm package lock");
    await execute({
      command: "npm",
      args: ["install", "--package-lock-only", "--ignore-scripts"],
      cwd: project,
    });
  }

  if (packageAfter !== undefined) {
    console.error("knitto gh: running repository quality checks");
    await execute({
      command: "npm",
      args: ["run", "test:quality", "--if-present"],
      cwd: project,
    });
  }

  const config = parseKnittoConfig(await readFile(configFile, "utf8"));
  const lock = parseKnittoLock(
    await readFile(path.join(project, ".knitto.lock"), "utf8"),
  );
  if (!lock.revision) {
    throw new KnittoGhError(
      "Updated .knitto.lock does not contain a Git revision",
      "CONFIG",
    );
  }
  const repository = normalizeGitHubRepository(config.source.url);
  const bodyFile =
    options.bodyFile ?? (await defaultBodyFile(project, execute));
  const result: UpdateResult = {
    template: `${repository.owner}/${repository.repository}`,
    path: config.source.path ?? ".knitto",
    ref: config.source.ref ?? "",
    revision: lock.revision,
    digest: lock.digest,
    bodyFile: path.resolve(bodyFile),
  };
  await mkdir(path.dirname(result.bodyFile), { recursive: true });
  await writeFile(result.bodyFile, pullRequestBody(result));

  if (options.githubOutput) {
    await appendFile(
      options.githubOutput,
      [
        `template=${result.template}`,
        `path=${result.path}`,
        `ref=${result.ref}`,
        `revision=${result.revision}`,
        `digest=${result.digest}`,
        `body_file=${result.bodyFile}`,
        "",
      ].join("\n"),
    );
  }

  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(
      `Prepared ${result.template}@${result.ref} (${result.revision.slice(0, 12)})`,
    );
  }
  return result;
}
