export interface CommandSpec {
  command: string;
  args: string[];
  cwd?: string;
}

export interface CommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface EnginePin {
  package: "knitto";
  version: string;
}

export interface GitTemplateSource {
  type: "git";
  url: string;
  path?: string;
  ref?: string;
}

export interface KnittoConfigSummary {
  source: GitTemplateSource;
  engine?: EnginePin;
}

export interface KnittoLockSummary {
  digest: string;
  source: GitTemplateSource;
  engine?: EnginePin;
  revision?: string;
}

export interface TemplateRelease {
  provider: "release-please";
  version: string;
  tagFormat: string;
  tag: string;
}

export interface WorkflowContract {
  workflow: string;
  refInput?: string;
}

export interface TemplateIdentity {
  host: "github.com";
  owner: string;
  repository: string;
  path: string;
  ref: string;
  revision: string;
  release?: TemplateRelease;
  engine?: EnginePin;
  workflow?: WorkflowContract;
  checkoutRoot?: string;
}

export type RepositoryClassification =
  | "managed"
  | "missing-workflow"
  | "malformed-config"
  | "archived"
  | "not-consumer"
  | "inaccessible";

export interface ManagedRepository {
  id: string;
  nameWithOwner: string;
  url: string;
  defaultBranch: string;
  archived: boolean;
  fork: boolean;
  configText?: string;
  lockText?: string;
  workflowText?: string;
  config?: KnittoConfigSummary;
  lock?: KnittoLockSummary;
  classification: RepositoryClassification;
  reason?: string;
}

export interface PullRequestState {
  number: number;
  url: string;
  title: string;
  body: string;
  isDraft: boolean;
  mergeable: string;
  reviewDecision: string;
  checksSuccessful: boolean;
  headRefName: string;
  headRefOid: string;
  baseRefName: string;
  author: string;
}

export interface GlobalOptions {
  template?: string;
  templatePath: string;
  ref?: string;
  owners: string[];
  query?: string;
  include: string[];
  exclude: string[];
  limit: number;
  json: boolean;
  verbose: boolean;
  cache: boolean;
  refresh: boolean;
  cacheTtl?: number;
}
