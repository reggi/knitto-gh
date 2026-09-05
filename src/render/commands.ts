import type { CommandSpec } from "../types.js";

export function shellQuote(value: string): string {
  if (/^[A-Za-z0-9_./:@%+=,-]+$/.test(value)) return value;
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

export function renderCommand(spec: CommandSpec): string {
  const command = [spec.command, ...spec.args].map(shellQuote).join(" ");
  return spec.cwd ? `(cd ${shellQuote(spec.cwd)} && ${command})` : command;
}
