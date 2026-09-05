import { createHash, randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { KnittoGhError } from "../errors.js";
import type { RepositoryNode } from "../github/graphql.js";

interface RepositoryCacheV1 {
  schemaVersion: 1;
  key: string;
  createdAt: string;
  repositories: RepositoryNode[];
}

interface RepositoryCacheV2 {
  schemaVersion: 2;
  key: string;
  updatedAt: string;
  complete: boolean;
  pagesCompleted: number;
  nextCursor?: string;
  repositories: RepositoryNode[];
}

export interface RepositoryCacheState {
  complete: boolean;
  pagesCompleted: number;
  nextCursor?: string;
  repositories: RepositoryNode[];
}

export interface RepositoryCacheOptions {
  enabled: boolean;
  refresh: boolean;
  ttlSeconds: number;
  directory?: string;
  now?: number;
}

function cacheDirectory(options: RepositoryCacheOptions): string {
  return (
    options.directory ??
    path.join(
      process.env.XDG_CACHE_HOME ?? path.join(os.homedir(), ".cache"),
      "knitto-gh",
      "github",
      "repositories",
    )
  );
}

function cacheKey(searchQuery: string, workflowPath: string): string {
  return JSON.stringify({ searchQuery, workflowPath });
}

function cacheFile(
  searchQuery: string,
  workflowPath: string,
  options: RepositoryCacheOptions,
): string {
  const digest = createHash("sha256")
    .update(cacheKey(searchQuery, workflowPath))
    .digest("hex");
  return path.join(cacheDirectory(options), `${digest}.json`);
}

function validRepository(value: unknown): value is RepositoryNode {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const repository = value as Partial<RepositoryNode>;
  return (
    typeof repository.id === "string" &&
    typeof repository.nameWithOwner === "string" &&
    typeof repository.url === "string" &&
    typeof repository.isArchived === "boolean" &&
    typeof repository.isFork === "boolean"
  );
}

export async function readRepositoryCache(
  searchQuery: string,
  workflowPath: string,
  options: RepositoryCacheOptions,
): Promise<RepositoryCacheState | undefined> {
  if (!options.enabled || options.refresh || options.ttlSeconds === 0) {
    return undefined;
  }
  const file = cacheFile(searchQuery, workflowPath, options);
  let text: string;
  try {
    text = await readFile(file, "utf8");
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

  let value: unknown;
  try {
    value = JSON.parse(text) as unknown;
  } catch (error) {
    throw new KnittoGhError(
      `Invalid repository cache: ${file}; rerun with --refresh`,
      "CONFIG",
      { cause: error },
    );
  }
  if (typeof value !== "object" || value === null) {
    throw new KnittoGhError(
      `Invalid repository cache: ${file}; rerun with --refresh`,
      "CONFIG",
    );
  }
  const cache = value as
    | Partial<RepositoryCacheV1>
    | Partial<RepositoryCacheV2>;
  if (
    cache.key !== cacheKey(searchQuery, workflowPath) ||
    !Array.isArray(cache.repositories) ||
    !cache.repositories.every(validRepository)
  ) {
    throw new KnittoGhError(
      `Invalid repository cache: ${file}; rerun with --refresh`,
      "CONFIG",
    );
  }
  const repositories = cache.repositories;

  let state: RepositoryCacheState;
  let updatedAt: number;
  if (cache.schemaVersion === 1 && typeof cache.createdAt === "string") {
    updatedAt = Date.parse(cache.createdAt);
    state = {
      complete: true,
      pagesCompleted: 0,
      repositories,
    };
  } else if (
    cache.schemaVersion === 2 &&
    typeof cache.updatedAt === "string" &&
    typeof cache.complete === "boolean" &&
    typeof cache.pagesCompleted === "number" &&
    Number.isSafeInteger(cache.pagesCompleted) &&
    cache.pagesCompleted >= 0 &&
    (cache.nextCursor === undefined || typeof cache.nextCursor === "string") &&
    (cache.complete
      ? cache.nextCursor === undefined
      : typeof cache.nextCursor === "string" && cache.nextCursor.length > 0)
  ) {
    updatedAt = Date.parse(cache.updatedAt);
    state = {
      complete: cache.complete,
      pagesCompleted: cache.pagesCompleted,
      ...(cache.nextCursor ? { nextCursor: cache.nextCursor } : {}),
      repositories,
    };
  } else {
    throw new KnittoGhError(
      `Invalid repository cache: ${file}; rerun with --refresh`,
      "CONFIG",
    );
  }

  const now = options.now ?? Date.now();
  const ttlSeconds = state.complete
    ? options.ttlSeconds
    : Math.max(options.ttlSeconds, 86_400);
  if (
    !Number.isFinite(updatedAt) ||
    now - updatedAt >= ttlSeconds * 1000
  ) {
    return undefined;
  }
  return state;
}

export async function deleteRepositoryCache(
  searchQuery: string,
  workflowPath: string,
  options: RepositoryCacheOptions,
): Promise<void> {
  await rm(cacheFile(searchQuery, workflowPath, options), { force: true });
}

export async function writeRepositoryCache(
  searchQuery: string,
  workflowPath: string,
  state: RepositoryCacheState,
  options: RepositoryCacheOptions,
): Promise<void> {
  if (!options.enabled || options.ttlSeconds === 0) return;
  const file = cacheFile(searchQuery, workflowPath, options);
  const directory = path.dirname(file);
  const temporary = path.join(directory, `.${path.basename(file)}.${randomUUID()}`);
  await mkdir(directory, { recursive: true });
  try {
    const cache: RepositoryCacheV2 = {
      schemaVersion: 2,
      key: cacheKey(searchQuery, workflowPath),
      updatedAt: new Date(options.now ?? Date.now()).toISOString(),
      complete: state.complete,
      pagesCompleted: state.pagesCompleted,
      ...(state.nextCursor ? { nextCursor: state.nextCursor } : {}),
      repositories: state.repositories,
    };
    await writeFile(temporary, `${JSON.stringify(cache)}\n`, {
      mode: 0o600,
    });
    await rename(temporary, file);
  } finally {
    await rm(temporary, { force: true });
  }
}
