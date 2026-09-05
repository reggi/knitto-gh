import { KnittoGhError } from "../errors.js";

export interface GitHubRepository {
  host: "github.com";
  owner: string;
  repository: string;
}

export function normalizeGitHubRepository(value: string): GitHubRepository {
  const trimmed = value.trim().replace(/\.git$/, "");
  const scp = trimmed.match(/^git@github\.com:([^/]+)\/(.+)$/);
  const shorthand = trimmed.match(/^([^/:]+)\/([^/]+)$/);
  let owner: string | undefined;
  let repository: string | undefined;

  if (scp) {
    [, owner, repository] = scp;
  } else if (shorthand) {
    [, owner, repository] = shorthand;
  } else {
    let parsed: URL;
    try {
      parsed = new URL(trimmed);
    } catch (error) {
      throw new KnittoGhError(
        `Invalid GitHub repository: ${value}`,
        "CONFIG",
        { cause: error },
      );
    }
    if (parsed.hostname !== "github.com") {
      throw new KnittoGhError(
        `Only github.com repositories are supported: ${value}`,
        "CONFIG",
      );
    }
    [owner, repository] = parsed.pathname.replace(/^\/|\/$/g, "").split("/");
  }

  if (!owner || !repository || repository.includes("/")) {
    throw new KnittoGhError(
      `Invalid GitHub repository: ${value}`,
      "CONFIG",
    );
  }
  return { host: "github.com", owner, repository };
}

export function normalizeTemplatePath(value = ".knitto"): string {
  const normalized = value.replaceAll("\\", "/").replace(/^\.\/+/, "");
  if (
    normalized === "" ||
    normalized.startsWith("/") ||
    normalized.split("/").some((part) => part === "..")
  ) {
    throw new KnittoGhError(`Invalid template path: ${value}`, "CONFIG");
  }
  return normalized.replace(/\/+$/, "");
}

export function sameRepository(left: string, right: string): boolean {
  const a = normalizeGitHubRepository(left);
  const b = normalizeGitHubRepository(right);
  return (
    a.owner.toLowerCase() === b.owner.toLowerCase() &&
    a.repository.toLowerCase() === b.repository.toLowerCase()
  );
}
