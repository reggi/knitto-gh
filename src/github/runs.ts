import { ghJson } from "./gh.js";

export interface WorkflowRun {
  databaseId: number;
  status: string;
  conclusion: string;
  url: string;
  headBranch: string;
  createdAt: string;
  event: string;
}

export async function latestWorkflowRun(
  repository: string,
  workflow: string,
): Promise<WorkflowRun | undefined> {
  const runs = await ghJson<WorkflowRun[]>([
    "run",
    "list",
    "--repo",
    repository,
    "--workflow",
    workflow,
    "--limit",
    "5",
    "--json",
    "databaseId,status,conclusion,url,headBranch,createdAt,event",
  ]);
  return runs[0];
}
