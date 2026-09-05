import { KnittoGhError } from "../errors.js";
import { runCommand } from "../execution/process.js";

export async function gh(args: string[]): Promise<string> {
  try {
    return (await runCommand({ command: "gh", args })).stdout.trim();
  } catch (error) {
    throw new KnittoGhError("GitHub CLI request failed", "GITHUB", {
      cause: error,
    });
  }
}

export async function assertGhAuth(): Promise<void> {
  try {
    await runCommand({
      command: "gh",
      args: ["auth", "status", "--hostname", "github.com"],
    });
  } catch (error) {
    throw new KnittoGhError(
      "GitHub CLI is not authenticated for github.com; run gh auth login",
      "AUTH",
      { cause: error },
    );
  }
}

export async function ghJson<T>(args: string[]): Promise<T> {
  const output = await gh(args);
  try {
    return JSON.parse(output) as T;
  } catch (error) {
    throw new KnittoGhError("GitHub CLI returned invalid JSON", "GITHUB", {
      cause: error,
    });
  }
}
