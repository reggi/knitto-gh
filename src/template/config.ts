import { KnittoGhError } from "../errors.js";
import type {
  EnginePin,
  KnittoConfigSummary,
  KnittoLockSummary,
} from "../types.js";

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function engine(value: unknown): EnginePin | undefined {
  if (value === undefined) return undefined;
  if (
    !record(value) ||
    value.package !== "knitto" ||
    typeof value.version !== "string"
  ) {
    throw new KnittoGhError("Invalid Knitto engine pin", "CONFIG");
  }
  return { package: "knitto", version: value.version };
}

export function parseKnittoConfig(text: string): KnittoConfigSummary {
  let value: unknown;
  try {
    value = JSON.parse(text) as unknown;
  } catch (error) {
    throw new KnittoGhError("Invalid JSON in .knitto.json", "CONFIG", {
      cause: error,
    });
  }
  if (!record(value) || !record(value.source) || value.source.type !== "git") {
    throw new KnittoGhError(
      "Consumer .knitto.json must use a Git source",
      "CONFIG",
    );
  }
  if (typeof value.source.url !== "string") {
    throw new KnittoGhError("Git template source is missing a URL", "CONFIG");
  }
  const parsedEngine = engine(value.engine);
  return {
    source: {
      type: "git",
      url: value.source.url,
      ...(typeof value.source.path === "string"
        ? { path: value.source.path }
        : {}),
      ...(typeof value.source.ref === "string" ? { ref: value.source.ref } : {}),
    },
    ...(parsedEngine ? { engine: parsedEngine } : {}),
  };
}

export function parseKnittoLock(text: string): KnittoLockSummary {
  let value: unknown;
  try {
    value = JSON.parse(text) as unknown;
  } catch (error) {
    throw new KnittoGhError("Invalid JSON in .knitto.lock", "CONFIG", {
      cause: error,
    });
  }
  if (
    !record(value) ||
    typeof value.digest !== "string" ||
    !record(value.source) ||
    value.source.type !== "git" ||
    typeof value.source.url !== "string"
  ) {
    throw new KnittoGhError("Invalid .knitto.lock", "CONFIG");
  }
  const revision =
    record(value.provenance) && typeof value.provenance.revision === "string"
      ? value.provenance.revision
      : undefined;
  const parsedEngine = engine(value.engine);
  return {
    digest: value.digest,
    source: {
      type: "git",
      url: value.source.url,
      ...(typeof value.source.path === "string"
        ? { path: value.source.path }
        : {}),
      ...(typeof value.source.ref === "string" ? { ref: value.source.ref } : {}),
    },
    ...(parsedEngine ? { engine: parsedEngine } : {}),
    ...(revision ? { revision } : {}),
  };
}
