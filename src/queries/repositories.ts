import { minimatch } from "minimatch";
import { parseKnittoConfig, parseKnittoLock } from "../template/config.js";
import { matchesTemplate } from "../template/match.js";
import type {
  ManagedRepository,
  TemplateIdentity,
} from "../types.js";
import { ownerType, searchRepositories } from "../github/graphql.js";
import type { RepositoryCacheOptions } from "../cache/repositories.js";

function included(
  name: string,
  include: string[],
  exclude: string[],
): boolean {
  return (
    (include.length === 0 || include.some((pattern) => minimatch(name, pattern))) &&
    !exclude.some((pattern) => minimatch(name, pattern))
  );
}

export async function discoverRepositories(options: {
  template: TemplateIdentity;
  owners: string[];
  query?: string;
  include: string[];
  exclude: string[];
  cache: RepositoryCacheOptions;
  onProgress?: (message: string) => void;
}): Promise<ManagedRepository[]> {
  const workflowPath =
    options.template.workflow?.workflow ??
    ".github/workflows/update-template.yml";
  const queries = options.query
    ? [options.query]
    : await Promise.all(
        (options.owners.length > 0
          ? options.owners
          : [options.template.owner]
        ).map(async (owner) => {
          const type = await ownerType(owner);
          return `${type}:${owner} archived:false`;
        }),
      );
  const nodes = (
    await Promise.all(
      queries.map((query) =>
        searchRepositories(query, workflowPath, {
          cache: options.cache,
          ...(options.onProgress ? { onProgress: options.onProgress } : {}),
        }),
      ),
    )
  ).flat();
  options.onProgress?.(`classifying ${nodes.length} discovered repositories`);
  const deduplicated = new Map(
    nodes.map((node) => [node.nameWithOwner.toLowerCase(), node]),
  );

  return [...deduplicated.values()]
    .filter(
      (node) =>
        node.nameWithOwner.toLowerCase() !==
          `${options.template.owner}/${options.template.repository}`.toLowerCase() &&
        included(node.nameWithOwner, options.include, options.exclude),
    )
    .map((node): ManagedRepository => {
      const base = {
        id: node.id,
        nameWithOwner: node.nameWithOwner,
        url: node.url,
        defaultBranch: node.defaultBranchRef?.name ?? "main",
        archived: node.isArchived,
        fork: node.isFork,
        ...(node.config?.text ? { configText: node.config.text } : {}),
        ...(node.lock?.text ? { lockText: node.lock.text } : {}),
        ...(node.workflow?.text ? { workflowText: node.workflow.text } : {}),
      };
      if (node.isArchived) {
        return { ...base, classification: "archived" };
      }
      if (!node.config?.text) {
        return { ...base, classification: "not-consumer" };
      }
      try {
        const config = parseKnittoConfig(node.config.text);
        if (!matchesTemplate(config, options.template)) {
          return { ...base, config, classification: "not-consumer" };
        }
        const lock = node.lock?.text
          ? parseKnittoLock(node.lock.text)
          : undefined;
        if (
          !node.workflow?.text ||
          !node.workflow.text.includes("workflow_dispatch")
        ) {
          return {
            ...base,
            config,
            ...(lock ? { lock } : {}),
            classification: "missing-workflow",
            ...(!node.workflow?.text
              ? {}
              : { reason: "Declared workflow lacks workflow_dispatch" }),
          };
        }
        return {
          ...base,
          config,
          ...(lock ? { lock } : {}),
          classification: "managed",
        };
      } catch (error) {
        return {
          ...base,
          classification: "malformed-config",
          reason: error instanceof Error ? error.message : String(error),
        };
      }
    })
    .sort((left, right) =>
      left.nameWithOwner.localeCompare(right.nameWithOwner),
    );
}
