/**
 * Autonomous agent runtime.
 *
 * Implements the loop the OS is built on:
 *
 *   UNDERSTAND → PLAN → AUTHORIZE → EXECUTE → OBSERVE → VERIFY → REPORT
 *
 * Honesty rules baked into the implementation:
 *  - every step is a *real* provider call or a *real* tool call; nothing is
 *    simulated and no progress is invented;
 *  - each step's output is verified by a second, independent provider call
 *    before the step is marked complete;
 *  - steps that repeat identical output are detected as a loop and blocked;
 *  - consequential steps stop and wait for a human approval record.
 *
 * The runtime is created from injected dependencies so it can be unit tested
 * without a database or provider credentials.
 */

import { complete as defaultComplete, extractJson } from "./compat.ts";
import type { CompleteParams } from "./compat.ts";
import type { SandboxExecResult, SandboxLanguage } from "../lib/sandbox-exec.ts";
import type { ModelTier } from "./types.ts";

export type RunKind = "nexus" | "jarvis";

export type RunStatus =
  | "planning"
  | "running"
  | "awaiting_approval"
  | "paused"
  | "completed"
  | "failed"
  | "blocked"
  | "cancelled";

export type StepStatus =
  | "pending"
  | "running"
  | "awaiting_approval"
  | "completed"
  | "failed"
  | "blocked"
  | "skipped";

export type StepTool = "answer" | "memory_search" | "sandbox";

export interface PlanStep {
  id: string;
  agent: string;
  description: string;
  tool: StepTool;
  dependsOn: string[];
  /** Requires explicit human approval before execution. */
  consequential: boolean;
  /** Payload for the sandbox tool. */
  code?: string;
  language?: SandboxLanguage;
}

export interface RunStep extends PlanStep {
  status: StepStatus;
  output: string | null;
  verification: { satisfied: boolean; note: string } | null;
  attempts: number;
  /** Fingerprint of the previous attempt, used for loop detection. */
  lastFingerprint: string | null;
  error: string | null;
}

export interface ApprovalRequest {
  id: string;
  actionType: string;
  target: string | null;
  description: string;
  riskLevel: string;
  params: Record<string, unknown>;
}

export interface RunRecord {
  id: string;
  kind: RunKind;
  goal: string;
  status: RunStatus;
  plan: PlanStep[];
  steps: RunStep[];
  result: string | null;
  error: string | null;
  control: "run" | "pause" | "cancel";
  provider: string | null;
  model: string | null;
}

export interface RunStore {
  get(id: string): Promise<RunRecord | null>;
  save(run: RunRecord): Promise<void>;
  /** Creates a pending action row and returns its id. */
  requestApproval(runId: string, request: ApprovalRequest): Promise<void>;
  /** Returns approval decisions for a run, keyed by action type. */
  approvalsFor(runId: string): Promise<Record<string, boolean>>;
  /** Semantic-ish memory lookup used by the `memory_search` tool. */
  searchMemory(query: string, limit: number): Promise<string[]>;
}

export interface AgentRuntimeDeps {
  store: RunStore;
  complete?: (params: CompleteParams) => Promise<{ text: string; provider: string; model: string }>;
  runSandbox?: (input: {
    code: string;
    language: SandboxLanguage;
    timeoutMs?: number;
  }) => Promise<SandboxExecResult>;
  log?: (event: {
    level: "info" | "warn" | "error";
    message: string;
    meta?: Record<string, unknown>;
  }) => void;
  maxConcurrency?: number;
  maxStepAttempts?: number;
}

const DEFAULT_MAX_CONCURRENCY = 3;
const DEFAULT_MAX_STEP_ATTEMPTS = 2;

/** Role prompts — these are *roles* played by the configured model, not separate models. */
const PERSONAS: Record<string, string> = {
  Planner:
    "You are the NEXUS Planner. You decompose a goal into the smallest set of " +
    "independently verifiable steps, each assigned to one specialist role.",
  Research:
    "You are the NEXUS Research role. You give factual, clearly-sourced answers " +
    "and you explicitly flag anything you cannot verify from your own knowledge.",
  Coder:
    "You are the NEXUS Coder role. You write correct, complete, runnable code and " +
    "state exactly how it was validated.",
  Memory:
    "You are the NEXUS Memory role. You work only from the supplied context and " +
    "never invent facts that are absent from it.",
  Analysis:
    "You are the NEXUS Analysis role. You reason carefully, quantify uncertainty " +
    "and separate facts from assumptions.",
  Automation:
    "You are the NEXUS Automation role. You propose exact, reviewable file or shell " +
    "operations and never claim an operation ran unless its output is shown.",
  Vision:
    "You are the NEXUS Vision role. You describe only what is actually present.",
  Verification:
    "You are the NEXUS Verifier. You decide, strictly, whether a step's output " +
    "actually satisfies its description. You are hard to satisfy and you say no " +
    "when evidence is missing.",
  Jarvis:
    "You are JARVIS, the subordinate assistant of the NEXUS operating system. You " +
    "are concise, literal and obedient to the task you were given. You never claim " +
    "to have performed an action you did not perform.",
};

const STEP_TOOLS: StepTool[] = ["answer", "memory_search", "sandbox"];
const SANDBOX_LANGUAGES: SandboxLanguage[] = ["python", "javascript", "typescript", "bash"];
/** Roles whose work changes the world outside the model, so they need approval. */
const CONSEQUENTIAL_ROLES = new Set([
  "Automation",
  "Browser",
  "Security",
  "Deploy",
  "Filesystem",
]);

function fingerprint(text: string): string {
  // Cheap, stable fingerprint — no crypto needed for loop detection.
  let hash = 5381;
  for (let i = 0; i < text.length; i += 1) {
    hash = ((hash << 5) + hash + text.charCodeAt(i)) | 0;
  }
  return `${text.length}:${hash}`;
}

function normalizeStep(raw: unknown, position: number): PlanStep | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  const description = typeof record.description === "string" ? record.description.trim() : "";
  if (!description) return null;
  const tool = STEP_TOOLS.includes(record.tool as StepTool)
    ? (record.tool as StepTool)
    : "answer";
  const agent = typeof record.agent === "string" && record.agent.trim() ? record.agent.trim() : "Analysis";
  const dependsOn = Array.isArray(record.dependsOn)
    ? record.dependsOn.filter((value): value is string => typeof value === "string")
    : [];
  return {
    id: typeof record.id === "string" && record.id.trim() ? record.id.trim() : `step-${position + 1}`,
    agent,
    description,
    tool,
    dependsOn,
    consequential: record.consequential === true || CONSEQUENTIAL_ROLES.has(agent),
    ...(typeof record.code === "string" ? { code: record.code } : {}),
    ...(SANDBOX_LANGUAGES.includes(record.language as SandboxLanguage)
      ? { language: record.language as SandboxLanguage }
      : {}),
  };
}

export function createAgentRuntime(deps: AgentRuntimeDeps) {
  const completeFn = deps.complete ?? defaultComplete;
  const maxConcurrency = deps.maxConcurrency ?? DEFAULT_MAX_CONCURRENCY;
  const maxStepAttempts = deps.maxStepAttempts ?? DEFAULT_MAX_STEP_ATTEMPTS;
  const log = deps.log ?? (() => undefined);

  /** Live control flags keyed by run id. */
  const controls = new Map<string, { cancel: boolean }>();

  async function plan(run: RunRecord, context?: string): Promise<{ steps: PlanStep[]; provider: string; model: string }> {
    const system = [
      PERSONAS.Planner,
      "Available roles: Planner, Research, Coder, Memory, Analysis, Automation, Vision.",
      "Available tools: answer (use your own knowledge), memory_search (look up stored memories), sandbox (run code).",
      "Respond with JSON only:",
      '{"steps":[{"id":"step-1","agent":"Research","description":"...","tool":"answer","dependsOn":[],"consequential":false}]}',
      "Use 3 to 6 steps. Mark a step consequential when it would modify files, run code,",
      "send external messages, publish, or change settings. Keep each description verifiable.",
    ].join("\n");

    const prompt = [
      `Goal (${run.kind === "jarvis" ? "delegated to JARVIS" : "primary objective"}): ${run.goal}`,
      context ? `\nContext supplied by the operator:\n${context}` : "",
      "\nProduce the plan now.",
    ].join("");

    const completion = await completeFn({
      content: prompt,
      system,
      maxTokens: 2048,
      temperature: 0.2,
      tier: "balanced",
    });

    const parsed = extractJson<{ steps?: unknown[] }>(completion.text);
    const rawSteps = Array.isArray(parsed?.steps) ? parsed!.steps! : [];
    const steps = rawSteps
      .map((raw, index) => normalizeStep(raw, index))
      .filter((step): step is PlanStep => step !== null);

    if (steps.length === 0) {
      // A single-step fallback keeps the run useful instead of failing outright.
      steps.push({
        id: "step-1",
        agent: run.kind === "jarvis" ? "Jarvis" : "Analysis",
        description: run.goal,
        tool: "answer",
        dependsOn: [],
        consequential: false,
      });
    }

    return { steps, provider: completion.provider, model: completion.model };
  }

  function toRunSteps(plan: PlanStep[]): RunStep[] {
    return plan.map((step) => ({
      ...step,
      status: "pending",
      output: null,
      verification: null,
      attempts: 0,
      lastFingerprint: null,
      error: null,
    }));
  }

  function contextFor(run: RunRecord, step: RunStep): string {
    const completed = run.steps
      .filter((candidate) => candidate.status === "completed" && candidate.output)
      .map((candidate) => `### ${candidate.agent} — ${candidate.description}\n${candidate.output}`)
      .join("\n\n");
    return [
      `Overall goal: ${run.goal}`,
      `Your task: ${step.description}`,
      `You are acting as the ${step.agent} role.`,
      completed ? `\nWork already completed:\n${completed}` : "",
      "\nRules: do not claim to have run tools you did not run; state clearly when " +
        "information could not be verified; be concise and concrete.",
    ].join("\n");
  }

  async function executeStep(run: RunRecord, step: RunStep): Promise<void> {
    step.attempts += 1;
    step.status = "running";

    if (step.tool === "memory_search" && deps.store.searchMemory) {
      const matches = await deps.store.searchMemory(step.description, 10);
      step.output =
        matches.length > 0
          ? `Stored memories matching "${step.description}":\n- ${matches.join("\n- ")}`
          : `No stored memories matched "${step.description}".`;
      return;
    }

    if (step.tool === "sandbox" && step.code) {
      if (!deps.runSandbox) {
        step.output = null;
        step.error = "Sandbox execution is not available in this runtime.";
        step.status = "failed";
        return;
      }
      const result = await deps.runSandbox({
        code: step.code,
        language: step.language ?? "python",
      });
      step.output = [
        `exit code: ${result.exitCode}`,
        result.blocked ? `blocked: ${result.blockReason ?? "yes"}` : null,
        result.stdout ? `stdout:\n${result.stdout}` : null,
        result.stderr ? `stderr:\n${result.stderr}` : null,
      ]
        .filter((line): line is string => line !== null)
        .join("\n");
      return;
    }

    const completion = await completeFn({
      content: contextFor(run, step),
      system: PERSONAS[step.agent] ?? PERSONAS.Analysis,
      maxTokens: 2048,
      tier: "balanced",
    });
    step.output = completion.text.trim() || null;
    run.provider = completion.provider;
    run.model = completion.model;
  }

  async function verifyStep(run: RunRecord, step: RunStep): Promise<void> {
    if (!step.output) {
      step.verification = { satisfied: false, note: "Step produced no output." };
      step.status = "failed";
      step.error = "Empty output";
      return;
    }

    const completion = await completeFn({
      content: [
        `Goal: ${run.goal}`,
        `Step description: ${step.description}`,
        `Step output:\n${step.output}`,
        "",
        'Answer with JSON only: {"satisfied": true|false, "note": "one sentence"}',
      ].join("\n"),
      system: PERSONAS.Verification,
      maxTokens: 300,
      temperature: 0,
      tier: "fast",
    });

    const parsed = extractJson<{ satisfied?: unknown; note?: unknown }>(completion.text);
    const satisfied = parsed?.satisfied === true;
    const note = typeof parsed?.note === "string" ? parsed.note : "";

    if (satisfied) {
      step.verification = { satisfied: true, note: note || "Verified." };
      step.status = "completed";
      return;
    }

    // Loop detection: an identical retry means we are not making progress.
    const nextFingerprint = fingerprint(step.output);
    if (step.lastFingerprint === nextFingerprint) {
      step.verification = { satisfied: false, note: note || "Output did not satisfy the step." };
      step.status = "blocked";
      step.error = "Repeated identical output detected — stopping to avoid a loop.";
      return;
    }
    step.lastFingerprint = nextFingerprint;
    step.verification = { satisfied: false, note: note || "Output did not satisfy the step." };
    step.status = step.attempts >= maxStepAttempts ? "blocked" : "pending";
    step.error = step.attempts >= maxStepAttempts ? "Verification failed after retries." : null;
  }

  function isRunnable(run: RunRecord, step: RunStep): boolean {
    if (step.status !== "pending") return false;
    return step.dependsOn.every((dependency) => {
      const target = run.steps.find((candidate) => candidate.id === dependency);
      return !target || target.status === "completed";
    });
  }

  async function persist(run: RunRecord): Promise<void> {
    await deps.store.save(run);
  }

  /**
   * Runs the loop until the run reaches a terminal state or must wait for a
   * human decision. Returns the final record.
   */
  async function runToCompletion(runId: string): Promise<RunRecord | null> {
    let run = await deps.store.get(runId);
    if (!run) return null;

    if (run.plan.length === 0) {
      run.status = "planning";
      await persist(run);
      try {
        const planned = await plan(run);
        run.plan = planned.steps;
        run.steps = toRunSteps(planned.steps);
        run.provider = planned.provider;
        run.model = planned.model;
        run.status = "running";
        await persist(run);
        log({ level: "info", message: `Plan created for run ${run.id}`, meta: { steps: run.steps.length } });
      } catch (err) {
        run.status = "failed";
        run.error = err instanceof Error ? err.message : "Planning failed";
        await persist(run);
        return run;
      }
    }

    for (;;) {
      if (controls.get(run.id)?.cancel || run.control === "cancel") {
        run.status = "cancelled";
        await persist(run);
        controls.delete(run.id);
        return run;
      }
      if (run.control === "pause") {
        run.status = "paused";
        await persist(run);
        return run;
      }

      // Resolve anything waiting on a human decision.
      const awaiting = run.steps.filter((step) => step.status === "awaiting_approval");
      if (awaiting.length > 0) {
        const decisions = await deps.store.approvalsFor(run.id);
        let stillWaiting = false;
        for (const step of awaiting) {
          const decision = decisions[step.id];
          if (decision === undefined) {
            stillWaiting = true;
            continue;
          }
          if (decision) {
            // Approved: run it for real using the registered executor.
            step.status = "pending";
            await executeStep(run, step);
            await verifyStep(run, step);
          } else {
            step.status = "skipped";
            step.error = "Rejected by the operator.";
          }
        }
        run.status = stillWaiting ? "awaiting_approval" : "running";
        await persist(run);
        if (stillWaiting) return run;
        continue;
      }

      const runnable = run.steps.filter((step) => isRunnable(run, step));

      if (runnable.length === 0) {
        const unfinished = run.steps.filter(
          (step) => step.status !== "completed" && step.status !== "skipped",
        );
        if (unfinished.length === 0) {
          run.status = "completed";
          await persist(run);
          await report(run);
          controls.delete(run.id);
          return await deps.store.get(run.id);
        }
        const blocked = unfinished.some((step) => step.status === "blocked");
        run.status = blocked ? "blocked" : "failed";
        run.error =
          run.error ??
          (blocked
            ? "One or more steps could not be verified. Review the step notes."
            : "The plan could not be completed.");
        await persist(run);
        await report(run);
        controls.delete(run.id);
        return run;
      }

      // Consequential work first stops for authorization.
      const needsApproval = runnable.filter((step) => step.consequential);
      if (needsApproval.length > 0) {
        run.status = "awaiting_approval";
        for (const step of needsApproval) {
          if (step.status === "pending") {
            step.status = "awaiting_approval";
            await deps.store.requestApproval(run.id, {
              id: step.id,
              actionType: `${step.agent.toLowerCase()}_step`,
              target: run.goal.slice(0, 200),
              description: `${step.agent}: ${step.description}`,
              riskLevel: "high",
              params: { runId: run.id, stepId: step.id, tool: step.tool },
            });
          }
        }
        await persist(run);
        return run;
      }

      const batch = runnable.slice(0, maxConcurrency);
      for (const step of batch) step.status = "running";
      await persist(run);

      await Promise.all(
        batch.map(async (step) => {
          try {
            await executeStep(run, step);
          } catch (err) {
            step.status = "failed";
            step.error = err instanceof Error ? err.message : "Step execution failed";
            log({ level: "error", message: `Step ${step.id} failed`, meta: { error: step.error } });
          }
        }),
      );

      for (const step of batch) {
        if (step.status !== "running") continue;
        try {
          await verifyStep(run, step);
        } catch (err) {
          step.status = "failed";
          step.error = err instanceof Error ? err.message : "Verification failed";
        }
      }

      await persist(run);
    }
  }

  /** Produces the final report from verified step outputs. */
  async function report(run: RunRecord): Promise<void> {
    const sections = run.steps.map((step, index) => {
      const verdict = step.verification
        ? step.verification.satisfied
          ? "verified"
          : `not verified (${step.verification.note})`
        : step.status;
      return `${index + 1}. [${step.status} · ${verdict}] ${step.agent}: ${step.description}\n${
        step.output ? step.output : step.error ? `Error: ${step.error}` : "(no output)"
      }`;
    });

    const header =
      run.status === "completed"
        ? `Task complete: ${run.goal}`
        : `Task ${run.status}: ${run.goal}`;

    run.result = [
      header,
      `\nSteps (${run.steps.filter((step) => step.status === "completed").length}/${run.steps.length} completed):`,
      ...sections,
      run.error ? `\nRemaining issue: ${run.error}` : "",
    ]
      .filter(Boolean)
      .join("\n");
    await persist(run);
  }

  return {
    runToCompletion,
    plan,
    /** Requests cooperative cancellation of a running loop. */
    cancel(runId: string): void {
      const control = controls.get(runId) ?? { cancel: false };
      control.cancel = true;
      controls.set(runId, control);
    },
    isCancelled(runId: string): boolean {
      return controls.get(runId)?.cancel === true;
    },
    clearControl(runId: string): void {
      controls.delete(runId);
    },
  };
}

export type AgentRuntime = ReturnType<typeof createAgentRuntime>;

export const AGENT_RUNTIME_DEFAULTS = {
  maxConcurrency: DEFAULT_MAX_CONCURRENCY,
  maxStepAttempts: DEFAULT_MAX_STEP_ATTEMPTS,
};

export type { ModelTier };
