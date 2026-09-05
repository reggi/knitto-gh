import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cli = path.join(root, "src", "cli.ts");

async function runCli(args: string[], env: NodeJS.ProcessEnv) {
  return new Promise<{ status: number; stdout: string; stderr: string }>(
    (resolve, reject) => {
      const child = spawn(
        process.execPath,
        ["--import", "tsx", cli, ...args],
        {
          cwd: root,
          env: { ...process.env, ...env },
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
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
      child.on("error", reject);
      child.on("close", (status) =>
        resolve({ status: status ?? 1, stdout, stderr }),
      );
    },
  );
}

test("CLI discovers release consumers and keeps propagation dry by default", async () => {
  const fixture = await mkdtemp(path.join(os.tmpdir(), "knitto-gh-cli-"));
  const fakeGh = path.join(fixture, "gh");
  const log = path.join(fixture, "gh.log");
  const manifest = {
    schemaVersion: 1,
    name: "railway",
    engine: { package: "knitto", version: "1.0.0" },
    release: {
      provider: "release-please",
      version: "1.2.0",
      tagFormat: "v{version}",
    },
    conductor: {
      update: {
        workflow: ".github/workflows/update-template.yml",
        refInput: "ref",
      },
    },
    rules: [],
  };
  const fakeScript = `#!/usr/bin/env node
const fs = require("node:fs");
const args = process.argv.slice(2);
fs.appendFileSync(process.env.FAKE_GH_LOG, JSON.stringify(args) + "\\n");
if (args[0] === "auth") process.exit(0);
if (args[0] === "repo" && args[1] === "view") {
  console.log(JSON.stringify({ defaultBranchRef: { name: "main" } }));
  process.exit(0);
}
if (args[0] === "api" && args.some((arg) => arg.includes("/contents/.knitto/template.json"))) {
  console.log(JSON.stringify({
    encoding: "base64",
    content: ${JSON.stringify(Buffer.from(JSON.stringify(manifest)).toString("base64"))}
  }));
  process.exit(0);
}
if (args[0] === "api" && args.some((arg) => arg.includes("/commits/"))) {
  console.log(JSON.stringify({ sha: "${"a".repeat(40)}" }));
  process.exit(0);
}
if (args[0] === "api" && args.some((arg) => arg === "users/reggi")) {
  console.log(JSON.stringify({ type: "User" }));
  process.exit(0);
}
if (args[0] === "api" && args[1] === "graphql") {
  console.log(JSON.stringify({
    data: {
      search: {
        nodes: [{
          id: "R_1",
          nameWithOwner: "reggi/railway-vikunja",
          url: "https://github.com/reggi/railway-vikunja",
          isArchived: false,
          isFork: false,
          defaultBranchRef: { name: "main" },
          config: { text: JSON.stringify({
            source: {
              type: "git",
              url: "https://github.com/reggi/template-railway.git",
              path: ".knitto",
              ref: "v1.1.0"
            },
            engine: { package: "knitto", version: "1.0.0" }
          }) },
          lock: { text: JSON.stringify({
            digest: "sha256:${"0".repeat(64)}",
            source: {
              type: "git",
              url: "https://github.com/reggi/template-railway.git",
              path: ".knitto",
              ref: "v1.1.0"
            },
            provenance: { revision: "${"b".repeat(40)}" }
          }) },
          workflow: { text: "on:\\n  workflow_dispatch:" }
        }],
        pageInfo: { hasNextPage: false, endCursor: null }
      }
    }
  }));
  process.exit(0);
}
if (args[0] === "pr" && args[1] === "list") {
  console.log("[]");
  process.exit(0);
}
console.error("Unexpected gh arguments:", args);
process.exit(1);
`;

  try {
    await writeFile(fakeGh, fakeScript);
    await chmod(fakeGh, 0o755);
    const env = {
      KNITTO_GH_BIN: fakeGh,
      KNITTO_TEST_MODE: "1",
      FAKE_GH_LOG: log,
    };
    const discovered = await runCli(
      [
        "--template",
        "reggi/template-railway",
        "--json",
        "repos",
      ],
      env,
    );
    assert.equal(discovered.status, 0, discovered.stderr);
    const result = JSON.parse(discovered.stdout) as {
      template: { ref: string };
      repositories: Array<{ classification: string; nameWithOwner: string }>;
    };
    assert.equal(result.template.ref, "v1.2.0");
    assert.equal(result.repositories.length, 1);
    assert.equal(
      result.repositories[0]?.nameWithOwner,
      "reggi/railway-vikunja",
    );
    assert.equal(result.repositories[0]?.classification, "managed");

    await writeFile(log, "");
    const propagated = await runCli(
      [
        "--template",
        "reggi/template-railway",
        "propagate",
        "--mode",
        "workflow",
      ],
      env,
    );
    assert.equal(propagated.status, 0, propagated.stderr);
    assert.match(propagated.stdout, /ref=v1\.2\.0/);
    const calls = (await readFile(log, "utf8"))
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as string[]);
    assert.equal(
      calls.some((args) => args[0] === "workflow" && args[1] === "run"),
      false,
    );
  } finally {
    await rm(fixture, { recursive: true, force: true });
  }
});
