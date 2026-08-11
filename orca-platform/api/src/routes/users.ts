import { Router } from "express";
import { UserRoleSchema, type UserRole } from "@orca/shared";
import { UserStore } from "@orca/security";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { param } from "../routeParam.js";

export function createUsersRouter(users: UserStore, sessionSecret: string): Router {
  const router = Router();
  router.use(requireAuth(sessionSecret), requireRole("admin"));

  router.get("/", (_req, res) => {
    res.json(users.listUsers());
  });

  router.post("/", async (req, res) => {
    const { username, password, role } = req.body ?? {};
    if (typeof username !== "string" || typeof password !== "string") {
      res.status(400).json({ error: "username and password are required" });
      return;
    }
    const roleResult = UserRoleSchema.safeParse(role ?? "viewer");
    if (!roleResult.success) {
      res.status(400).json({ error: "invalid role" });
      return;
    }
    try {
      const user = await users.createUser(username, password, roleResult.data as UserRole);
      res.status(201).json(user);
    } catch (err) {
      res.status(409).json({ error: err instanceof Error ? err.message : "could not create user" });
    }
  });

  router.delete("/:id", async (req, res) => {
    const id = param(req.params.id);
    if (id === req.user?.userId) {
      res.status(400).json({ error: "cannot delete your own account" });
      return;
    }
    const deleted = await users.deleteUser(id);
    if (!deleted) {
      res.status(404).json({ error: "user not found" });
      return;
    }
    res.status(204).send();
  });

  return router;
}
