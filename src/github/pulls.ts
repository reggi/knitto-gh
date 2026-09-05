import type { PullRequestState } from "../types.js";
import { ghJson } from "./gh.js";

interface RawPullRequest {
  number: number;
  url: string;
  title: string;
  body?: string;
  isDraft: boolean;
  mergeable: string;
  reviewDecision?: string;
  headRefName: string;
  headRefOid: string;
  baseRefName: string;
  author?: { login?: string };
  statusCheckRollup?: Array<{ conclusion?: string; state?: string }>;
}

function checksSuccessful(
  checks: RawPullRequest["statusCheckRollup"],
): boolean {
  return (
    (checks?.length ?? 0) > 0 &&
    (checks ?? []).every((check) =>
      ["SUCCESS", "NEUTRAL", "SKIPPED"].includes(
        check.conclusion ?? check.state ?? "",
      ),
    )
  );
}

export async function openPullRequests(
  repository: string,
): Promise<PullRequestState[]> {
  const pulls = await ghJson<RawPullRequest[]>([
    "pr",
    "list",
    "--repo",
    repository,
    "--state",
    "open",
    "--limit",
    "100",
    "--json",
    [
      "number",
      "url",
      "title",
      "body",
      "isDraft",
      "mergeable",
      "reviewDecision",
      "headRefName",
      "headRefOid",
      "baseRefName",
      "author",
      "statusCheckRollup",
    ].join(","),
  ]);
  return pulls.map((pull) => ({
    number: pull.number,
    url: pull.url,
    title: pull.title,
    body: pull.body ?? "",
    isDraft: pull.isDraft,
    mergeable: pull.mergeable,
    reviewDecision: pull.reviewDecision ?? "",
    checksSuccessful: checksSuccessful(pull.statusCheckRollup),
    headRefName: pull.headRefName,
    headRefOid: pull.headRefOid,
    baseRefName: pull.baseRefName,
    author: pull.author?.login ?? "",
  }));
}

export function pullMatchesTemplate(
  pull: PullRequestState,
  template: {
    owner: string;
    repository: string;
    path: string;
    revision: string;
  },
): boolean {
  const markers = new Map(
    pull.body
      .split(/\r?\n/)
      .map((line) => line.match(/^Knitto-([A-Za-z]+):\s*(.+)$/))
      .filter((match): match is RegExpMatchArray => match !== null)
      .map((match) => [match[1]?.toLowerCase() ?? "", match[2]?.trim() ?? ""]),
  );
  return (
    markers.get("template")?.toLowerCase() ===
      `${template.owner}/${template.repository}`.toLowerCase() &&
    markers.get("path") === template.path &&
    markers.get("revision") === template.revision
  );
}
