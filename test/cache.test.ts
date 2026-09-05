import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import {
  readRepositoryCache,
  writeRepositoryCache,
} from "../src/cache/repositories.js";
import type { RepositoryNode } from "../src/github/graphql.js";

const repositories: RepositoryNode[] = [
  {
    id: "R_1",
    nameWithOwner: "reggi/railway-vikunja",
    url: "https://github.com/reggi/railway-vikunja",
    isArchived: false,
    isFork: false,
    defaultBranchRef: { name: "main" },
    config: { text: "{}" },
  },
];

test("repository discovery cache respects keys, refresh, and TTL", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "knitto-gh-cache-"));
  const options = {
    enabled: true,
    refresh: false,
    ttlSeconds: 300,
    directory: path.join(root, "cache"),
    now: Date.parse("2026-09-05T05:00:00.000Z"),
  };
  try {
    await writeRepositoryCache(
      "user:reggi archived:false",
      ".github/workflows/update-template.yml",
      {
        complete: true,
        pagesCompleted: 12,
        repositories,
      },
      options,
    );
    assert.deepEqual(
      await readRepositoryCache(
        "user:reggi archived:false",
        ".github/workflows/update-template.yml",
        options,
      ),
      {
        complete: true,
        pagesCompleted: 12,
        repositories,
      },
    );
    assert.equal(
      await readRepositoryCache(
        "user:reggi different",
        ".github/workflows/update-template.yml",
        options,
      ),
      undefined,
    );
    assert.equal(
      await readRepositoryCache(
        "user:reggi archived:false",
        ".github/workflows/update-template.yml",
        { ...options, refresh: true },
      ),
      undefined,
    );
    assert.equal(
      await readRepositoryCache(
        "user:reggi archived:false",
        ".github/workflows/update-template.yml",
        { ...options, now: options.now + 300_000 },
      ),
      undefined,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("incomplete repository discovery remains resumable beyond result TTL", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "knitto-gh-cache-"));
  const options = {
    enabled: true,
    refresh: false,
    ttlSeconds: 300,
    directory: path.join(root, "cache"),
    now: Date.parse("2026-09-05T05:00:00.000Z"),
  };
  try {
    await writeRepositoryCache(
      "user:reggi archived:false",
      ".github/workflows/update-template.yml",
      {
        complete: false,
        pagesCompleted: 4,
        nextCursor: "cursor-page-5",
        repositories,
      },
      options,
    );
    assert.deepEqual(
      await readRepositoryCache(
        "user:reggi archived:false",
        ".github/workflows/update-template.yml",
        { ...options, now: options.now + 3_600_000 },
      ),
      {
        complete: false,
        pagesCompleted: 4,
        nextCursor: "cursor-page-5",
        repositories,
      },
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("repository discovery cache does not expire by default", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "knitto-gh-cache-"));
  const options = {
    enabled: true,
    refresh: false,
    directory: path.join(root, "cache"),
    now: Date.parse("2026-09-05T05:00:00.000Z"),
  };
  try {
    await writeRepositoryCache(
      "user:reggi archived:false",
      ".github/workflows/update-template.yml",
      {
        complete: true,
        pagesCompleted: 12,
        repositories,
      },
      options,
    );
    assert.deepEqual(
      await readRepositoryCache(
        "user:reggi archived:false",
        ".github/workflows/update-template.yml",
        { ...options, now: options.now + 31_536_000_000 },
      ),
      {
        complete: true,
        pagesCompleted: 12,
        repositories,
      },
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
