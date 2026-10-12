/**
 * Agent runtime tests.
 *
 * The runtime is built from injected dependencies, so the whole loop —
 * planning, authorization, execution, verification, loop detection, reporting
 * and cancellation — is exercised deterministically without a database or any
 * provider credentials.
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  createAgentRuntime,
  type ApprovalRequest,
  type RunRecord,
  type RunStore,
} from "./index.ts";
import type { CompleteParams } from "./compat.ts";

interface TestStore extends RunStore {
  runs: Map<string, RunRecord>;
  approvalRequests: ApprovalRequest[];
  decisions: Map<string, Record<string, boolean>>;
}

function createStore(initial?: RunRecord): TestStore {
  const runs = new Map<string, RunRecord>();
  const approvalRequests: ApprovalRequest[] = [];
  const decisions = new Map<string, Record<string, boolean>>();
  if (initial) runs.set(initial.id, initial);

  return {
    runs,
    approvalRequests,
    decisions,
    async get(id) {
      return runs.get(id) ?? null;
    },
    async save(run) {
      runs.set(run.id, structuredClone(run));
    },
    async requestApproval(runId, request) {
      approvalRequests.push(request);
      void runId;
    },
    async approvalsFor(runId) {
      return decisions.get(runId) ?? {};
    },
    async searchMemory() {
      return [];
    },
  };
}

function newRun(overrides: Partial<RunRecord> = {}): RunRecord {
  return {
    id: "run-1",
    kind: "nexus",
    goal: "Compose a short brief",
    status: "planning",
    plan: [],
    steps: [],
    result: null,
    error: null,
    control: "run",
    provider: null,
    model: null,
    ...overrides,
  };
}

interface StubOptions {
  plan?: unknown;
  stepText?: (params: CompleteParams, call: number) => string;
  verify?: () => boolean;
  delayMs?: number;
  onCall?: (params: CompleteParams) => void;
}

function stubComplete(options: StubOptions) {
  let stepCall = 0;
  let inFlight = 0;
  let peakInFlight = 0;
  const calls: CompleteParams[] = [];

  const complete = async (params: CompleteParams) => {
    calls.push(params);
    options.onCall?.(params);
    const system = params.system ?? "";

    if (system.includes("Planner")) {
      return {
        text: JSON.stringify(options.plan ?? { steps: [] }),
        provider: "stub",
        model: "stub-planner",
      };
    }
    if (system.includes("Verifier")) {
      const satisfied = options.verify ? options.verify() : true;
      return {
        text: JSON.stringify({ satisfied, note: satisfied ? "Verified." : "Missing evidence." }),
        provider: "stub",
        model: "stub-verifier",
      };
    }

    stepCall += 1;
    inFlight += 1;
    peakInFlight = Math.max(peakInFlight, inFlight);
    try {
      if (options.delayMs) await new Promise((resolve) => setTimeout(resolve, options.delayMs));
      return {
        text: options.stepText ? options.stepText(params, stepCall) : `output ${stepCall}`,
        provider: "stub",
        model: "stub-step",
      };
    } finally {
      inFlight -= 1;
    }
  };

  return { complete, calls, peak: () => peakInFlight };
}

test("plans, executes, verifies and reports a run", async () => {
  const store = createStore(newRun());
  const stubbed = stubComplete({
    plan: {
      steps: [
        { id: "step-1", agent: "Research", description: "Gather facts", tool: "answer", dependsOn: [] },
        { id: "step-2", agent: "Analysis", description: "Summarise", tool: "answer", dependsOn: ["step-1"] },
      ],
    },
    stepText: (_params, call) => `step output ${call}`,
  });

  const runtime = createAgentRuntime({ store, complete: stubbed.complete });
  const finished = await runtime.runToCompletion("run-1");

  assert.equal(finished?.status, "completed");
  assert.equal(finished?.steps.length, 2);
  assert.ok(finished?.steps.every((step) => step.status === "completed"));
  assert.ok(finished?.steps.every((step) => step.verification?.satisfied === true));
  assert.match(finished?.result ?? "", /Task complete/);
  assert.match(finished?.result ?? "", /step output 1/);
  assert.equal(finished?.provider, "stub");
});

test("a dependent step receives the earlier step's verified output as context", async () => {
  const store = createStore(newRun());
  const stubbed = stubComplete({
    plan: {
      steps: [
        { id: "step-1", agent: "Research", description: "First", tool: "answer", dependsOn: [] },
        { id: "step-2", agent: "Analysis", description: "Second", tool: "answer", dependsOn: ["step-1"] },
      ],
    },
    stepText: (_params, call) => (call === 1 ? "FIRST-RESULT" : "second"),
  });

  const runtime = createAgentRuntime({ store, complete: stubbed.complete });
  await runtime.runToCompletion("run-1");

  const secondStepPrompt = stubbed.calls
    .map((params) => String(params.content))
    .find((content) => content.includes("Your task: Second"));
  assert.ok(secondStepPrompt, "second step prompt should have been sent");
  assert.match(secondStepPrompt!, /FIRST-RESULT/);
});

test("consequential steps stop for authorization and record an approval request", async () => {
  const store = createStore(newRun());
  const stubbed = stubComplete({
    plan: {
      steps: [
        { id: "step-1", agent: "Analysis", description: "Think", tool: "answer", dependsOn: [] },
        { id: "step-2", agent: "Automation", description: "Write a file", tool: "answer", dependsOn: [] },
      ],
    },
  });

  const runtime = createAgentRuntime({ store, complete: stubbed.complete });
  const paused = await runtime.runToCompletion("run-1");

  assert.equal(paused?.status, "awaiting_approval");
  assert.equal(store.approvalRequests.length, 1);
  assert.equal(store.approvalRequests[0].id, "step-2");
  const step = paused?.steps.find((candidate) => candidate.id === "step-2");
  assert.equal(step?.status, "awaiting_approval");
});

test("a rejected consequential step is skipped and never executed", async () => {
  const store = createStore(newRun());
  const stubbed = stubComplete({
    plan: {
      steps: [
        { id: "step-1", agent: "Automation", description: "Delete everything", tool: "answer", dependsOn: [] },
      ],
    },
  });
  const runtime = createAgentRuntime({ store, complete: stubbed.complete });

  await runtime.runToCompletion("run-1");
  store.decisions.set("run-1", { "step-1": false });
  const finished = await runtime.runToCompletion("run-1");

  assert.equal(finished?.steps[0].status, "skipped");
  assert.match(finished?.steps[0].error ?? "", /Rejected/);
});

test("an approved sandbox step runs through the real executor path", async () => {
  const store = createStore(newRun());
  const stubbed = stubComplete({
    plan: {
      steps: [
        {
          id: "step-1",
          agent: "Automation",
          description: "Run the script",
          tool: "sandbox",
          code: "print(1)",
          language: "python",
          dependsOn: [],
        },
      ],
    },
  });
  const sandboxCalls: Array<{ code: string; language: string }> = [];
  const runtime = createAgentRuntime({
    store,
    complete: stubbed.complete,
    runSandbox: async (input) => {
      sandboxCalls.push({ code: input.code, language: input.language });
      return {
        stdout: "1\n",
        stderr: "",
        exitCode: 0,
        executionTimeMs: 5,
        blocked: false,
        blockReason: null,
      };
    },
  });

  await runtime.runToCompletion("run-1");
  store.decisions.set("run-1", { "step-1": true });
  const finished = await runtime.runToCompletion("run-1");

  assert.equal(sandboxCalls.length, 1);
  assert.equal(sandboxCalls[0].code, "print(1)");
  assert.equal(finished?.steps[0].status, "completed");
  assert.match(finished?.steps[0].output ?? "", /exit code: 0/);
  assert.match(finished?.steps[0].output ?? "", /1/);
});

test("a step that never verifies is blocked, and repeated identical output is detected as a loop", async () => {
  const store = createStore(newRun());
  const stubbed = stubComplete({
    plan: {
      steps: [{ id: "step-1", agent: "Analysis", description: "Impossible", tool: "answer", dependsOn: [] }],
    },
    stepText: () => "the same answer every time",
    verify: () => false,
  });

  const runtime = createAgentRuntime({ store, complete: stubbed.complete });
  const finished = await runtime.runToCompletion("run-1");

  assert.equal(finished?.steps[0].status, "blocked");
  assert.match(finished?.steps[0].error ?? "", /loop|Verification failed/i);
  assert.equal(finished?.status, "blocked");
  assert.equal(finished?.steps[0].attempts, 2);
});

test("independent steps execute concurrently", async () => {
  const store = createStore(newRun());
  const stubbed = stubComplete({
    plan: {
      steps: [
        { id: "step-1", agent: "Research", description: "A", tool: "answer", dependsOn: [] },
        { id: "step-2", agent: "Research", description: "B", tool: "answer", dependsOn: [] },
        { id: "step-3", agent: "Research", description: "C", tool: "answer", dependsOn: [] },
      ],
    },
    delayMs: 30,
  });

  const runtime = createAgentRuntime({ store, complete: stubbed.complete });
  const finished = await runtime.runToCompletion("run-1");

  assert.equal(finished?.status, "completed");
  assert.ok(stubbed.peak() >= 2, `expected concurrent execution, peak was ${stubbed.peak()}`);
});

test("a cancelled run stops and is marked cancelled", async () => {
  const store = createStore(newRun());
  const stubbed = stubComplete({
    plan: {
      steps: [
        { id: "step-1", agent: "Research", description: "A", tool: "answer", dependsOn: [] },
        { id: "step-2", agent: "Research", description: "B", tool: "answer", dependsOn: [] },
      ],
    },
  });

  const runtime = createAgentRuntime({ store, complete: stubbed.complete });
  runtime.cancel("run-1");
  assert.ok(runtime.isCancelled("run-1"));

  const finished = await runtime.runToCompletion("run-1");

  assert.equal(finished?.status, "cancelled");
  assert.equal(finished?.steps.every((step) => step.status === "pending"), true);
  // The cancellation flag is released once the run has stopped.
  assert.equal(runtime.isCancelled("run-1"), false);
});

test("planning failure marks the run failed instead of inventing progress", async () => {
  const store = createStore(newRun());
  const runtime = createAgentRuntime({
    store,
    complete: async (params: CompleteParams) => {
      if ((params.system ?? "").includes("Planner")) {
        throw new Error("provider unavailable");
      }
      return { text: "unused", provider: "stub", model: "stub" };
    },
  });

  const finished = await runtime.runToCompletion("run-1");

  assert.equal(finished?.status, "failed");
  assert.match(finished?.error ?? "", /provider unavailable/);
  assert.equal(finished?.steps.length, 0);
});

test("JARVIS runs are planned under the subordinate persona", async () => {
  const store = createStore(newRun({ id: "jarvis-1", kind: "jarvis", goal: "Summarise the log" }));
  const systems: string[] = [];
  const stubbed = stubComplete({
    plan: {
      steps: [{ id: "step-1", agent: "Analysis", description: "Summarise", tool: "answer", dependsOn: [] }],
    },
    onCall: (params) => {
      if (params.system) systems.push(params.system);
    },
  });

  const runtime = createAgentRuntime({ store, complete: stubbed.complete });
  const finished = await runtime.runToCompletion("jarvis-1");

  assert.equal(finished?.status, "completed");
  assert.ok(systems.some((system) => system.includes("NEXUS Planner")));
});
