import React, { useState } from 'react';
import { CyberPanel, CyberButton, CyberBadge } from '@/components/ui/cyber';
import { Network, ArrowRight, Activity, GitCommit } from 'lucide-react';
import { 
  useGetAgentStatus, getGetAgentStatusQueryKey,
  useCreateAgentPlan
} from '@workspace/api-client-react';

export default function Agents() {
  const { data: agents } = useGetAgentStatus({ query: { refetchInterval: 5000, queryKey: getGetAgentStatusQueryKey() } });
  const [task, setTask] = useState('');
  const createPlan = useCreateAgentPlan();

  const handlePlan = (e: React.FormEvent) => {
    e.preventDefault();
    if (!task.trim()) return;
    createPlan.mutate({ data: { task } });
  };

  return (
    <div className="h-full flex flex-col gap-6">
      <CyberPanel className="shrink-0 flex items-center gap-4">
        <Network className="w-8 h-8 text-primary" />
        <div>
          <h2 className="font-mono text-xl text-primary tracking-widest uppercase">Agent Swarm Array</h2>
          <p className="font-mono text-xs text-primary/50 uppercase">Coordinating autonomous sub-routines</p>
        </div>
      </CyberPanel>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 shrink-0">
        {agents?.map(agent => (
          <CyberPanel key={agent.name} className="flex flex-col gap-4">
            <div className="flex justify-between items-center border-b border-primary/20 pb-2">
              <span className="font-mono font-bold tracking-wider text-primary uppercase">{agent.name}</span>
              <CyberBadge variant={agent.status === 'active' ? 'info' : agent.status === 'error' ? 'danger' : 'warning'}>
                {agent.status}
              </CyberBadge>
            </div>
            <div className="grid grid-cols-2 gap-2 text-xs font-mono uppercase text-primary/70">
              <div>
                <span className="opacity-50 block mb-1">Tasks Done</span>
                <span className="text-primary text-lg font-bold">{agent.tasksCompleted}</span>
              </div>
              <div>
                <span className="opacity-50 block mb-1">Last Active</span>
                <span className="text-primary">{agent.lastActive ? new Date(agent.lastActive).toLocaleTimeString() : 'N/A'}</span>
              </div>
            </div>
          </CyberPanel>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 flex-1 min-h-[400px]">
        <CyberPanel className="flex flex-col">
          <div className="mb-4 border-b border-primary/20 pb-2 flex items-center gap-2 shrink-0">
            <Activity className="w-4 h-4 text-primary" />
            <h3 className="font-mono text-sm tracking-widest uppercase text-primary">Strategic Planner</h3>
          </div>
          <form onSubmit={handlePlan} className="flex flex-col gap-4 flex-1 relative z-10">
            <textarea 
              className="flex-1 w-full bg-background/50 border border-primary/20 p-4 text-primary font-mono text-sm focus:outline-none focus:border-primary resize-none custom-scrollbar focus:shadow-[0_0_10px_rgba(0,212,255,0.2)] transition-all"
              placeholder="DESCRIBE OBJECTIVE IN DETAIL..."
              value={task}
              onChange={e => setTask(e.target.value)}
            />
            <CyberButton type="submit" disabled={createPlan.isPending || !task.trim()} className="h-12 shrink-0">
              {createPlan.isPending ? 'COMPUTING PLAN...' : 'GENERATE EXECUTION DAG'}
            </CyberButton>
          </form>
        </CyberPanel>

        <CyberPanel className="flex flex-col overflow-hidden">
          <div className="mb-4 border-b border-primary/20 pb-2 flex items-center gap-2 shrink-0">
            <GitCommit className="w-4 h-4 text-primary" />
            <h3 className="font-mono text-sm tracking-widest uppercase text-primary">Execution Graph</h3>
          </div>
          <div className="flex-1 overflow-y-auto custom-scrollbar flex flex-col gap-4 p-2 relative z-10">
            {!createPlan.data && !createPlan.isPending && (
              <div className="m-auto text-primary/40 font-mono text-sm uppercase text-center flex flex-col items-center gap-4">
                <Network className="w-12 h-12 opacity-20" />
                Awaiting objective parameters.
              </div>
            )}
            {createPlan.isPending && (
              <div className="m-auto text-primary animate-pulse font-mono uppercase flex flex-col items-center gap-4">
                <span className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin"></span>
                Synthesizing Steps...
              </div>
            )}
            {createPlan.data?.steps.map((step, idx) => (
              <div key={step.id} className="flex gap-4 items-start relative group">
                {idx !== createPlan.data.steps.length - 1 && (
                  <div className="absolute left-3.5 top-8 bottom-[-16px] w-px bg-primary/30" />
                )}
                <div className="w-7 h-7 rounded-full border border-primary flex items-center justify-center shrink-0 bg-background relative z-10 text-xs font-mono text-primary shadow-[0_0_8px_rgba(0,212,255,0.3)]">
                  {idx + 1}
                </div>
                <div className="flex-1 border border-primary/20 bg-primary/5 p-3 group-hover:border-primary/50 transition-colors cyber-panel shadow-none">
                  <div className="flex flex-wrap gap-2 justify-between items-center mb-2">
                    <CyberBadge variant="info">{step.agent}</CyberBadge>
                    <span className="text-[10px] font-mono text-primary/50 uppercase tracking-widest">{step.status}</span>
                  </div>
                  <div className="font-mono text-sm text-primary/90">{step.description}</div>
                  {step.dependsOn && step.dependsOn.length > 0 && (
                    <div className="mt-3 pt-2 border-t border-primary/10 flex flex-wrap items-center gap-2 text-xs font-mono text-primary/50">
                      <ArrowRight className="w-3 h-3 shrink-0" /> Requires: 
                      {step.dependsOn.map(dep => (
                        <span key={dep} className="text-primary/70">{dep}</span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </CyberPanel>
      </div>
    </div>
  );
}