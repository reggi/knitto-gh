import assert from "node:assert/strict";
import test from "node:test";
import { pullMatchesTemplate } from "../src/github/pulls.js";
import {
  canUseWorkflow,
  localCommands,
  workflowCommand,
} from "../src/commands/propagate.js";
import { renderCommand, shellQuote } from "../src/render/commands.js";
import { parseKnittoConfig, parseKnittoLock } from "../src/template/config.js";
import { matchesTemplate } from "../src/template/match.js";
import { releaseFrom } from "../src/template/identify.js";
import {
  normalizeGitHubRepository,
  normalizeTemplatePath,
} from "../src/template/normalize.js";
import type {
  ManagedRepository,
  PullRequestState,
  TemplateIdentity,
} from "../src/types.js";

const template: TemplateIdentity = {
  host: "github.com",
  owner: "reggi",
  repository: "template-railway",
  path: ".knitto",
  ref: "v1.2.0",
  revision: "a".repeat(40),
  release: {
    provider: "release-please",
    version: "1.2.0",
    tagFormat: "v{version}",
    tag: "v1.2.0",
  },
  engine: {
    package: "knitto",
    version: "1.0.0",
  },
  workflow: {
    workflow: ".github/workflows/update-template.yml",
    refInput: "ref",
  },
};

const repository: ManagedRepository = {
  id: "R_1",
  nameWithOwner: "reggi/railway-vikunja",
  url: "https://github.com/reggi/railway-vikunja",
  defaultBranch: "main",
  archived: false,
  fork: false,
  classification: "managed",
  config: {
    source: {
      type: "git",
      url: "git@github.com:reggi/template-railway.git",
      path: ".knitto",
      ref: "v1.1.0",
    },
    engine: {
      package: "knitto",
      version: "1.0.0",
    },
  },
};

test("normalizes supported GitHub repository locators", () => {
  for (const locator of [
    "reggi/template-railway",
    "https://github.com/reggi/template-railway.git",
    "git@github.com:reggi/template-railway.git",
  ]) {
    assert.deepEqual(normalizeGitHubRepository(locator), {
      host: "github.com",
      owner: "reggi",
      repository: "template-railway",
    });
  }
  assert.equal(normalizeTemplatePath("./templates/node/"), "templates/node");
  assert.throws(() => normalizeTemplatePath("../secret"), /Invalid template path/);
});

test("parses consumer config and lock summaries", () => {
  assert.equal(
    parseKnittoConfig(
      JSON.stringify({
        source: {
          type: "git",
          url: "reggi/template-railway",
          path: ".knitto",
          ref: "v1.1.0",
        },
        engine: { package: "knitto", version: "1.0.0" },
      }),
    ).engine?.version,
    "1.0.0",
  );
  assert.equal(
    parseKnittoLock(
      JSON.stringify({
        digest: `sha256:${"0".repeat(64)}`,
        source: {
          type: "git",
          url: "reggi/template-railway",
          ref: "v1.1.0",
        },
        provenance: { revision: "b".repeat(40) },
      }),
    ).revision,
    "b".repeat(40),
  );
});

test("release fleets include consumers pinned to older tags", () => {
  assert.equal(matchesTemplate(repository.config!, template), true);
  const { release: _release, ...branchTemplate } = template;
  assert.equal(
    matchesTemplate(repository.config!, branchTemplate),
    false,
  );
});

test("unreleased templates remain branch-managed", () => {
  assert.equal(
    releaseFrom({
      release: {
        provider: "release-please",
        version: "0.0.0",
        tagFormat: "v{version}",
      },
    }),
    undefined,
  );
});

test("renders copyable commands without using shell evaluation", () => {
  assert.equal(shellQuote("plain/value"), "plain/value");
  assert.equal(shellQuote("value with space"), "'value with space'");
  assert.equal(shellQuote("it's"), "'it'\\''s'");
  assert.equal(
    renderCommand({
      command: "gh",
      args: ["pr", "view", "value with space"],
      cwd: "/tmp/repo path",
    }),
    "(cd '/tmp/repo path' && gh pr view 'value with space')",
  );
});

test("workflow propagation passes the immutable release tag", () => {
  assert.deepEqual(workflowCommand(repository, template), {
    command: "gh",
    args: [
      "workflow",
      "run",
      ".github/workflows/update-template.yml",
      "--repo",
      "reggi/railway-vikunja",
      "--ref",
      "main",
      "-f",
      "ref=v1.2.0",
    ],
  });
});

test("auto propagation bootstraps engine upgrades locally", () => {
  assert.equal(canUseWorkflow(repository, template), false);
  assert.equal(
    canUseWorkflow(
      {
        ...repository,
        config: {
          ...repository.config!,
            engine: template.engine!,
        },
      },
      template,
    ),
    true,
  );
});

test("local propagation delegates checkout preparation to knitto-gh update", () => {
  const commands = localCommands(repository, template, "/tmp/work");
  assert.deepEqual(commands[0], {
    command: "gh",
    args: [
      "repo",
      "clone",
      "reggi/railway-vikunja",
      "/tmp/work/reggi/railway-vikunja",
    ],
  });
  assert.deepEqual(commands[1]?.args, [
    "--yes",
    "knitto-gh@latest",
    "update",
    ".",
  ]);
  assert.equal(commands.length, 2);
});

test("local propagation preserves an explicitly requested template ref", () => {
  const commands = localCommands(
    repository,
    template,
    "/tmp/work",
    "v1.2.0",
  );
  assert.deepEqual(commands[1]?.args, [
    "--yes",
    "knitto-gh@latest",
    "--ref",
    "v1.2.0",
    "update",
    ".",
  ]);
});

test("local propagation always uses the shared update operation", () => {
  const commands = localCommands(
    {
      ...repository,
      config: {
        ...repository.config!,
        source: {
          ...repository.config!.source,
          ref: template.release!.tag,
        },
      },
    },
    template,
    "/tmp/work",
  );
  assert.equal(commands[1]?.args.includes("update"), true);
  assert.deepEqual(commands[1]?.args.slice(0, 2), [
    "--yes",
    "knitto-gh@latest",
  ]);
});

test("pull request matching requires machine-readable revision markers", () => {
  const pull: PullRequestState = {
    number: 10,
    url: "https://github.com/reggi/railway-vikunja/pull/10",
    title: "chore: update Knitto template",
    body: [
      "Knitto-Template: reggi/template-railway",
      "Knitto-Path: .knitto",
      `Knitto-Revision: ${"a".repeat(40)}`,
    ].join("\n"),
    isDraft: false,
    mergeable: "MERGEABLE",
    reviewDecision: "APPROVED",
    checksSuccessful: true,
    headRefName: "automation/update",
    headRefOid: "c".repeat(40),
    baseRefName: "main",
    author: "github-actions[bot]",
  };
  assert.equal(pullMatchesTemplate(pull, template), true);
  assert.equal(
    pullMatchesTemplate(
      { ...pull, body: pull.body.replace(template.revision, "wrong") },
      template,
    ),
    false,
  );
});
