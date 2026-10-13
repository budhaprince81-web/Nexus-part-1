import { useCallback, useEffect, useRef, useState } from 'react';
import { apiGet, apiPost } from '@/lib/api';

export type RunStatus =
  | 'planning'
  | 'running'
  | 'awaiting_approval'
  | 'paused'
  | 'completed'
  | 'failed'
  | 'blocked'
  | 'cancelled';

export interface RunStep {
  id: string;
  agent: string;
  description: string;
  tool: string;
  status: string;
  output: string | null;
  verification: { satisfied: boolean; note: string } | null;
  attempts: number;
  consequential: boolean;
  error: string | null;
}

export interface AgentRun {
  id: string;
  kind: 'nexus' | 'jarvis';
  goal: string;
  status: RunStatus;
  control: string;
  steps: RunStep[];
  result: string | null;
  error: string | null;
  provider: string | null;
  model: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

export interface JarvisStatus {
  name: string;
  capability: string;
  totalTasks: number;
  activeTasks: number;
  completedTasks: number;
  failedTasks: number;
  currentTask: { id: string; goal: string; status: string } | null;
  lastUpdated: string | null;
}

const ACTIVE: RunStatus[] = ['planning', 'running', 'awaiting_approval', 'paused'];

/** Polls a list of runs; polling speeds up while anything is still active. */
export function useAgentRuns(kind: 'nexus' | 'jarvis', limit = 10, enabled = true) {
  const [runs, setRuns] = useState<AgentRun[]>([]);
  const [error, setError] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    if (!enabled) return [] as AgentRun[];
    try {
      const rows = await apiGet<AgentRun[]>(`/api/nexus/agents/runs?kind=${kind}&limit=${limit}`);
      setRuns(rows);
      setError(null);
      return rows;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load runs');
      return [] as AgentRun[];
    }
  }, [enabled, kind, limit]);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;

    const tick = async () => {
      const rows = await load();
      if (cancelled) return;
      const active = rows.some((run) => ACTIVE.includes(run.status));
      timerRef.current = setTimeout(() => void tick(), active ? 1500 : 6000);
    };

    void tick();
    return () => {
      cancelled = true;
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [enabled, load]);

  return { runs, error, refresh: load };
}

export function startAgentRun(goal: string, context?: string): Promise<AgentRun> {
  return apiPost<AgentRun>('/api/nexus/agents/run', { goal, context });
}

export function controlRun(
  id: string,
  action: 'pause' | 'resume' | 'cancel',
): Promise<AgentRun> {
  return apiPost<AgentRun>(`/api/nexus/agents/runs/${id}/${action}`);
}

export function assignJarvisTask(task: string): Promise<AgentRun> {
  return apiPost<AgentRun>('/api/nexus/jarvis/assign', { task });
}

export function fetchJarvisStatus(): Promise<JarvisStatus> {
  return apiGet<JarvisStatus>('/api/nexus/jarvis/status');
}

export function verifyJarvisTask(
  id: string,
): Promise<{ taskId: string; verdict: string; notes: string; provider: string; model: string }> {
  return apiPost(`/api/nexus/jarvis/tasks/${id}/verify`, {}, 60000);
}

export function useJarvisStatus(pollMs = 5000) {
  const [status, setStatus] = useState<JarvisStatus | null>(null);

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const payload = await fetchJarvisStatus();
        if (!cancelled) setStatus(payload);
      } catch {
        // JARVIS status is advisory; a failure must not break the dashboard.
      }
      if (!cancelled) setTimeout(() => void tick(), pollMs);
    };
    void tick();
    return () => {
      cancelled = true;
    };
  }, [pollMs]);

  return status;
}
