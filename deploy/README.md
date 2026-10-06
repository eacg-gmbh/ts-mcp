# AWS deployment

This directory exists **only in the private repository** (`eacg-gmbh/ts-mcp`). It was
removed from the public one, where it had been carrying real VPC, subnet, cluster,
security-group and hosted-zone identifiers.

## Two ways an image reaches ECR

| | `ecr-publish` (E8) | `mirror-to-ecr` |
|---|---|---|
| Source | **this repository's own code** | the public image on Docker Hub |
| Contains | the fork's additions (role packs, `TS_ROLE`, playbook overrides) | upstream only |
| Gate | ts-scan runs **here**, before any AWS credential is used | ts-scan ran in the public repo |
| Trigger | push of a `v*` tag, push to `main` | manual (`workflow_dispatch`) |
| Used by | **ts-agent-svc** (pinned by digest), this repo's ECS service | the fork's own ECS service, while it runs unmodified upstream |

ts-agent-svc must use `ecr-publish`: its role packs exist only in this fork, so a
mirrored public image would silently lack them.

## How the two repositories relate

```
TrustSource/ts-mcp (public)            eacg-gmbh/ts-mcp (private)
  source, tools, Dockerfile              everything from public, plus:
  build + ts-scan gate                     deploy/            (this directory)
  publish -> Docker Hub                    mirror-to-ecr      (Docker Hub -> ECR)
        │                                  deploy.yaml        (CloudFormation + ECS)
        └──────── trustsource/ts-mcp ─────────────►
```

**The image is built once, in public.** It passes the ts-scan gate there and is
published to Docker Hub. Nothing is rebuilt here — `mirror-to-ecr` copies the
published manifest into our ECR registry, so ECS pulls from a registry we control
while the artefact stays byte-identical to the scanned one.

## Keeping the fork in sync

`main` here tracks `main` in public and adds this directory on top. Merge public into
private, never the other way round:

```sh
git fetch origin && git merge origin/main
```

The one-time exception is the commit that removed `deploy/` from public: merging it
deletes this directory here as well, so restore it in the merge (`git checkout HEAD~1 --
deploy .github/workflows/deploy.yaml`) before committing. Afterwards public never
touches these paths again, so later merges are clean.

**Never push this directory to `origin`.**

## Releasing a version to an environment

1. Public: tag `vX.Y.Z` — the publish workflow pushes `:X.Y.Z`, `:X.Y` and `:latest`.
2. Private: run **Mirror image to ECR** with `source_tag: X.Y.Z`
   (`also_latest: true` if this is the current production version).
3. Pin `ImageTag` in `params4PRD.json` to `X.Y.Z` and run **Deploy to ECS**.

DEV tracks the rolling `main` tag; mirror it with `source_tag: main` whenever the DEV
environment should pick up the branch build. Production always pins a version, so it
is always answerable which release is running.

## One-time bootstrap: the GitHub OIDC roles

The workflows authenticate to AWS by OIDC, not with stored keys. The roles they
assume are **not** created by the service stack — they cannot be, because that stack
is deployed *by* one of them. `cfn-github-oidc.yaml` creates them, and is deployed
once by hand with credentials that may create IAM roles:

```sh
aws cloudformation deploy \
  --stack-name ts-mcp-github-oidc \
  --template-file deploy/cfn-github-oidc.yaml \
  --parameter-overrides HostedZoneId=<private zone id> \
  --capabilities CAPABILITY_NAMED_IAM
```

Set `CreateOidcProvider=no` if the account already has the GitHub provider — there can
only be one per account. Then put the two output ARNs into the repository secrets.

Two roles rather than one, because they are trusted differently:

| Role | Trusted from | May do |
|---|---|---|
| `ts-mcp-gha-ecr-mirror` | the `main` branch and `v*` tags | push to the one ECR repository |
| `ts-mcp-gha-deploy` | the `dev` / `prd` **environments** | deploy the service stack |

The deploy role is reachable only through a GitHub Environment, so environment
protection rules — required reviewers, allowed branches — gate the credentials
themselves, not merely the workflow that asks for them.

## Required repository configuration

| Kind | Name | Example |
|---|---|---|
| Variable | `ECR_REPOSITORY` | `ts-mcp` — the repository name only, as `aws ecr describe-repositories` lists it |
| Variable | `AWS_REGION` | `eu-central-1` (used if unset) |
| Secret | `AWS_ECR_ROLE_ARN` | OIDC role allowed to push to that repository. Falls back to `AWS_DEPLOY_ROLE_ARN` if unset — that role then needs ECR push permission. |

| Secret | `TRUSTSOURCE_API_KEY` | TrustSource API key the ts-scan gate uploads with (`ecr-publish` fails fast, naming what is missing, if it is absent) |

The ECR repository itself must exist, with **mutable tags** (the rolling `main` tag
moves; semver and `<sha>` tags are written once). Create it once:

```sh
aws ecr create-repository --repository-name ts-mcp --image-scanning-configuration scanOnPush=true
```

Protect the `v*` tag pattern (repository settings → tag rules) so that only
maintainers can create release tags: the ECR role is assumable from them.

The registry host is not configured: it comes from the ECR login step, so it is by
construction the registry the assumed role is authenticated against.

`ImageRepository` in the parameter files does need the full path, because
CloudFormation has no login step to derive it from:
`<account>.dkr.ecr.<region>.amazonaws.com/ts-mcp`.

`ImageRepository` is not configured anywhere: the deploy workflow derives it from the
account the credentials belong to plus `ECR_REPOSITORY`, so it cannot drift away from
the registry the mirror pushes to. The CloudFormation parameter has no default, so a
dropped override fails loudly instead of silently deploying from somewhere else.

## Releasing a version (ecr-publish)

1. Bump `package.json` to `X.Y.Z`, update `CHANGELOG.md`, merge to `main`.
2. Tag `vX.Y.Z` on that commit and push the tag. The workflow refuses to run if the
   tag and `package.json` disagree.
3. `ecr-publish` builds, runs ts-scan (`--exit-on-vulns --Werror`) and, only if that
   passes, pushes `:X.Y.Z` and `:<sha>` (multi-arch: amd64 + arm64) to ECR.
4. The image **digest** is printed in the run summary and written into the GitHub
   release notes. ts-agent-svc pins that digest (`ts-mcp@sha256:...`), never a tag.

Pushes to `main` publish the rolling `:main` and `:<sha>` the same way, behind the same gate.
