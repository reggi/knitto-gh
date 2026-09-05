import type { GlobalOptions, TemplateIdentity } from "../types.js";
import { assertGhAuth } from "../github/gh.js";
import { identifyTemplate } from "../template/identify.js";
import { discoverRepositories } from "../queries/repositories.js";

export async function templateContext(
  options: GlobalOptions,
): Promise<TemplateIdentity> {
  await assertGhAuth();
  return identifyTemplate(options);
}

export async function fleetContext(options: GlobalOptions) {
  const progress =
    !options.json || options.verbose
      ? (message: string) => console.error(`knitto gh: ${message}`)
      : undefined;
  progress?.("checking GitHub authentication");
  await assertGhAuth();
  progress?.("resolving template identity");
  const template = await identifyTemplate(options);
  const requestedRef = options.ref ?? "latest";
  progress?.(
    requestedRef === "latest"
      ? `resolved ${template.owner}/${template.repository}@latest to ${template.ref}`
      : `resolved ${template.owner}/${template.repository}@${template.ref}`,
  );
  progress?.("discovering consumer repositories");
  const repositories = await discoverRepositories({
    template,
    owners: options.owners,
    ...(options.query ? { query: options.query } : {}),
    include: options.include,
    exclude: options.exclude,
    cache: {
      enabled: options.cache,
      refresh: options.refresh,
      ttlSeconds: options.cacheTtl,
    },
    ...(progress ? { onProgress: progress } : {}),
  });
  const consumers = repositories.filter((repository) =>
    ["managed", "missing-workflow"].includes(repository.classification),
  ).length;
  progress?.(
    `finished with ${consumers} Knitto consumers across ${repositories.length} classified repositories`,
  );
  return { template, repositories };
}
