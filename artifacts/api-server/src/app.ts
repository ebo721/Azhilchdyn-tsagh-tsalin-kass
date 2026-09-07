import express, { type ErrorRequestHandler, type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
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
