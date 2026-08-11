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
      "/cluster/groups": {
        get: { summary: "List node groups", security: [bearerAuth], responses: { "200": { description: "Groups" } } },
        post: { summary: "Create a node group (admin/operator)", security: [bearerAuth], responses: { "201": { description: "Groups" } } },
      },
    },
  };
}
