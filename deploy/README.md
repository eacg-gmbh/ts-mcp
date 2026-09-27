# AWS deployment

This directory exists **only in the private repository** (`eacg-gmbh/ts-mcp`). It was
removed from the public one, where it had been carrying real VPC, subnet, cluster,
security-group and hosted-zone identifiers.

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

## Required repository configuration

| Kind | Name | Example |
|---|---|---|
| Variable | `ECR_REGISTRY` | `<account>.dkr.ecr.eu-central-1.amazonaws.com` |
| Variable | `ECR_REPOSITORY` | `ts-mcp` |
| Variable | `AWS_REGION` | `eu-central-1` (default if unset) |
| Secret | `AWS_ECR_ROLE_ARN` | OIDC role allowed to push to that repository. Falls back to `AWS_DEPLOY_ROLE_ARN` if unset — that role then needs ECR push permission. |

`ImageRepository` in both parameter files is a placeholder (`REPLACE_WITH_ECR_REGISTRY/ts-mcp`).
The deploy workflow refuses to run while a placeholder is present, so filling it in is
a deliberate step.
