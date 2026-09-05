#!/usr/bin/env node

import { Command, InvalidArgumentError } from "commander";
import { doctor } from "./commands/doctor.js";
import { inspect } from "./commands/inspect.js";
import { merge, type MergeStrategy } from "./commands/merge.js";
import { propagate, type PropagationMode } from "./commands/propagate.js";
import { repos } from "./commands/repos.js";
import { review } from "./commands/review.js";
import { status } from "./commands/status.js";
import { verify } from "./commands/verify.js";
import { update } from "./commands/update.js";
import { exitCodeFor, KnittoGhError } from "./errors.js";
import type { GlobalOptions } from "./types.js";
import { KNITTO_GH_VERSION } from "./version.js";

function collect(value: string, previous: string[]): string[] {
  return [...previous, value];
}

function positiveInteger(value: string): number {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1) {
    throw new InvalidArgumentError("must be a positive integer");
  }
  return number;
}

function nonNegativeInteger(value: string): number {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) {
    throw new InvalidArgumentError("must be a non-negative integer");
  }
  return number;
}

function globalOptions(command: Command): GlobalOptions {
  const options = command.optsWithGlobals<{
    template?: string;
    templatePath: string;
    ref?: string;
    owner: string[];
    query?: string;
    include: string[];
    exclude: string[];
    limit: number;
    json: boolean;
    verbose: boolean;
    cache: boolean;
    refresh: boolean;
    cacheTtl: number;
  }>();
  return {
    ...(options.template ? { template: options.template } : {}),
    templatePath: options.templatePath,
    ...(options.ref ? { ref: options.ref } : {}),
    owners: options.owner,
    ...(options.query ? { query: options.query } : {}),
    include: options.include,
    exclude: options.exclude,
    limit: options.limit,
    json: options.json,
    verbose: options.verbose,
    cache: options.cache,
    refresh: options.refresh,
    cacheTtl: options.cacheTtl,
  };
}

const program = new Command()
  .name("knitto gh")
  .description("GitHub fleet orchestration for Knitto templates")
  .version(KNITTO_GH_VERSION)
  .option("--template <repository>", "template OWNER/REPO or GitHub URL")
  .option("--template-path <path>", "path within the template repository", ".knitto")
  .option(
    "--ref <ref>",
    "template ref; defaults to latest and resolves to an immutable release",
  )
  .option("--owner <owner>", "candidate owner; repeatable", collect, [])
  .option("--query <query>", "explicit GitHub repository search query")
  .option("--include <glob>", "include repository glob; repeatable", collect, [])
  .option("--exclude <glob>", "exclude repository glob; repeatable", collect, [])
  .option("--limit <number>", "maximum concurrent GitHub operations", positiveInteger, 4)
  .option("--json", "emit machine-readable JSON", false)
  .option("--verbose", "show additional diagnostics", false)
  .option("--no-cache", "disable persistent repository discovery caching")
  .option("--refresh", "bypass and replace cached repository discovery", false)
  .option(
    "--cache-ttl <seconds>",
    "repository discovery cache lifetime",
    nonNegativeInteger,
    3600,
  );

program
  .command("doctor")
  .description("validate local and GitHub prerequisites")
  .action(async (_options, command) => doctor(globalOptions(command)));

program
  .command("inspect")
  .description("show the selected template identity and integration contract")
  .action(async (_options, command) => inspect(globalOptions(command)));

program
  .command("repos")
  .description("discover repositories consuming the selected template")
  .action(async (_options, command) => repos(globalOptions(command)));

program
  .command("update")
  .description("update the current checkout and generate Knitto PR metadata")
  .argument("[project]", "repository checkout", ".")
  .option("--set-json <json>", "Knitto input values as a JSON object", "{}")
  .option("--body-file <path>", "write the generated pull request body here")
  .option("--github-output <path>", "append provenance to a GitHub output file")
  .action(
    async (
      project: string,
      options: {
        setJson: string;
        bodyFile?: string;
        githubOutput?: string;
      },
      command,
    ) => {
      const globals = globalOptions(command);
      await update({
        project,
        setJson: options.setJson,
        json: globals.json,
        ...(globals.ref ? { ref: globals.ref } : {}),
        ...(options.bodyFile ? { bodyFile: options.bodyFile } : {}),
        ...(options.githubOutput
          ? { githubOutput: options.githubOutput }
          : {}),
      });
    },
  );

program
  .command("propagate")
  .description("print fleet template update commands")
  .option("--mode <mode>", "auto, workflow, or local", "auto")
  .option("--workspace <path>", "local worker checkout directory")
  .option("--rerun", "print commands even when current or an update PR exists", false)
  .action(async (options: { mode: string; workspace?: string; rerun: boolean }, command) => {
  if (!["auto", "workflow", "local"].includes(options.mode)) {
    throw new KnittoGhError(`Invalid propagation mode: ${options.mode}`, "USAGE");
  }
  await propagate({
    ...globalOptions(command),
    mode: options.mode as PropagationMode,
    rerun: options.rerun,
    ...(options.workspace ? { workspace: options.workspace } : {}),
    });
});

program
  .command("status")
  .description("reconstruct fleet update state from GitHub")
  .action(async (_options, command) => status(globalOptions(command)));

program
  .command("review")
  .description("print eligible approval commands")
  .action(async (_options, command) => review(globalOptions(command)));

program
  .command("merge")
  .description("print eligible merge commands")
  .option("--strategy <strategy>", "merge, squash, or rebase", "squash")
  .action(async (options: { strategy: string }, command) => {
  if (!["merge", "squash", "rebase"].includes(options.strategy)) {
    throw new KnittoGhError(
      `Invalid merge strategy: ${options.strategy}`,
      "USAGE",
    );
  }
  await merge({
    ...globalOptions(command),
    strategy: options.strategy as MergeStrategy,
  });
  });

program
  .command("verify")
  .description("verify lock convergence at the selected template revision")
  .action(async (_options, command) => verify(globalOptions(command)));

program.parseAsync().catch((error: unknown) => {
  console.error(`knitto gh: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = exitCodeFor(error);
});
