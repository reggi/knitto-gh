import type { KnittoConfigSummary, TemplateIdentity } from "../types.js";
import {
  normalizeTemplatePath,
  sameRepository,
} from "./normalize.js";

export function matchesTemplate(
  config: KnittoConfigSummary,
  template: TemplateIdentity,
): boolean {
  return (
    sameRepository(config.source.url, `${template.owner}/${template.repository}`) &&
    normalizeTemplatePath(config.source.path ?? ".knitto") === template.path &&
    (template.release !== undefined ||
      (config.source.ref ?? "HEAD") === template.ref)
  );
}
