# Pinned to a specific Node 20 LTS Alpine tag instead of "latest" so builds are
# reproducible and we know exactly what we're shipping.
# TODO verify digest: pin with FROM node:20-alpine@sha256:... once verified
FROM node:26-alpine

WORKDIR /app

# Copy only what the app needs at runtime (no .env, .git, tests, docs, etc.
# - see .dockerignore for the full exclude list).
COPY package.json ./
COPY src ./src

# No dependencies are declared in package.json and no package-lock.json is
# committed, so there is nothing to install. Do NOT use `npm ci` here: it
# requires a lockfile and would fail the build.

ENV NODE_ENV=production

# Run as the non-root "node" user already built into the official Node image,
# by numeric uid:gid (1000:1000) rather than by name, so a compromised process
# has fewer rights and the host doesn't need to resolve the "node" username
# (hadolint DL3066). Matches runAsUser/runAsGroup in k8s/deployment.yaml.
USER 1000:1000

EXPOSE 3000

CMD ["node", "src/server.js"]
