# StockDesk

A small internal stock-tracking API for Corvane (fictional company). Plain
Node.js, no dependencies. This repository holds the app plus its delivery
chain: Dockerfile, docker-compose for local dev, Kubernetes manifests, and
a GitHub Actions pipeline.

This version is a security/DevSecOps hardening pass over the original
delivery as received from a contractor who has since left the company,
done ahead of opening the API to external suppliers. See `RISKS.md`,
`THREAT-NOTE.md` and `DESIGN-NOTE.md` for the review itself.

**Before / after:** every change, as a diff against the original delivery:
https://github.com/yassineamri722/stockdesk-hardening/compare/57cb1fc...main

## Run it

```sh
cp .env.example .env     # fill in local values; never commit this file
npm test                 # 7 tests, Node 18+
node src/server.js       # serves on PORT (default 3000)
```

Or with Docker Compose, for local development only:

```sh
docker compose up
```

This binds the app to `127.0.0.1:3000` and Postgres to `127.0.0.1:5432` —
neither is reachable from outside your machine. Never run this compose
file on a shared or production server (see the comment at the top of
`docker-compose.yml`).

## Secrets this pipeline expects

Created as GitHub repository or `production` environment secrets — never
committed. See RISKS.md's "Secrets already exposed" for why the current
real-world values need rotating regardless.

| Secret | Used for |
|---|---|
| `REGISTRY_USER`, `REGISTRY_TOKEN` | Docker registry login/push |
| `KUBECONFIG` | Cluster access for the deploy step |
| `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `API_KEY` | Written into the `stockdesk-env` Kubernetes Secret at deploy time |
| `GITLEAKS_LICENSE` | Required by `gitleaks-action` for organisation-owned repositories (Corvane is one); free to request from gitleaks.io |

## Check it

```sh
npm test                                    # app tests
python3 -c "import sys, yaml; [list(yaml.safe_load_all(open(f))) for f in sys.argv[1:]]; print('YAML ok')" \
  k8s/*.yaml docs/*.yaml .github/workflows/ci.yml .github/dependabot.yml docker-compose.yml
actionlint .github/workflows/ci.yml          # GitHub Actions workflow linter
hadolint Dockerfile                          # Dockerfile linter
gitleaks git --no-banner .                   # secrets in git history
trivy config --severity HIGH,CRITICAL .      # Dockerfile + k8s misconfigurations
```

All of the above were run by Claude Code during this review (see
`RISKS.md` and the commit history) with the following results: `npm test`
7/7 passing, all YAML files parse, `actionlint` 0 issues, `hadolint` 0
issues, `trivy config` 0 HIGH/CRITICAL misconfigurations, `gitleaks` found 7
leaks — all in the *original* "as received" commit plus one the review
itself introduced by accident and then fixed (real secret values that had
been typed into a test fixture; see the `fix(checks)` commit). Known
findings are now listed in `.gitleaksignore` so the scan fails on any *new*
secret, not forever on history that can't change.

I separately re-checked the GitHub Action commit SHAs myself and found one
mistake Claude Code had made: `aquasecurity/trivy-action@v0.36.0` is an
annotated tag, and the SHA originally pinned was the tag *object*, not the
commit it points to (`git ls-remote --tags <repo>` shows both — the line
ending in `^{}` is the real commit). Fixed in the `fix: review findings
before submission` commit.

## What changed, commit by commit

| Commit | What |
|---|---|
| `chore: original repository as received` | Baseline, unmodified. |
| `fix(secrets): stop tracking .env and committed Kubernetes secret` | Stopped tracking `.env` and `k8s/secret.yaml`; added `.env.example`. |
| `fix(docker): non-root, no debugger, pinned base, minimal context` | Pinned base image, removed the debugger port, non-root user, `.dockerignore`. |
| `fix(app): redact secrets from startup log, add /livez` | Secrets no longer printed in logs; added a DB-independent liveness endpoint. |
| `fix(k8s): dedicated namespace, ClusterIP, hardened pod, correct probes` | Own namespace, no debug port, hardened `securityContext`, split liveness/readiness probes. |
| `feat(k8s): NetworkPolicy, PodDisruptionBudget and ingress example` | Default-deny network policy, disruption budget, a documented (not applied) Ingress+TLS example. |
| `fix(ci): no secrets for PRs, least privilege, deploy only from main` | Closed the `pull_request_target` hole, least-privilege permissions, deploy gated to `main`. |
| `chore(deps): Dependabot for actions, Docker and npm` | Keeps pinned versions from going stale. |
| `fix(compose): local development only, no published DB/debug ports` | Local-only ports, no hardcoded password, pinned Postgres image. |
| `fix(checks): numeric container UID, remove real secret values from test fixture` | Two fixes found while re-checking the work (see `RISKS.md`). |
| `docs: risks, threat note, README, design note` | This documentation. |

## What was verified vs. not

**Verified, for real, in this review:**
- `npm test` — actually run, 7/7 passing.
- YAML syntax — actually parsed, every file.
- `actionlint`, `hadolint`, `gitleaks`, `trivy config` — actual binaries
  downloaded and run against this repo (see `RISKS.md` for versions and
  results).
- GitHub Action commit SHAs in `ci.yml` — looked up for real via
  `git ls-remote --tags <repo>` against each action's actual repository,
  dated 2026-11-19.

**Also verified, after the first real push to GitHub:** the `test` and
`security-scan` jobs ran for real and passed. The `release` job's first
run surfaced the step-ordering bug (Secret created before the namespace
existed) fixed in `fix: review findings before submission` — a genuine
finding from actually running it, not a hypothetical.

**Not verified — explicitly flagged, not guessed:**
- `docker build` actually succeeding (no Docker daemon in this environment;
  the `release` job itself does run it on GitHub's runners).
- The `release` job completing end to end — `registry.corvane.example` and
  the Kubernetes cluster are not real, so registry login and `kubectl`
  steps cannot succeed against them. Everything up to that point (build,
  Trivy scan, SBOM) does run for real.
- The Kubernetes manifests actually applying to a real cluster, or that
  Pod Security Admission / NetworkPolicy enforcement is turned on there
  (manifests are "ready, enforcement to verify").
- Exact image digests for `node:20-alpine` and `postgres:16-alpine`
  (left as `# TODO verify digest`).
