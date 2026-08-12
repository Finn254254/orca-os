/**
 * Hand-maintained OpenAPI description of the endpoints actually implemented
 * so far. Extend this alongside each new route file — keeping it accurate
 * and small beats generating a huge spec for endpoints that don't exist yet.
 */
export function buildOpenApiSpec(): Record<string, unknown> {
  const bearerAuth = { bearerAuth: [] as string[] };
  return {
    openapi: "3.0.3",
    info: { title: "Orca API", version: "1.0.0", description: "Cluster-wide API for the Orca Platform." },
    servers: [{ url: "/api/v1" }],
    components: {
      securitySchemes: { bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "session-token" } },
    },
    paths: {
      "/auth/login": {
        post: {
          summary: "Log in with username/password",
          requestBody: { required: true },
          responses: { "200": { description: "Session token + user" }, "401": { description: "Invalid credentials" } },
        },
      },
      "/auth/me": {
        get: { summary: "Current session's user", security: [bearerAuth], responses: { "200": { description: "User" } } },
      },
      "/users": {
        get: { summary: "List users (admin)", security: [bearerAuth], responses: { "200": { description: "Users" } } },
        post: { summary: "Create user (admin)", security: [bearerAuth], responses: { "201": { description: "Created" } } },
      },
      "/users/{id}": {
        delete: { summary: "Delete user (admin)", security: [bearerAuth], responses: { "204": { description: "Deleted" } } },
      },
      "/nodes": {
        get: { summary: "List cluster nodes", security: [bearerAuth], responses: { "200": { description: "Nodes" } } },
      },
      "/nodes/{id}": {
        get: { summary: "Get a node", security: [bearerAuth], responses: { "200": { description: "Node" }, "404": { description: "Not found" } } },
      },
      "/nodes/{id}/metrics": {
        get: { summary: "Latest metrics for a node", security: [bearerAuth], responses: { "200": { description: "Metrics" } } },
      },
      "/nodes/{id}/commands": {
        get: { summary: "Commands sent to a node", security: [bearerAuth], responses: { "200": { description: "Commands" } } },
        post: {
          summary: "Send a command to a node (admin/operator)",
          security: [bearerAuth],
          responses: { "202": { description: "Command accepted" } },
        },
      },
      "/commands": {
        get: { summary: "List commands (optionally filter by nodeId)", security: [bearerAuth], responses: { "200": { description: "Commands" } } },
      },
      "/commands/{id}": {
        get: { summary: "Get a command", security: [bearerAuth], responses: { "200": { description: "Command" } } },
      },
      "/cluster/config": {
        get: { summary: "Get cluster config", security: [bearerAuth], responses: { "200": { description: "Config" } } },
        put: { summary: "Update cluster config (admin)", security: [bearerAuth], responses: { "200": { description: "Config" } } },
      },
      "/ai/models": {
        get: { summary: "List available models (OpenAI-compatible)", security: [bearerAuth], responses: { "200": { description: "Model list" } } },
      },
      "/ai/chat/completions": {
        post: {
          summary: "Chat completion, OpenAI-compatible request/response shape, streaming supported",
          security: [bearerAuth],
          responses: { "200": { description: "Completion (or an SSE stream if stream: true)" } },
        },
      },
      "/models": {
        get: { summary: "List registered models", security: [bearerAuth], responses: { "200": { description: "Models" } } },
      },
      "/models/{id}": {
        get: { summary: "Get a model", security: [bearerAuth], responses: { "200": { description: "Model" }, "404": { description: "Not found" } } },
        delete: { summary: "Delete a model (admin/operator)", security: [bearerAuth], responses: { "204": { description: "Deleted" } } },
      },
      "/models/pull": {
        post: {
          summary: "Pull a model from a runtime (Ollama/llama.cpp) — admin/operator",
          security: [bearerAuth],
          responses: { "202": { description: "Download started" } },
        },
      },
      "/updates/manifests": {
        get: { summary: "List published update manifests", security: [bearerAuth], responses: { "200": { description: "Manifests" } } },
        post: { summary: "Publish a signed update manifest (admin)", security: [bearerAuth], responses: { "201": { description: "Manifest" } } },
      },
      "/updates/rollouts": {
        get: { summary: "List rollouts", security: [bearerAuth], responses: { "200": { description: "Rollouts" } } },
        post: { summary: "Start a rollout (admin)", security: [bearerAuth], responses: { "202": { description: "Rollout" } } },
      },
      "/updates/rollouts/{id}": {
        get: { summary: "Get a rollout", security: [bearerAuth], responses: { "200": { description: "Rollout" }, "404": { description: "Not found" } } },
      },
      "/updates/rollouts/{id}/continue": {
        post: { summary: "Continue a staged rollout to its next batch (admin)", security: [bearerAuth], responses: { "200": { description: "Rollout" } } },
      },
      "/updates/rollouts/{id}/rollback": {
        post: { summary: "Roll back a rollout's successfully-updated nodes (admin)", security: [bearerAuth], responses: { "200": { description: "Rollout" } } },
      },
      "/storage/devices": {
        get: { summary: "List storage devices across the cluster", security: [bearerAuth], responses: { "200": { description: "Devices" } } },
      },
      "/storage/capacity": {
        get: { summary: "Cluster-wide storage capacity", security: [bearerAuth], responses: { "200": { description: "Capacity" } } },
      },
      "/storage/pools": {
        get: { summary: "List storage pools", security: [bearerAuth], responses: { "200": { description: "Pools" } } },
        post: { summary: "Create a storage pool (admin/operator)", security: [bearerAuth], responses: { "201": { description: "Pool" } } },
      },
      "/storage/locations": {
        get: { summary: "List named storage locations (model/dataset/app-data/backup)", security: [bearerAuth], responses: { "200": { description: "Locations" } } },
        post: { summary: "Register a storage location (admin/operator)", security: [bearerAuth], responses: { "201": { description: "Location" } } },
      },
      "/apps": {
        get: { summary: "List app deployments", security: [bearerAuth], responses: { "200": { description: "Deployments" } } },
        post: {
          summary: "Deploy an application from a manifest (admin/operator)",
          security: [bearerAuth],
          responses: { "202": { description: "Deployment accepted" } },
        },
      },
      "/apps/{id}": {
        get: { summary: "Get a deployment", security: [bearerAuth], responses: { "200": { description: "Deployment" }, "404": { description: "Not found" } } },
        delete: { summary: "Remove an app (admin/operator)", security: [bearerAuth], responses: { "200": { description: "Deployment" } } },
      },
      "/jobs": {
        get: { summary: "List compute jobs", security: [bearerAuth], responses: { "200": { description: "Jobs" } } },
        post: {
          summary: "Submit a compute job (admin/operator)",
          security: [bearerAuth],
          responses: { "202": { description: "Job accepted (scheduling attempted synchronously)" } },
        },
      },
      "/jobs/{id}": {
        get: { summary: "Get a job", security: [bearerAuth], responses: { "200": { description: "Job" }, "404": { description: "Not found" } } },
      },
      "/jobs/{id}/cancel": {
        post: { summary: "Cancel a job (admin/operator)", security: [bearerAuth], responses: { "200": { description: "Job" } } },
      },
      "/cluster/groups": {
        get: { summary: "List node groups", security: [bearerAuth], responses: { "200": { description: "Groups" } } },
        post: { summary: "Create a node group (admin/operator)", security: [bearerAuth], responses: { "201": { description: "Groups" } } },
      },
    },
  };
}
