import { Router, type Request, type Response } from "express";
import { AiGatewayService, parseSseChunk } from "@orca/ai-gateway";
import type { ConversationStore } from "../conversationStore.js";

function param(value: string | string[]): string {
  return Array.isArray(value) ? value[0] : value;
}

/** Router for /api/v1/ai/conversations — server-side chat history for Orca AI, backed by @orca/ai-gateway for inference. */
export function createConversationsRouter(conversations: ConversationStore, aiGateway: AiGatewayService): Router {
  const router = Router();

  function ownedConversation(req: Request, res: Response) {
    const conversation = conversations.get(param(req.params.id));
    if (!conversation || conversation.userId !== req.user?.userId) {
      res.status(404).json({ error: "conversation not found" });
      return undefined;
    }
    return conversation;
  }

  router.get("/", (req: Request, res: Response) => {
    res.json(conversations.listForUser(req.user!.userId));
  });

  router.post("/", async (req: Request, res: Response) => {
    const model = req.body?.model;
    if (typeof model !== "string" || !model) {
      res.status(400).json({ error: "model (string) is required" });
      return;
    }
    const conversation = await conversations.create(req.user!.userId, model, req.body?.title);
    res.status(201).json(conversation);
  });

  router.get("/:id", (req: Request, res: Response) => {
    const conversation = ownedConversation(req, res);
    if (conversation) res.json(conversation);
  });

  router.put("/:id", async (req: Request, res: Response) => {
    const conversation = ownedConversation(req, res);
    if (!conversation) return;
    const title = req.body?.title;
    if (typeof title !== "string" || !title) {
      res.status(400).json({ error: "title (string) is required" });
      return;
    }
    res.json(await conversations.rename(conversation.id, title));
  });

  router.delete("/:id", async (req: Request, res: Response) => {
    const conversation = ownedConversation(req, res);
    if (!conversation) return;
    await conversations.delete(conversation.id);
    res.status(204).send();
  });

  router.post("/:id/messages", async (req: Request, res: Response) => {
    const conversation = ownedConversation(req, res);
    if (!conversation) return;
    const content = req.body?.content;
    if (typeof content !== "string" || !content) {
      res.status(400).json({ error: "content (string) is required" });
      return;
    }

    const withUserMessage = await conversations.appendMessage(conversation.id, { role: "user", content });
    if (!withUserMessage) {
      res.status(404).json({ error: "conversation not found" });
      return;
    }

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");

    let buffer = "";
    let accumulated = "";
    try {
      await aiGateway.streamChatCompletion(
        { model: conversation.model, messages: withUserMessage.messages, stream: true },
        (chunk) => {
          res.write(chunk);
          const result = parseSseChunk(buffer, chunk);
          buffer = result.remainder;
          accumulated += result.texts.join("");
        },
      );
    } catch (err) {
      if (!res.headersSent) {
        res.status(502).json({ error: err instanceof Error ? err.message : "gateway error" });
        return;
      }
      res.write(`data: ${JSON.stringify({ error: err instanceof Error ? err.message : "gateway error" })}\n\n`);
    }
    res.end();

    if (accumulated) {
      await conversations.appendMessage(conversation.id, { role: "assistant", content: accumulated });
    }
  });

  return router;
}
