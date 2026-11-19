# StockDesk — Threat Note

One page, for opening StockDesk to external suppliers next month. Full
detail and remediation plan: see RISKS.md.

## Assets

- **Stock data** (SKUs, quantities) — becomes confidential once suppliers
  can see it: it reveals purchasing patterns and negotiating leverage.
- **The adjust capability** (`POST /api/products/:sku/adjust`) — lets a
  caller change stock numbers; wrong or malicious writes corrupt real
  inventory records.
- **Cluster access** (`KUBECONFIG`) — assumed cluster-admin; the biggest
  single asset in this whole system, because it can reach *everything else*
  on the shared cluster, not just StockDesk.
- **Registry push access** (`DEPLOY_TOKEN`/registry credentials) — lets
  someone publish an image that the cluster will later pull and run.
- **The CI pipeline itself** — whoever can make it run code, runs with
  whatever credentials it holds.

## Attackers considered

- **A repo reader, including the external contractor** — ~40 people have
  read access today and can open PRs; forks are allowed in the org.
- **An Internet attacker** — relevant once (if) a Service is reachable from
  outside the cluster, directly or via a future Ingress.
- **A malicious or compromised supplier** — once onboarded, a legitimate
  but hostile or hacked supplier account.
- **A compromised third-party action or base image** — a dependency in the
  pipeline or Dockerfile is backdoored or quietly changes without review.

## Four attack paths

1. **Open a PR → get the cluster.** Repo reader opens a PR with any diff.
   Original `pull_request_target` runs that PR's own code with
   `write-all` and access to `KUBECONFIG`/`DEPLOY_TOKEN`. Result: cluster
   control (assumed cluster-admin) and registry push, from a read-only
   repo permission. **Cut by:** trigger changed to `pull_request` (no
   secrets reach PR runs), `permissions: contents: read`, deploy gated to
   `push` on `main` only. **What remains:** anyone who can push to `main`
   (today, presumably few people) still triggers a real deploy — protecting
   that branch (required reviews on `main`, and ideally required reviewers
   on the `production` environment, which needs GitHub Enterprise on a
   private repo) is the next layer, not yet in place.

2. **Reach the debugger → run anything.** If the `LoadBalancer` Service
   (assumed Internet-reachable) exposes port 9229, anyone can attach to the
   unauthenticated Node inspector and execute arbitrary code — no exploit,
   no credentials. **Cut by:** `--inspect` removed from the image, port 9229
   removed from the container and the Service, Service changed to
   `ClusterIP`. **What remains:** how suppliers *will* reach the app at all
   is still an open decision (see recommendation below) — get that wrong
   and a new, unintended door opens the same way this one did.

3. **Read the git history → get live credentials.** Any of the ~40 repo
   readers (or anyone who ever cloned it) can read `.env`,
   `k8s/secret.yaml`, and the deploy token straight out of the committed
   files/history. **Cut by:** stopped tracking the files, moved secret
   creation into CI from GitHub environment secrets. **What remains:** the
   actual values are still the *old* ones until someone rotates them (see
   RISKS.md's ordered rotation plan) — removing a file from Git does not
   invalidate a password.

4. **Compromise a supplier account → pivot.** Once suppliers have API
   access, a hacked or malicious supplier can read stock data beyond their
   own concern, hammer the API with no rate limit, or — because today there
   is one shared `API_KEY` — act indistinguishably from every other caller.
   **Cut by:** nothing yet; suppliers are not onboarded in this review's
   scope. **What remains:** per-supplier keys, rate limiting, and TLS (see
   recommendation) all need to exist *before* the first supplier account is
   created, not after.

## Recommendation for supplier access

Don't expose the existing `LoadBalancer`/`ClusterIP` Service directly.
Instead: a dedicated environment (separate namespace or cluster from
internal tooling) behind an **Ingress with TLS** terminating supplier
traffic (see `docs/ingress-example.yaml`), **one API key per supplier**
(so one can be revoked without affecting the others and actions are
attributable), and **rate limiting** at the Ingress/gateway layer before
any supplier account is created. Keep the Service itself `ClusterIP` —
the Ingress is the only intended front door.
