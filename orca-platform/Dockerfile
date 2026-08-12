# Single image for every Orca Platform Node.js service (Control, Agent,
# API) plus the Dashboard/Orca AI/Orca Studio dev servers. Which process
# runs is chosen per docker-compose service via `command:`/`entrypoint:`
# — see docker-compose.yml.
#
# Keep this package list in sync with orca-platform/package.json's
# `workspaces` array as new packages are added — `api`'s server imports
# most of them transitively, so a missing one fails npm install (an
# unresolvable workspace dependency) or the api process's own startup
# import, not just a missing feature.
FROM node:22-slim

WORKDIR /app

COPY package.json package-lock.json ./
COPY shared shared
COPY mesh mesh
COPY security security
COPY control control
COPY agent agent
COPY hardware-daemon hardware-daemon
COPY scheduler scheduler
COPY compute compute
COPY models models
COPY ai-gateway ai-gateway
COPY deploy deploy
COPY storage storage
COPY update update
COPY backup backup
COPY app-backend app-backend
COPY api api
COPY cli cli
COPY dashboard dashboard
COPY ai ai
COPY studio studio

RUN npm install

ENTRYPOINT ["npx", "tsx"]
