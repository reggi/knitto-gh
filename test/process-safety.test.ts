import assert from "node:assert/strict";
import test from "node:test";
import { runCommand } from "../src/execution/process.js";

test("test mode refuses to execute an uninjected GitHub CLI", async () => {
  const previousBinary = process.env.KNITTO_GH_BIN;
  delete process.env.KNITTO_GH_BIN;
  try {
    await assert.rejects(
      runCommand({ command: "gh", args: ["auth", "status"] }),
      /must inject a fake GitHub CLI/,
    );
  } finally {
    if (previousBinary === undefined) delete process.env.KNITTO_GH_BIN;
    else process.env.KNITTO_GH_BIN = previousBinary;
  }
});

test("the process boundary rejects mutating GitHub commands before spawn", async () => {
  const previousBinary = process.env.KNITTO_GH_BIN;
  process.env.KNITTO_GH_BIN = "/path/that/must/not/run";
  try {
    await assert.rejects(
      runCommand({
        command: "gh",
        args: ["pr", "merge", "123", "--repo", "acme/example"],
      }),
      /Refusing non-read-only gh command/,
    );
    await assert.rejects(
      runCommand({
        command: "gh",
        args: [
          "api",
          "graphql",
          "-f",
          "query=mutation { deleteProjectV2(input: {}) { clientMutationId } }",
        ],
      }),
      /Refusing GraphQL mutation/,
    );
  } finally {
    if (previousBinary === undefined) delete process.env.KNITTO_GH_BIN;
    else process.env.KNITTO_GH_BIN = previousBinary;
  }
});
