import React, { useState } from 'react';
import { CyberPanel, CyberBadge, CyberButton } from '@/components/ui/cyber';
import { Bot, Send, ShieldCheck, Pause, Play, XCircle, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  assignJarvisTask,
  controlRun,
  useAgentRuns,
  useJarvisStatus,
  verifyJarvisTask,
  type AgentRun,
} from '@/hooks/use-agent-runs';

const STATUS_VARIANT: Record<string, 'info' | 'warning' | 'danger' | 'success'> = {
  planning: 'info',
  running: 'info',
  awaiting_approval: 'warning',
  paused: 'warning',
  completed: 'success',
  failed: 'danger',
  blocked: 'danger',
  cancelled: 'danger',
};

function StatusBadge({ status }: { status: string }) {
  return (
    <CyberBadge variant={STATUS_VARIANT[status] ?? 'info'}>{status.replace(/_/g, ' ')}</CyberBadge>
  );
}

/**
 * JARVIS — the subordinate assistant.
 *
 * NEXUS (here, the operator) hands JARVIS a validated task; JARVIS plans and
 * executes it through the same runtime and reports back. NEXUS can then verify
 * JARVIS's result with an independent model call.
 */
export function JarvisPanel() {
  const { runs, refresh } = useAgentRuns('jarvis', 6);
  const status = useJarvisStatus(6000);
  const [task, setTask] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!task.trim() || busy) return;
    setBusy(true);
    setNotice(null);
    try {
      const run = await assignJarvisTask(task.trim());
      setTask('');
      setNotice(`Task delegated to JARVIS · ${run.id.slice(0, 8)}`);
      await refresh();
    } catch (err) {
      setNotice(err instanceof Error ? err.message : 'Delegation failed');
    } finally {
      setBusy(false);
    }
  };

  const control = async (run: AgentRun, action: 'pause' | 'resume' | 'cancel') => {
    await controlRun(run.id, action).catch(() => undefined);
    await refresh();
  };

  const verify = async (run: AgentRun) => {
    setNotice(`NEXUS is verifying JARVIS task ${run.id.slice(0, 8)}…`);
    try {
      const result = await verifyJarvisTask(run.id);
      setNotice(`NEXUS verification: ${result.verdict.toUpperCase()} — ${result.notes.slice(0, 160)}`);
    } catch (err) {
      setNotice(err instanceof Error ? err.message : 'Verification failed');
    } finally {
      await refresh();
    }
  };

  return (
    <CyberPanel className="flex flex-col gap-3">
      <div className="flex items-center justify-between border-b border-primary/20 pb-2">
        <div className="flex items-center gap-2">
          <Bot className="w-4 h-4 text-secondary" />
          <h3 className="font-mono text-xs uppercase tracking-widest text-secondary">JARVIS</h3>
        </div>
        <div className="flex items-center gap-2">
          {status && (
            <span className="font-mono text-[9px] text-primary/40 uppercase">
              {status.activeTasks} active · {status.completedTasks} done · {status.failedTasks} failed
            </span>
          )}
          <span
            className={cn(
              'w-2 h-2 rounded-full',
              status?.activeTasks ? 'bg-emerald-400 animate-pulse' : 'bg-primary/25',
            )}
          />
        </div>
      </div>

      <form onSubmit={submit} className="flex gap-2">
        <input
          value={task}
          onChange={(event) => setTask(event.target.value)}
          placeholder="Delegate a task to JARVIS…"
          aria-label="Task to delegate to JARVIS"
          className="flex-1 bg-background/50 border border-primary/20 px-2 py-1.5 font-mono text-[11px] text-primary placeholder:text-primary/25 focus:outline-none focus:border-secondary"
        />
        <CyberButton type="submit" disabled={busy || !task.trim()} className="px-2 py-1 text-[10px]">
          {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />}
        </CyberButton>
      </form>

      {notice && (
        <div className="font-mono text-[9px] text-primary/60 leading-relaxed break-words">{notice}</div>
      )}

      <div className="flex flex-col gap-1.5 max-h-52 overflow-y-auto custom-scrollbar">
        {runs.length === 0 && (
          <div className="font-mono text-[10px] text-primary/30 uppercase">
            No tasks delegated yet.
          </div>
        )}
        {runs.map((run) => (
          <div key={run.id} className="border border-secondary/15 hover:border-secondary/35 transition-colors">
            <div className="flex items-center justify-between gap-2 px-2 py-1.5">
              <button
                onClick={() => setExpanded(expanded === run.id ? null : run.id)}
                className="font-mono text-[10px] text-primary/80 truncate text-left flex-1"
                title={run.goal}
              >
                {run.goal}
              </button>
              <StatusBadge status={run.status} />
              <div className="flex items-center gap-1 shrink-0">
                {(run.status === 'running' || run.status === 'planning') && (
                  <button
                    onClick={() => void control(run, 'pause')}
                    className="text-primary/40 hover:text-primary"
                    aria-label="Pause task"
                  >
                    <Pause className="w-3 h-3" />
                  </button>
                )}
                {run.status === 'paused' && (
                  <button
                    onClick={() => void control(run, 'resume')}
                    className="text-primary/40 hover:text-primary"
                    aria-label="Resume task"
                  >
                    <Play className="w-3 h-3" />
                  </button>
                )}
                {run.result && (
                  <button
                    onClick={() => void verify(run)}
                    className="text-primary/40 hover:text-emerald-400"
                    aria-label="Verify result with NEXUS"
                    title="NEXUS verifies this result"
                  >
                    <ShieldCheck className="w-3 h-3" />
                  </button>
                )}
                {!['completed', 'failed', 'cancelled', 'blocked'].includes(run.status) && (
                  <button
                    onClick={() => void control(run, 'cancel')}
                    className="text-primary/40 hover:text-destructive"
                    aria-label="Cancel task"
                  >
                    <XCircle className="w-3 h-3" />
                  </button>
                )}
              </div>
            </div>
            {expanded === run.id && (
              <div className="border-t border-secondary/10 px-2 py-1.5 font-mono text-[9px] text-primary/50 whitespace-pre-wrap max-h-40 overflow-y-auto custom-scrollbar">
                {run.steps.length > 0 && (
                  <div className="mb-1 text-primary/40">
                    {run.steps
                      .map((step) => `${step.status === 'completed' ? '✓' : '·'} ${step.agent}`)
                      .join('  ')}
                  </div>
                )}
                {run.result ?? run.error ?? 'Working…'}
              </div>
            )}
          </div>
        ))}
      </div>
    </CyberPanel>
  );
}
