import { Router, type NextFunction, type Request, type RequestHandler, type Response } from "express";
import { AiGatewayService } from "./gatewayService.js";
import { ChatCompletionRequestSchema, GatewayError } from "./types.js";

const noopMiddleware: RequestHandler = (_req, _res, next: NextFunction) => next();

function openAiError(res: Response, status: number, message: string, type = "invalid_request_error"): void {
  res.status(status).json({ error: { message, type } });
}

/** Router for /api/v1/ai — OpenAI-compatible where practical. */
export function createAiGatewayRouter(gateway: AiGatewayService, writeGuard: RequestHandler = noopMiddleware): Router {
  const router = Router();

  router.get("/models", (_req: Request, res: Response) => {
    res.json({ object: "list", data: gateway.listModels() });
  });

  router.post("/chat/completions", writeGuard, async (req: Request, res: Response) => {
    const parsed = ChatCompletionRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      openAiError(res, 400, parsed.error.issues.map((i) => i.message).join("; "));
      return;
    }

    try {
      if (parsed.data.stream) {
        res.setHeader("Content-Type", "text/event-stream");
        res.setHeader("Cache-Control", "no-cache");
        res.setHeader("Connection", "keep-alive");
        await gateway.streamChatCompletion(parsed.data, (chunk) => res.write(chunk));
        res.end();
        return;
      }
      res.json(await gateway.chatCompletion(parsed.data));
    } catch (err) {
      if (res.headersSent) {
        // Failed mid-stream — nothing more we can do but end the connection.
        res.end();
        return;
      }
      if (err instanceof GatewayError) {
        openAiError(res, err.status, err.message, "gateway_error");
        return;
      }
      openAiError(res, 502, "unexpected gateway error", "gateway_error");
    }
  });

  return router;
}
