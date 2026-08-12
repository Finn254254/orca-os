# Single image for every Orca Platform Node.js service (Control, Agent, API)
# plus the Dashboard's dev server. Which process runs is chosen per
# docker-compose service via `command:` — see docker-compose.yml.
FROM node:22-slim

WORKDIR /app

COPY package.json package-lock.json ./
COPY shared shared
COPY mesh mesh
COPY security security
COPY control control
COPY agent agent
COPY api api
COPY cli cli
COPY dashboard dashboard

RUN npm install

ENTRYPOINT ["npx", "tsx"]
