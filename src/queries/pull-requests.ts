import pLimit from "p-limit";
import {
  openPullRequests,
  pullMatchesTemplate,
} from "../github/pulls.js";
import type {
  ManagedRepository,
  PullRequestState,
  TemplateIdentity,
} from "../types.js";

export interface RepositoryPullRequest {
  repository: ManagedRepository;
  pull?: PullRequestState;
}

export async function updatePullRequests(
  repositories: ManagedRepository[],
  template: TemplateIdentity,
  concurrency: number,
): Promise<RepositoryPullRequest[]> {
  const limit = pLimit(concurrency);
  return Promise.all(
    repositories.map((repository) =>
      limit(async () => {
        const pull = (await openPullRequests(repository.nameWithOwner)).find((pull) =>
          pullMatchesTemplate(pull, template),
        );
        return {
          repository,
          ...(pull ? { pull } : {}),
        };
      }),
    ),
  );
}
