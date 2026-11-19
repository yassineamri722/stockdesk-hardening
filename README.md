# StockDesk

A small internal stock-tracking API for Corvane (fictional company). Plain
Node.js, no dependencies. This repository holds the app plus its delivery
chain: Dockerfile, docker-compose for local dev, Kubernetes manifests, and
a GitHub Actions pipeline.

This version is a security/DevSecOps hardening pass over the original
delivery as received from a contractor who has since left the company,
done ahead of opening the API to external suppliers. See `RISKS.md`,
`THREAT-NOTE.md` and `DESIGN-NOTE.md` for the review itself;
`ORIGINAL-README.md` (one directory up, if present) is the original
project's own README.

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

All of the above were run during this review (see `RISKS.md` and the
commit history) with the following results: `npm test` 7/7 passing,
all YAML files parse, `actionlint` 0 issues, `hadolint` 0 issues,
`trivy config` 0 HIGH/CRITICAL misconfigurations, `gitleaks` found 7
leaks — all in the *original* "as received" commit plus one the review
itself introduced by accident and then fixed (real secret values that had
been typed into a test fixture; see the `fix(checks)` commit).

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

**Not verified — explicitly flagged, not guessed:**
- `docker build` actually succeeding (no Docker daemon in this environment).
- The GitHub Actions pipeline actually running (it is designed to be
  plausible and consistent with the Dockerfile/manifests, not tested live).
- The Kubernetes manifests actually applying to a real cluster, or that
  Pod Security Admission / NetworkPolicy enforcement is turned on there
  (manifests are "ready, enforcement to verify").
- Exact image digests for `node:20-alpine` and `postgres:16-alpine`
  (left as `# TODO verify digest`).
