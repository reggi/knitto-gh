export type ErrorCode =
  | "CONFIG"
  | "AUTH"
  | "GITHUB"
  | "EXECUTION"
  | "USAGE"
  | "VERIFY";

export class KnittoGhError extends Error {
  constructor(
    message: string,
    readonly code: ErrorCode,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "KnittoGhError";
  }
}

export function exitCodeFor(error: unknown): number {
  if (!(error instanceof KnittoGhError)) return 1;
  return {
    CONFIG: 2,
    AUTH: 3,
    GITHUB: 4,
    EXECUTION: 1,
    USAGE: 5,
    VERIFY: 6,
  }[error.code];
}
