import {
  chmodSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.KNITTO_TEST_MODE = "1";

const guardDirectory = mkdtempSync(path.join(os.tmpdir(), "knitto-gh-guard-"));
const guard = path.join(guardDirectory, "gh");
writeFileSync(
  guard,
  [
    "#!/bin/sh",
    'echo "Real gh execution is disabled during knitto-gh tests." >&2',
    "exit 97",
    "",
  ].join("\n"),
);
chmodSync(guard, 0o755);
process.env.PATH = `${guardDirectory}${path.delimiter}${process.env.PATH ?? ""}`;

process.once("exit", () => {
  rmSync(guardDirectory, { recursive: true, force: true });
});
