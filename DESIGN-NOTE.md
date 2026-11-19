# StockDesk — Design Note

One page, plain English. Full risk list: `RISKS.md`. Attack paths:
`THREAT-NOTE.md`.

## How I understood the need, and my assumptions

A contractor who has since left set up StockDesk's whole delivery chain —
Dockerfile, compose, Kubernetes manifests, CI pipeline — and nobody who's
still around can say for sure what any of its secrets were used for, what
`KUBECONFIG` can actually do, or whether the Service is reachable from the
Internet. On top of that, the API is about to be opened to external
suppliers, and I didn't get answers to three clarifying questions before
starting (GitHub plan, cluster policy enforcement, data confidentiality).

Given all that, I treated every unknown as the worst case rather than the
most convenient one: all secrets in the repo are live and compromised,
`KUBECONFIG` is cluster-admin, the LoadBalancer (including the debug port)
is Internet-reachable, the GitHub plan is Team (not Enterprise), the
cluster may not enforce any pod/network policy yet, and stock data is
confidential once suppliers can see it. These are written out in full in
`RISKS.md`. If any of them turns out to be wrong in the safer direction
(e.g. the LoadBalancer was never actually public), nothing in this review
becomes harmful — it's still a valid hardening. If any turns out wrong in
the *worse* direction, that's a conversation to have immediately, not
something I could have derived myself.

## Architecture

No architecture change: same app, same port (3000), same environment
variable names. What changed is everything *around* the app — a dedicated
Kubernetes namespace instead of `default`, `ClusterIP` instead of
`LoadBalancer` (suppliers would reach it through an Ingress, not shown as
applied — see `docs/ingress-example.yaml`), a default-deny `NetworkPolicy`,
non-root/read-only containers, and a CI pipeline that no longer hands PR
code the keys to the cluster.

## Two choices I hesitated over

**Secrets: GitHub environment secrets vs. a dedicated secrets
tool (Sealed Secrets / External Secrets Operator).** Corvane has GitHub
secrets and a Kubernetes cluster, no secrets vault. A proper secrets
operator would mean the Secret's *encrypted* form could live in Git safely,
with the cluster decrypting it on apply — stronger long-term, but it's a
new piece of infrastructure to install, configure, and operationally own,
for a team that doesn't have one today. I chose GitHub environment
secrets, created in-cluster by CI at deploy time (`kubectl create secret
... | kubectl apply -f -`), because it uses only what already exists and
keeps the number of new moving parts to what fits in this review's time.
If supplier-facing secret volume grows, External Secrets Operator pointed
at a real secret store is the natural next step — flagged, not built.

**`GET /api/products` staying open vs. adding a key check.** The existing
test `GET /api/products returns the seeded products` calls that endpoint
with no API key and expects `200`. Requiring a key there would be the
"right" fix for R13 in `RISKS.md` (stock data is confidential once
suppliers are involved) — but it changes a documented, currently-passing
behavior and test, which the hard rule asked me not to break without
reason. I left it open at the app layer and closed it instead at the
network layer: `ClusterIP` + default-deny `NetworkPolicy` mean nothing
outside the cluster can reach it today regardless. That's a real gap for
whenever an Ingress is added for suppliers — at that point `GET
/api/products` needs its own key check before it's reachable from outside,
and the existing test would need to change too. I flagged this explicitly
rather than silently leaving it.

## What I tested, and what I could not

Tested for real: `npm test` (7/7), YAML parsing on every YAML file,
`actionlint`, `hadolint`, `gitleaks` (full git history), `trivy config`.
All run against the actual files in this repo, not assumed.

Could not test: `docker build` (no Docker daemon available), the pipeline
running on real GitHub Actions, the manifests applying to a real cluster,
whether Pod Security Admission or the NetworkPolicy are actually enforced
there, or exact base-image digests. All flagged explicitly in `RISKS.md`
rather than assumed to work.

## What I cut, and why

This review's scope is deliberately smaller than "fix everything" — three
hours doesn't cover per-supplier API keys, rate limiting, a request body
size limit, a constant-time key comparison, or TLS termination, all left
as documented, un-fixed items in `RISKS.md` (R13-R18). I prioritized the
things that gave an attacker the most with the least effort first — an
open debugger and a PR that hands over the cluster rank far above a
timing side-channel on a string comparison. Everything cut is written down
with *why*, not silently dropped.

## AI usage – TO BE WRITTEN BY ME

## What I would do with one more day

- Rotate all five secrets for real, following the order in `RISKS.md`,
  and confirm the old values are actually dead (not just replaced).
- Get real answers to the three open questions (GitHub plan, cluster policy
  enforcement, data confidentiality) and adjust the assumptions section
  accordingly — several fixes here are provisional on worst-case guesses.
- Add per-supplier API keys and a request body size limit (R14, R16) —
  both are small, contained changes that don't touch existing tests.
- Get a Docker daemon and a real (even if disposable) cluster to actually
  build the image, run the pipeline once, and confirm the manifests apply
  and the NetworkPolicy/PSA labels do what I expect them to.
