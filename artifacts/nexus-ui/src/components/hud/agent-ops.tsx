import React, { useState } from 'react';
import { CyberPanel, CyberBadge, CyberButton } from '@/components/ui/cyber';
import { Network, Play, Pause, XCircle, Loader2, CheckCircle2, AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  controlRun,
  startAgentRun,
  useAgentRuns,
  type AgentRun,
} from '@/hooks/use-agent-runs';

const VARIANT: Record<string, 'info' | 'warning' | 'danger' | 'success'> = {
  planning: 'info',
  running: 'info',
  awaiting_approval: 'warning',
  paused: 'warning',
  completed: 'success',
  failed: 'danger',
  blocked: 'danger',
  cancelled: 'danger',
};

const ACTIVE = ['planning', 'running', 'awaiting_approval', 'paused'];

/**
 * Task control for the autonomous engine.
 *
 * Launch a goal, watch it move through UNDERSTAND → PLAN → EXECUTE → VERIFY →
 * REPORT, and pause, resume or cancel it. Every status shown comes from the
 * persisted run record — nothing here is inferred or fabricated.
 */
export function AgentOpsPanel() {
  const { runs, refresh } = useAgentRuns('nexus', 6);
  const [goal, setGoal] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [openRun, setOpenRun] = useState<string | null>(null);

  const active = runs.filter((run) => ACTIVE.includes(run.status));

  const launch = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!goal.trim() || busy) return;
    setBusy(true);
    setNotice(null);
    try {
      const run = await startAgentRun(goal.trim());
      setGoal('');
      setNotice(`Run ${run.id.slice(0, 8)} accepted — planning.`);
      setOpenRun(run.id);
      await refresh();
    } catch (err) {
      setNotice(err instanceof Error ? err.message : 'Could not start the run');
    } finally {
      setBusy(false);
    }
  };

  const control = async (run: AgentRun, action: 'pause' | 'resume' | 'cancel') => {
    await controlRun(run.id, action).catch(() => undefined);
    await refresh();
  };

  const stepIcon = (status: string) => {
    if (status === 'completed') return <CheckCircle2 className="w-3 h-3 text-emerald-400" />;
    if (status === 'blocked' || status === 'failed') return <AlertTriangle className="w-3 h-3 text-destructive" />;
    if (status === 'running') return <Loader2 className="w-3 h-3 text-primary animate-spin" />;
    if (status === 'awaiting_approval') return <AlertTriangle className="w-3 h-3 text-amber-400" />;
    return <span className="w-3 h-3 inline-block text-center text-primary/30">·</span>;
  };

  return (
    <CyberPanel className="flex flex-col gap-3">
      <div className="flex items-center justify-between border-b border-primary/20 pb-2">
        <div className="flex items-center gap-2">
          <Network className="w-4 h-4 text-primary" />
          <h3 className="font-mono text-xs uppercase tracking-widest text-primary">Agent Ops</h3>
        </div>
        <CyberBadge variant={active.length ? 'info' : 'success'}>
          {active.length} active
        </CyberBadge>
      </div>

      <form onSubmit={launch} className="flex gap-2">
        <input
          value={goal}
          onChange={(event) => setGoal(event.target.value)}
          placeholder="Give NEXUS a goal to plan and execute…"
          aria-label="Goal for the autonomous agent"
          className="flex-1 bg-background/50 border border-primary/20 px-2 py-1.5 font-mono text-[11px] text-primary placeholder:text-primary/25 focus:outline-none focus:border-primary"
        />
        <CyberButton type="submit" disabled={busy || !goal.trim()} className="px-2 py-1 text-[10px]">
          {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />}
        </CyberButton>
      </form>

      {notice && (
        <div className="font-mono text-[9px] text-primary/60 break-words">{notice}</div>
      )}

      <div className="flex flex-col gap-1.5 max-h-56 overflow-y-auto custom-scrollbar">
        {runs.length === 0 && (
          <div className="font-mono text-[10px] text-primary/30 uppercase">No runs yet.</div>
        )}
        {runs.map((run) => (
          <div key={run.id} className="border border-primary/10 hover:border-primary/30 transition-colors">
            <div className="flex items-center gap-2 px-2 py-1.5">
              <button
                onClick={() => setOpenRun(openRun === run.id ? null : run.id)}
                className="font-mono text-[10px] text-primary/80 truncate text-left flex-1"
                title={run.goal}
              >
                {run.goal}
              </button>
              <CyberBadge variant={VARIANT[run.status] ?? 'info'}>
                {run.status.replace(/_/g, ' ')}
              </CyberBadge>
              <div className="flex items-center gap-1 shrink-0">
                {(run.status === 'running' || run.status === 'planning') && (
                  <button
                    onClick={() => void control(run, 'pause')}
                    className="text-primary/40 hover:text-primary"
                    aria-label="Pause run"
                  >
                    <Pause className="w-3 h-3" />
                  </button>
                )}
                {run.status === 'paused' && (
                  <button
                    onClick={() => void control(run, 'resume')}
                    className="text-primary/40 hover:text-primary"
                    aria-label="Resume run"
                  >
                    <Play className="w-3 h-3" />
                  </button>
                )}
                {ACTIVE.includes(run.status) && (
                  <button
                    onClick={() => void control(run, 'cancel')}
                    className="text-primary/40 hover:text-destructive"
                    aria-label="Cancel run"
                  >
                    <XCircle className="w-3 h-3" />
                  </button>
                )}
              </div>
            </div>

            {openRun === run.id && (
              <div className="border-t border-primary/10 px-2 py-1.5 flex flex-col gap-1">
                {run.steps.length === 0 && (
                  <div className="font-mono text-[9px] text-primary/40 animate-pulse">
                    Planning…
                  </div>
                )}
                {run.steps.map((step) => (
                  <div key={step.id} className="flex items-start gap-2 font-mono text-[9px]">
                    <span className="mt-0.5">{stepIcon(step.status)}</span>
                    <div className="flex-1 min-w-0">
                      <div className="text-primary/70 truncate">
                        <span className="text-primary/40">{step.agent}</span> · {step.description}
                      </div>
                      {step.verification && !step.verification.satisfied && (
                        <div className="text-amber-400/80 truncate">
                          verification: {step.verification.note}
                        </div>
                      )}
                      {step.error && <div className="text-destructive/80 truncate">{step.error}</div>}
                    </div>
                    <span className="text-primary/30 uppercase shrink-0">{step.status}</span>
                  </div>
                ))}
                {run.error && (
                  <div className="font-mono text-[9px] text-destructive break-words">{run.error}</div>
                )}
                {run.result && (
                  <div className="font-mono text-[9px] text-primary/50 whitespace-pre-wrap max-h-32 overflow-y-auto custom-scrollbar border-t border-primary/10 pt-1">
                    {run.result}
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="font-mono text-[9px] text-primary/30 border-t border-primary/10 pt-1.5">
        Consequential steps pause for your approval in the Action Queue.
      </div>
    </CyberPanel>
  );
}
