import { Router, type IRouter } from "express";
import healthRouter from "./health";
import providersRouter from "./providers";
import anthropicRouter from "./anthropic";
import {
  memoryRouter,
  agentsRouter,
  sandboxRouter,
  actionsRouter,
  telemetryRouter,
  logsRouter,
  visionRouter,
  codingRouter,
  researchRouter,
  automationRouter,
  tasksRouter,
  notificationsRouter,
  agentRunsRouter,
  marketRouter,
  newsRouter,
} from "./nexus";

const router: IRouter = Router();

router.use(healthRouter);
router.use(providersRouter);
router.use(anthropicRouter);
router.use(memoryRouter);
router.use(agentsRouter);
router.use(sandboxRouter);
router.use(actionsRouter);
router.use(telemetryRouter);
router.use(logsRouter);
router.use(visionRouter);
router.use(codingRouter);
router.use(researchRouter);
router.use(automationRouter);
router.use(tasksRouter);
router.use(notificationsRouter);
router.use(agentRunsRouter);
router.use(marketRouter);
router.use(newsRouter);

export default router;
