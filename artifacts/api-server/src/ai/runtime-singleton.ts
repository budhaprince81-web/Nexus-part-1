/**
 * Process-wide agent runtime instance wired to the real database, the real
 * provider engine and the real sandbox executor.
 */

import { createAgentRuntime, type AgentRuntime } from "./agent-runtime.ts";
import { createDrizzleRunStore } from "./agent-store.ts";
import { executeSandbox } from "../lib/sandbox-exec.ts";
import { logNexusEvent } from "../routes/nexus/logs";

let runtime: AgentRuntime | null = null;

export function getAgentRuntime(): AgentRuntime {
  if (!runtime) {
    runtime = createAgentRuntime({
      store: createDrizzleRunStore(),
      runSandbox: (input) => executeSandbox(input),
      log: (event) => {
        void logNexusEvent(event.level, event.message, "agents", event.meta).catch(() => undefined);
      },
    });
  }
  return runtime;
}
