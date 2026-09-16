import express, { type ErrorRequestHandler, type Express } from "express";
import type { IncomingMessage, ServerResponse } from "node:http";
import cors from "cors";
import * as pinoHttpModule from "pino-http";
import type { HttpLogger } from "pino-http";
import router from "./routes/index.js";
import { logger } from "./lib/logger.js";

type PinoHttpFactory = (options?: Record<string, unknown>) => HttpLogger;

const createPinoHttp = (
  typeof pinoHttpModule.pinoHttp === "function"
    ? pinoHttpModule.pinoHttp
    : typeof pinoHttpModule.default === "function"
      ? pinoHttpModule.default
      : pinoHttpModule
) as unknown as PinoHttpFactory;

const app: Express = express();

app.use(
  createPinoHttp({
    logger,
    serializers: {
      req(req: IncomingMessage) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res: ServerResponse) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use("/api", router);

const errorHandler: ErrorRequestHandler = (error, req, res, _next) => {
  const isMalformedJson = error instanceof Error
    && "status" in error
    && error.status === 400
    && "type" in error
    && error.type === "entity.parse.failed";

  if ((error instanceof Error && error.name === "ZodError") || isMalformedJson) {
    res.status(400).json({ error: error.message });
    return;
  }

  req.log.error({ err: error }, "Unhandled request error");
  res.status(500).json({ error: "Серверийн алдаа гарлаа" });
};

app.use(errorHandler);

export default app;
