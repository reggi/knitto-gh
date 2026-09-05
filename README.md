# knitto-gh

<p align="center">
  <img src="assets/knitto-gh.png" alt="Knitto GH logo" width="500">
</p>

GitHub fleet orchestration for repositories managed by
[Knitto](https://github.com/reggi/knitto).

`knitto-gh` discovers consumers of a Knitto template, reads their live GitHub
state, and prints exact commands for propagation, approval, and merging.

## Safety model

Knitto uses the existing authenticated GitHub CLI session for read-only access:

```bash
gh auth status
```

It may execute only allowlisted read operations such as:

```text
gh api ...
gh api graphql ...
gh repo view ...
gh pr list ...
gh pr view ...
gh run list ...
gh run view ...
```

Fleet commands never execute workflow dispatches, repository clones, pushes,
pull-request creation, approvals, merges, or other GitHub mutations. Those
commands are printed for the user to inspect and run manually. There is
intentionally no `--execute` or `--yes` option.

`knitto-gh update` is the explicit local-checkout exception: it reconciles
files and runs repository checks, but it does not perform a GitHub mutation.

The process boundary rejects:

- GraphQL documents containing mutations.
- REST API methods other than `GET`.
- REST fields that could implicitly change the method to `POST`.
- Any non-allowlisted `gh` command.

Tests never inherit or call the developer's real `gh` executable. A test
bootstrap shadows `gh` with a failing guard, and API fixtures must inject an
explicit fake executable.

## Installation

```bash
npm install --global knitto knitto-gh
```

Knitto delegates its GitHub command group to this executable:

```bash
knitto gh --help
```

The standalone equivalent is:

```bash
knitto-gh --help
```

## Template checkout mode

Run commands from a template repository whose root `.knitto.json` points to its
embedded template:

```bash
cd template-railway
knitto gh inspect
knitto gh repos
```

Knitto derives the GitHub repository from `origin`, reads
`.knitto/template.json`, and selects its configured immutable release tag.
Release Please's bootstrap version `0.0.0` is treated as unreleased and uses
the explicit `--ref` or remote default branch, as do templates without release
metadata.

## Explicit template mode

Commands can run from any directory:

```bash
knitto gh \
  --template reggi/template-railway \
  --template-path .knitto \
  repos
```

Template selection defaults to `latest`, similar to a container image tag:
Knitto GH resolves it to the template's current immutable release before
planning any operation. Use `--ref <tag-or-branch>` only to select something
else explicitly. Generated local workers use `knitto@latest` consistently and
only run `source pin` when the repository is not already configured for the
resolved release.

`knitto-gh update` is the shared current-checkout operation used by local
fallback and managed workflows. It may change files in that checkout, but it
does not commit, push, dispatch a workflow, or create a pull request.

```bash
knitto-gh --ref v1.2.0 update .
knitto-gh --json update . --set-json '{"project.name":"example"}'
```

The command installs npm dependencies when a package lock exists, selects the
requested template release when necessary, runs `knitto@latest apply --update`,
refreshes package-lock state, runs `test:quality` when available, and writes a
PR body containing exact Knitto provenance.

## Repository discovery cache

Fleet discovery reads `.knitto.json`, `.knitto.lock`, and the declared update
workflow from every candidate repository. Completed results remain cached
until explicitly refreshed under:

```text
${XDG_CACHE_HOME:-$HOME/.cache}/knitto-gh/github/repositories/
```

Normal human-readable commands report cache hits and GraphQL page progress on
stderr. JSON output remains clean unless `--verbose` is supplied.

```bash
knitto-gh --owner reggi repos
knitto-gh --owner reggi --refresh repos
knitto-gh --owner reggi --cache-ttl 1800 repos
knitto-gh --owner reggi --no-cache repos
```

The cache is keyed by the exact GitHub repository query and declared workflow
path. Discovery checkpoints repositories and the next GitHub cursor atomically
after every successful page. An interrupted scan resumes from its last
checkpoint. Complete results and partial checkpoints do not expire by default;
`--cache-ttl` opts into expiration, while `--refresh` starts a fresh scan. If
GitHub rejects a saved cursor, discovery safely restarts from page one. Partial
checkpoints are never returned as complete fleet results. Use `--refresh`
before an operation that must observe newly created, renamed, archived, or
deleted repositories.

Useful global filters:

```text
--owner <owner>       Repeatable candidate owner
--query <query>       Explicit GitHub repository search query
--include <glob>      Repeatable repository inclusion
--exclude <glob>      Repeatable repository exclusion
--limit <number>      Read-query concurrency
--json                Machine-readable output
```

## Commands

### Inspect prerequisites and identity

```bash
knitto gh doctor
knitto gh inspect
```

### Discover consumers

```bash
knitto gh repos
knitto gh repos --json
```

Discovery reads each default branch's `.knitto.json`, `.knitto.lock`, and the
exact workflow path declared by the template. Release-managed fleets include
consumers pinned to older tags so they remain upgradeable.

### Print propagation commands

```bash
knitto gh propagate
knitto gh propagate --mode workflow
knitto gh propagate --mode local
```

`auto` uses a declared compatible workflow when present. When the workflow is
missing, it prints only the commands to clone the repository and run
`knitto-gh update` locally. Default workflow propagation lets the target
workflow resolve the latest template release when it runs:

```bash
gh workflow run .github/workflows/update-template.yml \
  --repo reggi/railway-vikunja \
  --ref main
```

Local propagation prints:

```bash
gh repo clone reggi/example ~/.cache/knitto-gh/worktrees/reggi/example
(cd ~/.cache/knitto-gh/worktrees/reggi/example && \
  npx --yes knitto-gh@latest update .)
```

Workflow and local fallback commands omit the template `ref` by default so
the update resolves the latest release when the printed command is actually
run. An explicit propagation `--ref` remains pinned in the generated command.

The user reviews the resulting files and generated
`.git/knitto-gh-pr-body`, then creates the branch, commit, and pull request
using their normal Git workflow.

Knitto prints this sequence but never runs it.

### Inspect live state

```bash
knitto gh status
```

Status combines lock provenance with marked update pull requests and reports
states such as `current`, `dispatch-needed`, `pr-open`, `pr-blocked`, and
`pr-ready`.

### Print approvals and merges

```bash
knitto gh review
knitto gh merge --strategy squash
```

Only pull requests carrying matching `Knitto-Template`, `Knitto-Path`, and
`Knitto-Revision` markers are eligible. Commands are still print-only.

### Verify convergence

```bash
knitto gh verify
```

Verification fails when an active managed repository's default-branch lock does
not contain the selected template revision.

## Development

```bash
npm install
npm run check
npm test
npm run build
```

CI exposes the same commands. Tests use fake GitHub responses and cannot reach
the authenticated GitHub CLI.
