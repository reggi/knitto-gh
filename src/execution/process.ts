import { spawn } from "node:child_process";
import { KnittoGhError } from "../errors.js";
import type { CommandResult, CommandSpec } from "../types.js";

function assertReadOnlyGh(args: string[]): void {
  const [command, subcommand] = args;
  const allowed =
    (command === "--version" && args.length === 1) ||
    (command === "auth" && subcommand === "status") ||
    (command === "repo" && subcommand === "view") ||
    (command === "pr" && ["list", "view", "status"].includes(subcommand ?? "")) ||
    (command === "run" && ["list", "view"].includes(subcommand ?? "")) ||
    (command === "workflow" && ["list", "view"].includes(subcommand ?? ""));
  if (allowed) return;
  if (command === "api") {
    const methodIndex = args.findIndex(
      (argument) => argument === "--method" || argument === "-X",
    );
    const method =
      methodIndex === -1 ? "GET" : (args[methodIndex + 1] ?? "").toUpperCase();
    const graphql = subcommand === "graphql";
    const hasFields = args.some(
      (argument) => argument === "-f" || argument === "-F",
    );
    if (!graphql && methodIndex === -1 && hasFields) {
      throw new KnittoGhError(
        "Refusing ambiguous gh api fields without an explicit GET method",
        "EXECUTION",
      );
    }
    if (method !== "GET") {
      throw new KnittoGhError(
        `Refusing mutating gh api method: ${method}`,
        "EXECUTION",
      );
    }
    const query = args
      .filter((argument) => argument.startsWith("query="))
      .map((argument) => argument.slice("query=".length))
      .join("\n");
    if (graphql && /\bmutation\b/i.test(query)) {
      throw new KnittoGhError(
        "Refusing GraphQL mutation through gh",
        "EXECUTION",
      );
    }
    return;
  }
  throw new KnittoGhError(
    `Refusing non-read-only gh command: ${args.join(" ")}`,
    "EXECUTION",
  );
}

export async function runCommand(
  spec: CommandSpec,
  options: { allowFailure?: boolean; stdin?: string } = {},
): Promise<CommandResult> {
  if (spec.command === "gh") assertReadOnlyGh(spec.args);
  const command =
    spec.command === "gh" && process.env.KNITTO_GH_BIN
      ? process.env.KNITTO_GH_BIN
      : spec.command;
  if (
    spec.command === "gh" &&
    process.env.KNITTO_TEST_MODE === "1" &&
    !process.env.KNITTO_GH_BIN
  ) {
    throw new KnittoGhError(
      "Tests must inject a fake GitHub CLI through KNITTO_GH_BIN",
      "EXECUTION",
    );
  }
  return new Promise((resolve, reject) => {
    const child = spawn(command, spec.args, {
      cwd: spec.cwd,
      env: process.env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      reject(
        new KnittoGhError(`Unable to run ${spec.command}`, "EXECUTION", {
          cause: error,
        }),
      );
    });
    child.on("close", (exitCode) => {
      const result = { stdout, stderr, exitCode: exitCode ?? 1 };
      if (result.exitCode === 0 || options.allowFailure) {
        resolve(result);
        return;
      }
      reject(
        new KnittoGhError(
          `${spec.command} exited with ${result.exitCode}: ${stderr.trim()}`,
          "EXECUTION",
        ),
      );
    });
    child.stdin.end(options.stdin);
  });
}
