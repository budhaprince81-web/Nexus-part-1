import React, { useState } from 'react';
import { CyberPanel, CyberButton, CyberBadge, CyberInput } from '@/components/ui/cyber';
import { motion, AnimatePresence } from 'framer-motion';
import { CheckSquare, Plus, Trash2, CheckCircle, Clock, AlertTriangle, Zap, Tag, X, Calendar } from 'lucide-react';
import {
  useListTasks, getListTasksQueryKey,
  useCreateTask, useUpdateTask, useDeleteTask,
  useGetTaskStats, getGetTaskStatsQueryKey,
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { cn } from '@/lib/utils';
import { useLangContext } from '@/hooks/use-language';

type Priority = 'low' | 'medium' | 'high' | 'critical';
type Status = 'pending' | 'in_progress' | 'completed' | 'cancelled';

const priorityConfig: Record<Priority, { label: string; color: string; bg: string }> = {
  low:      { label: 'Low',      color: 'text-primary/60',   bg: 'border-primary/20 bg-primary/5' },
  medium:   { label: 'Medium',   color: 'text-amber-400',    bg: 'border-amber-400/30 bg-amber-400/5' },
  high:     { label: 'High',     color: 'text-orange-400',   bg: 'border-orange-400/30 bg-orange-400/5' },
  critical: { label: 'Critical', color: 'text-red-400',      bg: 'border-red-400/40 bg-red-400/8' },
};

const statusConfig: Record<Status, { label: string; icon: React.ReactNode; color: string }> = {
  pending:     { label: 'Pending',     icon: <Clock className="w-3 h-3" />,        color: 'text-primary/60' },
  in_progress: { label: 'In Progress', icon: <Zap className="w-3 h-3" />,          color: 'text-amber-400' },
  completed:   { label: 'Completed',   icon: <CheckCircle className="w-3 h-3" />,  color: 'text-emerald-400' },
  cancelled:   { label: 'Cancelled',   icon: <X className="w-3 h-3" />,            color: 'text-primary/30' },
};

export default function Tasks() {
  const qc = useQueryClient();
  const { t } = useLangContext();
  const [showAdd, setShowAdd] = useState(false);
  const [filter, setFilter] = useState<Status | 'all'>('all');
  const [search, setSearch] = useState('');

  // Form state
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState<Priority>('medium');
  const [tagInput, setTagInput] = useState('');
  const [dueDate, setDueDate] = useState('');

  const { data: tasks = [] } = useListTasks(
    { status: filter !== 'all' ? filter : undefined, q: search || undefined },
    { query: { refetchInterval: 5000, queryKey: getListTasksQueryKey({ status: filter !== 'all' ? filter : undefined, q: search || undefined }) } }
  );

  const { data: stats } = useGetTaskStats({ query: { refetchInterval: 10000, queryKey: getGetTaskStatsQueryKey() } });

  const createTask = useCreateTask();
  const updateTask = useUpdateTask();
  const deleteTask = useDeleteTask();

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['listTasks'] });
    qc.invalidateQueries({ queryKey: getGetTaskStatsQueryKey() });
  };

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    const tags = tagInput.split(',').map(t => t.trim()).filter(Boolean);
    createTask.mutate(
      { data: { title, description: description || undefined, priority, tags, dueDate: dueDate || undefined } },
      { onSuccess: () => { setTitle(''); setDescription(''); setPriority('medium'); setTagInput(''); setDueDate(''); setShowAdd(false); invalidate(); } }
    );
  };

  const handleStatus = (id: string, status: Status) => {
    updateTask.mutate({ id, data: { status } }, { onSuccess: invalidate });
  };

  const handleDelete = (id: string) => {
    deleteTask.mutate({ id }, { onSuccess: invalidate });
  };

  const statCards = [
    { label: 'Total',       value: stats?.total || 0,       color: 'text-primary' },
    { label: 'Pending',     value: stats?.pending || 0,      color: 'text-primary/60' },
    { label: 'In Progress', value: stats?.in_progress || 0,  color: 'text-amber-400' },
    { label: 'Completed',   value: stats?.completed || 0,    color: 'text-emerald-400' },
    { label: 'Overdue',     value: stats?.overdue || 0,      color: 'text-red-400' },
    { label: 'Critical',    value: stats?.critical || 0,     color: 'text-red-400' },
  ];

  return (
    <div className="h-full flex flex-col gap-4">
      {/* Stats row */}
      <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 shrink-0">
        {statCards.map(({ label, value, color }) => (
          <CyberPanel key={label} className="flex flex-col items-center py-3 px-2">
            <div className={`text-2xl font-bold font-mono ${color}`}>{value}</div>
            <div className="text-[9px] font-mono uppercase tracking-wider text-primary/50 mt-0.5">{label}</div>
          </CyberPanel>
        ))}
      </div>

      {/* Controls */}
      <CyberPanel className="shrink-0 flex flex-col sm:flex-row items-start sm:items-center gap-3">
        <div className="flex items-center gap-2">
          <CheckSquare className="w-5 h-5 text-primary" />
          <h2 className="font-mono text-sm text-primary uppercase tracking-widest">Task Manager</h2>
        </div>
        <div className="flex flex-wrap gap-1.5 sm:ml-4">
          {(['all', 'pending', 'in_progress', 'completed', 'cancelled'] as const).map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={cn(
                "font-mono text-[10px] uppercase px-2 py-1 border tracking-wider transition-all",
                filter === f ? 'border-primary bg-primary/10 text-primary' : 'border-primary/20 text-primary/40 hover:border-primary/50'
              )}
            >
              {f === 'all' ? 'All' : f.replace('_', ' ')}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2 sm:ml-auto w-full sm:w-auto">
          <CyberInput
            placeholder="Search tasks..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="h-8 text-xs flex-1 sm:w-40"
          />
          <CyberButton onClick={() => setShowAdd(p => !p)} className="h-8 px-3 text-xs shrink-0">
            <Plus className="w-4 h-4 sm:mr-1" /><span className="hidden sm:inline">New Task</span>
          </CyberButton>
        </div>
      </CyberPanel>

      {/* Add task form */}
      <AnimatePresence>
        {showAdd && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="shrink-0"
          >
            <CyberPanel className="border-primary/40">
              <form onSubmit={handleCreate} className="flex flex-col gap-3">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="sm:col-span-2">
                    <label className="text-[10px] font-mono text-primary/50 uppercase block mb-1">Title *</label>
                    <CyberInput value={title} onChange={e => setTitle(e.target.value)} required placeholder="Task title..." className="h-9" />
                  </div>
                  <div className="sm:col-span-2">
                    <label className="text-[10px] font-mono text-primary/50 uppercase block mb-1">Description</label>
                    <textarea
                      value={description}
                      onChange={e => setDescription(e.target.value)}
                      placeholder="Optional description..."
                      className="w-full h-16 bg-background/50 border border-primary/20 px-3 py-2 text-primary font-mono text-xs focus:outline-none focus:border-primary resize-none"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-mono text-primary/50 uppercase block mb-1">Priority</label>
                    <select
                      value={priority}
                      onChange={e => setPriority(e.target.value as Priority)}
                      className="w-full h-9 bg-background border border-primary/20 text-primary font-mono text-xs px-3 outline-none uppercase cursor-pointer hover:border-primary transition-all"
                    >
                      <option value="low">Low</option>
                      <option value="medium">Medium</option>
                      <option value="high">High</option>
                      <option value="critical">Critical</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-[10px] font-mono text-primary/50 uppercase block mb-1">Due Date</label>
                    <CyberInput type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} className="h-9" />
                  </div>
                  <div className="sm:col-span-2">
                    <label className="text-[10px] font-mono text-primary/50 uppercase block mb-1">Tags (comma separated)</label>
                    <CyberInput value={tagInput} onChange={e => setTagInput(e.target.value)} placeholder="design, backend, urgent" className="h-9" />
                  </div>
                </div>
                <div className="flex gap-2 justify-end">
                  <CyberButton type="button" variant="ghost" onClick={() => setShowAdd(false)} className="text-xs py-1.5">Cancel</CyberButton>
                  <CyberButton type="submit" disabled={createTask.isPending} className="text-xs py-1.5">
                    {createTask.isPending ? 'Creating...' : 'Create Task'}
                  </CyberButton>
                </div>
              </form>
            </CyberPanel>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Task list */}
      <CyberPanel className="flex-1 overflow-hidden flex flex-col">
        <div className="flex-1 overflow-y-auto custom-scrollbar">
          <AnimatePresence>
            {tasks.length === 0 && (
              <div className="h-48 flex flex-col items-center justify-center text-primary/30 font-mono text-xs uppercase gap-3">
                <CheckSquare className="w-10 h-10 opacity-20" />
                No tasks found. Create one to get started.
              </div>
            )}
            {tasks.map(task => {
              const pCfg = priorityConfig[task.priority as Priority] || priorityConfig.medium;
              const sCfg = statusConfig[task.status as Status] || statusConfig.pending;
              const isOverdue = task.dueDate && new Date(task.dueDate) < new Date() && task.status !== 'completed';

              return (
                <motion.div
                  key={task.id}
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, height: 0 }}
                  className={cn(
                    "flex items-start gap-3 p-3 border-b border-primary/5 hover:bg-primary/3 transition-colors group relative",
                    task.status === 'completed' && "opacity-50",
                    isOverdue && "border-l-2 border-l-red-400/60"
                  )}
                >
                  {/* Priority accent */}
                  <div className={cn("shrink-0 mt-1", pCfg.color)}>
                    <AlertTriangle className="w-3.5 h-3.5" />
                  </div>

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={cn("font-mono text-sm font-medium", task.status === 'completed' ? 'line-through text-primary/40' : 'text-primary/90')}>
                        {task.title}
                      </span>
                      <CyberBadge variant={task.priority === 'critical' ? 'danger' : task.priority === 'high' ? 'warning' : 'info'} className="py-0 text-[9px]">
                        {pCfg.label}
                      </CyberBadge>
                      {isOverdue && <CyberBadge variant="danger" className="py-0 text-[9px]">OVERDUE</CyberBadge>}
                    </div>
                    {task.description && (
                      <div className="font-mono text-[11px] text-primary/50 mt-0.5 truncate">{task.description}</div>
                    )}
                    <div className="flex items-center gap-3 mt-1.5 flex-wrap">
                      <div className={cn("flex items-center gap-1 font-mono text-[10px]", sCfg.color)}>
                        {sCfg.icon} {sCfg.label}
                      </div>
                      {task.dueDate && (
                        <div className="flex items-center gap-1 font-mono text-[10px] text-primary/40">
                          <Calendar className="w-3 h-3" />
                          {new Date(task.dueDate).toLocaleDateString()}
                        </div>
                      )}
                      {task.tags.map(tag => (
                        <span key={tag} className="flex items-center gap-0.5 font-mono text-[9px] text-primary/40 border border-primary/15 px-1 py-0.5">
                          <Tag className="w-2 h-2" />{tag}
                        </span>
                      ))}
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                    {task.status !== 'completed' && (
                      <button
                        onClick={() => handleStatus(task.id, task.status === 'pending' ? 'in_progress' : 'completed')}
                        className="w-6 h-6 border border-emerald-400/30 text-emerald-400/50 hover:text-emerald-400 hover:border-emerald-400 transition-colors flex items-center justify-center"
                        title={task.status === 'pending' ? 'Start' : 'Complete'}
                      >
                        {task.status === 'pending' ? <Zap className="w-3 h-3" /> : <CheckCircle className="w-3 h-3" />}
                      </button>
                    )}
                    <button
                      onClick={() => handleDelete(task.id)}
                      className="w-6 h-6 border border-destructive/30 text-destructive/40 hover:text-destructive hover:border-destructive transition-colors flex items-center justify-center"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                </motion.div>
              );
            })}
          </AnimatePresence>
        </div>
      </CyberPanel>
    </div>
  );
}
