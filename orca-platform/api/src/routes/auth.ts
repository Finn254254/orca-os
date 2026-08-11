import { Router } from "express";
import { createSessionToken, UserStore } from "@orca/security";
import { requireAuth } from "../middleware/auth.js";

export function createAuthRouter(users: UserStore, sessionSecret: string): Router {
  const router = Router();

  router.post("/login", (req, res) => {
    const { username, password } = req.body ?? {};
    if (typeof username !== "string" || typeof password !== "string") {
      res.status(400).json({ error: "username and password are required" });
      return;
    }
    const user = users.verifyCredentials(username, password);
    if (!user) {
      res.status(401).json({ error: "invalid credentials" });
      return;
    }
    const token = createSessionToken(user, sessionSecret);
    res.json({ token, user });
  });

  router.get("/me", requireAuth(sessionSecret), (req, res) => {
    res.json(req.user);
  });

  return router;
}
