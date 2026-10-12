import express, {
  type Express,
  type NextFunction,
  type Request,
  type Response,
} from "express";
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

// Unknown API routes return JSON (the SPA and its error handling expect JSON,
// not the default HTML 404 page).
app.use("/api", (_req: Request, res: Response) => {
  res.status(404).json({ error: "Not found" });
});

// Central error handler: logs the failure but never leaks stack traces or
// internal details to clients.
app.use(
  (err: unknown, req: Request, res: Response, next: NextFunction): void => {
    if (res.headersSent) {
      next(err);
      return;
    }
    const status =
      typeof (err as { status?: unknown })?.status === "number"
        ? (err as { status: number }).status
        : 500;
    const safeStatus = status >= 400 && status < 600 ? status : 500;
    req.log?.error({ err }, "Unhandled API error");
    res.status(safeStatus).json({
      error:
        safeStatus >= 500 ? "Internal server error" : "Request could not be processed",
    });
  },
);

export default app;
