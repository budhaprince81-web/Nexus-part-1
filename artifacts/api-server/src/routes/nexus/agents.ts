import { Router, type IRouter } from "express";
import { anthropic, isAnthropicConfigured } from "@workspace/integrations-anthropic-ai";
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

  if (!isAnthropicConfigured()) {
    res.status(503).json({
      error:
        "Planner agent is unavailable: ANTHROPIC_API_KEY is not configured on the server.",
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

    const message = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 8192,
      system: systemPrompt,
      messages: [
        {
          role: "user",
          content: `Task: ${parsed.data.task}${parsed.data.context ? `\n\nContext: ${parsed.data.context}` : ""}`,
        },
      ],
    });

    const block = message.content[0];
    if (block.type !== "text") throw new Error("No text block in response");

    let planData: { steps: unknown[] };
    try {
      const jsonMatch = block.text.match(/\{[\s\S]*\}/);
      planData = JSON.parse(jsonMatch ? jsonMatch[0] : block.text);
    } catch {
      throw new Error("Invalid JSON from planner");
    }

    const planId = randomUUID();
    await db.insert(agentPlans).values({
      id: planId,
      task: parsed.data.task,
      steps: planData.steps,
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
        steps: planData.steps,
        createdAt: new Date().toISOString(),
      }),
    );
  } catch (err) {
    markAgentIdle("Planner");
    req.log.error({ err }, "Planner agent failed");
    res.status(500).json({ error: "Planner agent failed to generate plan" });
  }
});

export default router;
