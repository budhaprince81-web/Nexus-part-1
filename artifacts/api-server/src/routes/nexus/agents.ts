import { Router, type IRouter } from "express";
import { complete, extractJson, hasConfiguredProvider } from "../../ai/index.ts";
import { respondAiError } from "../ai-error.ts";
import { db, agentPlans } from "@workspace/db";
import {
  CreateAgentPlanBody,
  CreateAgentPlanResponse,
  GetAgentStatusResponse,
} from "@workspace/api-zod";
import { randomUUID } from "crypto";
import { logNexusEvent } from "./logs";

const router: IRouter = Router();

// In-memory agent state (resets on restart — future: persist to DB)
const agentRegistry: Record<
  string,
  { status: string; lastActive: string | null; tasksCompleted: number; description: string }
> = {
  Planner:    { status: "idle",   lastActive: null, tasksCompleted: 0, description: "Decomposes complex goals into executable step-by-step plans" },
  Reasoning:  { status: "idle",   lastActive: null, tasksCompleted: 0, description: "Deep logical reasoning, analysis, and decision-making" },
  Coder:      { status: "idle",   lastActive: null, tasksCompleted: 0, description: "Generates complete, production-ready code in 15+ languages" },
  Memory:     { status: "idle",   lastActive: null, tasksCompleted: 0, description: "Manages semantic memory, RAG, and knowledge retrieval" },
  Vision:     { status: "idle",   lastActive: null, tasksCompleted: 0, description: "Image analysis, OCR, document understanding, screen reading" },
  Research:   { status: "idle",   lastActive: null, tasksCompleted: 0, description: "Deep research, knowledge synthesis, and information gathering" },
  Automation: { status: "idle",   lastActive: null, tasksCompleted: 0, description: "File system ops, desktop automation, and workflow execution" },
  Sandbox:    { status: "idle",   lastActive: null, tasksCompleted: 0, description: "Isolated code execution environment with security guardrails" },
  Browser:    { status: "idle",   lastActive: null, tasksCompleted: 0, description: "Web automation, form filling, and data extraction" },
  Security:   { status: "active", lastActive: new Date().toISOString(), tasksCompleted: 0, description: "Guardrail enforcement, threat detection, and audit logging" },
};

export function markAgentActive(name: string): void {
  if (agentRegistry[name]) {
    agentRegistry[name].status = "active";
    agentRegistry[name].lastActive = new Date().toISOString();
  }
}

export function markAgentIdle(name: string): void {
  if (agentRegistry[name]) {
    agentRegistry[name].status = "idle";
    agentRegistry[name].tasksCompleted += 1;
  }
}

// GET /nexus/agents/status
router.get("/nexus/agents/status", async (_req, res): Promise<void> => {
  const statuses = Object.entries(agentRegistry).map(([name, state]) => ({
    name,
    status: state.status,
    lastActive: state.lastActive,
    tasksCompleted: state.tasksCompleted,
    description: state.description,
  }));
  res.json(statuses);
});

// POST /nexus/agents/plan — Planner Agent uses Claude to decompose task
router.post("/nexus/agents/plan", async (req, res): Promise<void> => {
  const parsed = CreateAgentPlanBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  if (!hasConfiguredProvider()) {
    res.status(503).json({
      error:
        "Planner agent is unavailable: no AI provider is configured on the server. " +
        "Add ANTHROPIC_API_KEY, GROQ_API_KEY, OPENAI_API_KEY, GEMINI_API_KEY or " +
        "OPENROUTER_API_KEY in Replit Secrets.",
      code: "no_provider_configured",
    });
    return;
  }

  markAgentActive("Planner");

  try {
    const systemPrompt = `You are the NEXUS Planner Agent. Decompose user tasks into structured, executable steps assigned to specialized agents.

Available agents: Planner, Coder, Memory, Sandbox, Research, Security.

Respond ONLY with valid JSON in this exact format:
{
  "steps": [
    {
      "id": "step-1",
      "agent": "Research",
      "description": "Brief description of this step",
      "status": "pending",
      "dependsOn": []
    },
    {
      "id": "step-2", 
      "agent": "Coder",
      "description": "Write the implementation",
      "status": "pending",
      "dependsOn": ["step-1"]
    }
  ]
}

Keep steps concise. Use 3-7 steps. Never include markdown or explanation outside the JSON.`;

    const completion = await complete({
      content: `Task: ${parsed.data.task}${
        parsed.data.context ? `\n\nContext: ${parsed.data.context}` : ""
      }`,
      system: systemPrompt,
      maxTokens: 4096,
      tier: "balanced",
      temperature: 0.2,
    });

    const planData = extractJson<{ steps?: unknown[] }>(completion.text);
    if (!planData || !Array.isArray(planData.steps) || planData.steps.length === 0) {
      throw new Error("Planner could not produce a valid JSON plan");
    }

    // Model output is external input: normalise it to the response contract so
    // a missing field degrades gracefully instead of failing the whole request.
    const steps = planData.steps
      .map((raw, index) => {
        const record = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
        return {
          id: typeof record.id === "string" && record.id ? record.id : `step-${index + 1}`,
          agent: typeof record.agent === "string" && record.agent ? record.agent : "Analysis",
          description: typeof record.description === "string" ? record.description : "",
          status: typeof record.status === "string" ? record.status : "pending",
          dependsOn: Array.isArray(record.dependsOn)
            ? record.dependsOn.filter((value): value is string => typeof value === "string")
            : [],
        };
      })
      .filter((step) => step.description !== "");

    if (steps.length === 0) {
      throw new Error("Planner produced no usable steps");
    }

    const planId = randomUUID();
    await db.insert(agentPlans).values({
      id: planId,
      task: parsed.data.task,
      steps,
      status: "planned",
    });

    markAgentIdle("Planner");

    await logNexusEvent(
      "info",
      `Planner Agent created plan for: ${parsed.data.task.slice(0, 80)}`,
      "agents",
      { planId, stepCount: planData.steps.length },
    );

    res.json(
      CreateAgentPlanResponse.parse({
        id: planId,
        task: parsed.data.task,
        steps,
        createdAt: new Date().toISOString(),
      }),
    );
  } catch (err) {
    markAgentIdle("Planner");
    respondAiError(req, res, err, "Planner agent failed");
  }
});

export default router;
