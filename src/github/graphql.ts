import { ghJson } from "./gh.js";
import {
  deleteRepositoryCache,
  readRepositoryCache,
  writeRepositoryCache,
  type RepositoryCacheOptions,
} from "../cache/repositories.js";

interface Blob {
  text?: string;
}

export interface RepositoryNode {
  id: string;
  nameWithOwner: string;
  url: string;
  isArchived: boolean;
  isFork: boolean;
  defaultBranchRef?: { name?: string };
  config?: Blob;
  lock?: Blob;
  workflow?: Blob;
}

interface SearchResponse {
  data?: {
    search?: {
      nodes?: RepositoryNode[];
      pageInfo?: {
        hasNextPage?: boolean;
        endCursor?: string;
      };
    };
  };
  errors?: Array<{ message?: string }>;
}

const repositoryQuery = `
query ManagedRepositories(
  $searchQuery: String!
  $cursor: String
  $configExpression: String!
  $lockExpression: String!
  $workflowExpression: String!
) {
  search(type: REPOSITORY, query: $searchQuery, first: 50, after: $cursor) {
    nodes {
      ... on Repository {
        id
        nameWithOwner
        url
        isArchived
        isFork
        defaultBranchRef { name }
        config: object(expression: $configExpression) {
          ... on Blob { text }
        }
        lock: object(expression: $lockExpression) {
          ... on Blob { text }
        }
        workflow: object(expression: $workflowExpression) {
          ... on Blob { text }
        }
      }
    }
    pageInfo {
      hasNextPage
      endCursor
    }
  }
}`;

export async function searchRepositories(
  searchQuery: string,
  workflowPath: string,
  options: {
    onProgress?: (message: string) => void;
    cache?: RepositoryCacheOptions;
  } = {},
): Promise<RepositoryNode[]> {
  let repositories: RepositoryNode[] = [];
  let cursor: string | undefined;
  let page = 0;
  let resumed = false;
  if (options.cache) {
    const cached = await readRepositoryCache(
      searchQuery,
      workflowPath,
      options.cache,
    );
    if (cached) {
      if (cached.complete) {
        options.onProgress?.(
          `using ${cached.repositories.length} cached repositories`,
        );
        return cached.repositories;
      }
      repositories = cached.repositories;
      cursor = cached.nextCursor;
      page = cached.pagesCompleted;
      resumed = true;
      options.onProgress?.(
        `resuming after page ${page} with ${repositories.length} cached repositories`,
      );
    }
  }
  do {
    page += 1;
    options.onProgress?.(`querying repository page ${page}`);
    const args = [
      "api",
      "graphql",
      "-f",
      `query=${repositoryQuery}`,
      "-F",
      `searchQuery=${searchQuery}`,
      "-F",
      "configExpression=HEAD:.knitto.json",
      "-F",
      "lockExpression=HEAD:.knitto.lock",
      "-F",
      `workflowExpression=HEAD:${workflowPath}`,
    ];
    if (cursor) args.push("-F", `cursor=${cursor}`);
    const response = await ghJson<SearchResponse>(args);
    if (response.errors?.length) {
      const message = response.errors
        .map((error) => error.message ?? "GraphQL error")
        .join("; ");
      if (resumed && /cursor/i.test(message)) {
        options.onProgress?.(
          "cached GitHub cursor was rejected; restarting discovery",
        );
        if (options.cache) {
          await deleteRepositoryCache(
            searchQuery,
            workflowPath,
            options.cache,
          );
        }
        repositories = [];
        cursor = undefined;
        page = 0;
        resumed = false;
        continue;
      }
      throw new Error(message);
    }
    const search = response.data?.search;
    const nodes = search?.nodes ?? [];
    repositories.push(...nodes);
    options.onProgress?.(
      `received ${nodes.length} repositories on page ${page} (${repositories.length} total)`,
    );
    if (search?.pageInfo?.hasNextPage && !search.pageInfo.endCursor) {
      throw new Error("GitHub returned another repository page without a cursor");
    }
    cursor = search?.pageInfo?.hasNextPage
      ? search.pageInfo.endCursor
      : undefined;
    if (options.cache) {
      await writeRepositoryCache(
        searchQuery,
        workflowPath,
        {
          complete: cursor === undefined,
          pagesCompleted: page,
          ...(cursor ? { nextCursor: cursor } : {}),
          repositories,
        },
        options.cache,
      );
      options.onProgress?.(
        cursor
          ? `checkpointed repository page ${page}`
          : `completed and cached ${repositories.length} repositories`,
      );
    }
    resumed = false;
  } while (cursor);
  return repositories;
}

export async function ownerType(
  owner: string,
): Promise<"user" | "org"> {
  const response = await ghJson<{ type?: string }>(["api", `users/${owner}`]);
  return response.type === "Organization" ? "org" : "user";
}
