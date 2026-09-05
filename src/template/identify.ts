import { readFile } from "node:fs/promises";
import path from "node:path";
import { KnittoGhError } from "../errors.js";
import { runCommand } from "../execution/process.js";
import { ghJson } from "../github/gh.js";
import type {
  EnginePin,
  TemplateIdentity,
  TemplateRelease,
  WorkflowContract,
} from "../types.js";
import {
  normalizeGitHubRepository,
  normalizeTemplatePath,
} from "./normalize.js";

export interface RawTemplateManifest {
  engine?: EnginePin;
  release?: Omit<TemplateRelease, "tag">;
  conductor?: {
    update?: WorkflowContract;
  };
}

function parseManifest(text: string): RawTemplateManifest {
  let value: unknown;
  try {
    value = JSON.parse(text) as unknown;
  } catch (error) {
    throw new KnittoGhError("Template manifest is invalid JSON", "CONFIG", {
      cause: error,
    });
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new KnittoGhError("Template manifest must be an object", "CONFIG");
  }
  return value as RawTemplateManifest;
}

export function releaseFrom(
  manifest: RawTemplateManifest,
): TemplateRelease | undefined {
  const release = manifest.release;
  if (!release) return undefined;
  if (
    release.provider !== "release-please" ||
    typeof release.version !== "string" ||
    typeof release.tagFormat !== "string" ||
    !release.tagFormat.includes("{version}")
  ) {
    throw new KnittoGhError("Invalid template release metadata", "CONFIG");
  }
  if (release.version === "0.0.0") return undefined;
  return {
    ...release,
    tag: release.tagFormat.replaceAll("{version}", release.version),
  };
}

async function remoteText(
  owner: string,
  repository: string,
  file: string,
  ref: string,
): Promise<string> {
  const response = await ghJson<{ content?: string; encoding?: string }>([
    "api",
    "--method",
    "GET",
    `repos/${owner}/${repository}/contents/${file}`,
    "-f",
    `ref=${ref}`,
  ]);
  if (response.encoding !== "base64" || typeof response.content !== "string") {
    throw new KnittoGhError(
      `GitHub did not return file contents for ${file}`,
      "GITHUB",
    );
  }
  return Buffer.from(response.content.replaceAll("\n", ""), "base64").toString(
    "utf8",
  );
}

async function remoteRevision(
  owner: string,
  repository: string,
  ref: string,
): Promise<string> {
  const response = await ghJson<{ sha?: string }>([
    "api",
    `repos/${owner}/${repository}/commits/${encodeURIComponent(ref)}`,
  ]);
  if (typeof response.sha !== "string") {
    throw new KnittoGhError("GitHub commit response omitted its SHA", "GITHUB");
  }
  return response.sha;
}

export async function identifyTemplate(options: {
  template?: string;
  templatePath: string;
  ref?: string;
}): Promise<TemplateIdentity> {
  const requestedRef =
    options.ref === undefined || options.ref === "latest"
      ? undefined
      : options.ref;
  if (options.template) {
    const repository = normalizeGitHubRepository(options.template);
    const initialRef = requestedRef
      ? requestedRef
      : (
          await ghJson<{ defaultBranchRef?: { name?: string } }>([
            "repo",
            "view",
            `${repository.owner}/${repository.repository}`,
            "--json",
            "defaultBranchRef",
          ])
        ).defaultBranchRef?.name;
    if (!initialRef) {
      throw new KnittoGhError(
        "Unable to resolve the template default branch",
        "GITHUB",
      );
    }
    const templatePath = normalizeTemplatePath(options.templatePath);
    const initialManifest = parseManifest(
      await remoteText(
        repository.owner,
        repository.repository,
        `${templatePath}/template.json`,
        initialRef,
      ),
    );
    const release = releaseFrom(initialManifest);
    const ref = requestedRef ?? release?.tag ?? initialRef;
    const manifest =
      ref === initialRef
        ? initialManifest
        : parseManifest(
            await remoteText(
              repository.owner,
              repository.repository,
              `${templatePath}/template.json`,
              ref,
            ),
          );
    const selectedRelease = releaseFrom(manifest);
    return {
      ...repository,
      path: templatePath,
      ref,
      revision: await remoteRevision(
        repository.owner,
        repository.repository,
        ref,
      ),
      ...(selectedRelease ? { release: selectedRelease } : {}),
      ...(manifest.engine ? { engine: manifest.engine } : {}),
      ...(manifest.conductor?.update
        ? { workflow: manifest.conductor.update }
        : {}),
    };
  }

  const root = (
    await runCommand({
      command: "git",
      args: ["rev-parse", "--show-toplevel"],
    })
  ).stdout.trim();
  const origin = (
    await runCommand({
      command: "git",
      args: ["remote", "get-url", "origin"],
      cwd: root,
    })
  ).stdout.trim();
  const repository = normalizeGitHubRepository(origin);
  const config = JSON.parse(
    await readFile(path.join(root, ".knitto.json"), "utf8"),
  ) as { source?: { type?: string; path?: string } };
  if (config.source?.type !== "local" || typeof config.source.path !== "string") {
    throw new KnittoGhError(
      "Template checkout .knitto.json must use a local source",
      "CONFIG",
    );
  }
  const templatePath = normalizeTemplatePath(config.source.path);
  const manifest = parseManifest(
    await readFile(path.join(root, templatePath, "template.json"), "utf8"),
  );
  const release = releaseFrom(manifest);
  const ref =
    requestedRef ??
    release?.tag ??
    (
      await ghJson<{ defaultBranchRef?: { name?: string } }>([
        "repo",
        "view",
        `${repository.owner}/${repository.repository}`,
        "--json",
        "defaultBranchRef",
      ])
    ).defaultBranchRef?.name;
  if (!ref) {
    throw new KnittoGhError(
      "Unable to resolve the template ref",
      "GITHUB",
    );
  }
  const selectedManifest =
    requestedRef && requestedRef !== release?.tag
      ? parseManifest(
          await remoteText(
            repository.owner,
            repository.repository,
            `${templatePath}/template.json`,
            requestedRef,
          ),
        )
      : manifest;
  const selectedRelease = releaseFrom(selectedManifest);
  return {
    ...repository,
    path: templatePath,
    ref,
    revision: await remoteRevision(repository.owner, repository.repository, ref),
    ...(selectedRelease ? { release: selectedRelease } : {}),
    ...(selectedManifest.engine ? { engine: selectedManifest.engine } : {}),
    ...(selectedManifest.conductor?.update
      ? { workflow: selectedManifest.conductor.update }
      : {}),
    checkoutRoot: root,
  };
}
