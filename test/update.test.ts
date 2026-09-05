import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { update } from "../src/commands/update.js";
import type { CommandSpec } from "../src/types.js";

test("update prepares a checkout and writes reusable provenance", async () => {
  const project = await mkdtemp(path.join(os.tmpdir(), "knitto-gh-update-"));
  const bodyFile = path.join(project, "pr-body");
  const githubOutput = path.join(project, "github-output");
  const commands: CommandSpec[] = [];
  const configFile = path.join(project, ".knitto.json");
  try {
    await writeFile(
      configFile,
      JSON.stringify({
        source: {
          type: "git",
          url: "https://github.com/reggi/template-railway.git",
          path: ".knitto",
          ref: "v1.1.0",
        },
        engine: { package: "knitto", version: "1.0.0" },
      }),
    );
    const execute = async (spec: CommandSpec) => {
      commands.push(spec);
      if (spec.args.includes("pin")) {
        const config = JSON.parse(await readFile(configFile, "utf8")) as {
          source: { ref: string };
        };
        config.source.ref = "v1.2.0";
        await writeFile(configFile, JSON.stringify(config));
      }
      if (spec.args.includes("apply")) {
        await writeFile(
          path.join(project, ".knitto.lock"),
          JSON.stringify({
            digest: `sha256:${"0".repeat(64)}`,
            source: {
              type: "git",
              url: "https://github.com/reggi/template-railway.git",
              path: ".knitto",
              ref: "v1.2.0",
            },
            provenance: { revision: "a".repeat(40) },
          }),
        );
      }
      return { stdout: "", stderr: "", exitCode: 0 };
    };

    const result = await update(
      {
        project,
        ref: "v1.2.0",
        setJson: '{"project.name":"railway"}',
        bodyFile,
        githubOutput,
        json: true,
      },
      execute,
    );

    assert.equal(result.ref, "v1.2.0");
    assert.equal(result.revision, "a".repeat(40));
    assert.equal(commands.some((command) => command.args.includes("pin")), true);
    assert.equal(
      commands.some(
        (command) =>
          command.args.includes("apply") &&
          command.args.includes("project.name=railway"),
      ),
      true,
    );
    assert.match(await readFile(bodyFile, "utf8"), /Knitto-Ref: v1\.2\.0/);
    assert.match(
      await readFile(githubOutput, "utf8"),
      /revision=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/,
    );
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});
