# StockDesk — Design Note

One page, plain English. Full risk list: `RISKS.md`. Attack paths:
`THREAT-NOTE.md`.

## How I understood the need, and my assumptions

A departed contractor set up StockDesk's delivery chain; nobody can say
what its secrets were used for, what `KUBECONFIG` can do, or whether the
Service is Internet-reachable. Suppliers are about to get access, and
three clarifying questions (GitHub plan, cluster policy enforcement, data
confidentiality) went unanswered before I started.

I treated every unknown as the worst case: repo secrets are live and
compromised, `KUBECONFIG` is cluster-admin, the LoadBalancer (debug port
included) is Internet-reachable, the GitHub plan is Team, the cluster may
enforce no pod/network policy yet, and stock data is confidential once
suppliers can see it (full list in `RISKS.md`). Wrong-but-safer
assumptions still leave a valid review; wrong the other way is a
conversation to have immediately.

## Architecture

No architecture change: same app, same port 3000, same environment
variable names. What changed is everything around it — a dedicated
namespace instead of `default`, `ClusterIP` instead of `LoadBalancer`
(suppliers would reach it through an Ingress — see
`docs/ingress-example.yaml`, not applied by CI), a default-deny
`NetworkPolicy`, non-root/read-only containers, and a CI pipeline that no
longer hands PR code the keys to the cluster.

## Two choices I hesitated over

**Secrets: GitHub environment secrets vs. a secrets operator** (Sealed
Secrets / External Secrets). Corvane has GitHub secrets and a cluster, no
vault; an operator is stronger long-term but is new infrastructure to own.
I used environment secrets, created in-cluster by CI at deploy time, since
it needs nothing new — flagged as the next step if secret volume grows.

**`GET /api/products` staying open vs. adding a key check.** An existing
test expects `200` with no key. Requiring one is the "right" fix for data
confidentiality, but breaks a passing, documented test. I left it open at
the app layer and closed it at the network layer instead (`ClusterIP` +
default-deny `NetworkPolicy`) — flagged that once an Ingress exists for
suppliers, this endpoint needs its own key check and the test needs to
change too.

## What I tested, and what I could not

Tested for real: `npm test`, YAML parsing, `actionlint`, `hadolint`,
`gitleaks`, `trivy config` — and, after the first push, the real
`test`/`security-scan` jobs, which caught a genuine step-ordering bug in
the deploy job. Could not test: `docker build` locally (no Docker daemon),
the `release` job end to end (no real registry/cluster), or whether
PSA/NetworkPolicy enforcement is actually on.

## What I cut, and why

Sized at 2-3 hours; I spent closer to 5, mostly reviewing and
understanding every change before committing it. Scope excludes
per-supplier keys, rate limiting, a body size limit, and a constant-time
key comparison — left, documented in `RISKS.md` (R14-R16). TLS is partly
addressed: an example Ingress with TLS exists in `docs/`, not applied by
CI — how suppliers reach the API is still your call.

## AI usage (see the AI statement in the submission form)

## What I would do with one more day

Rotate all five secrets per `RISKS.md`'s order and confirm the old values
are dead. Get real answers to the three open questions. Add per-supplier
keys and a body size limit. Get a disposable cluster to confirm
NetworkPolicy/PSA behave as expected.
