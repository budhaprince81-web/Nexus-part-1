import React, { useState, useRef, useEffect } from 'react';
import { CyberPanel, CyberButton, CyberBadge } from '@/components/ui/cyber';
import { motion, AnimatePresence } from 'framer-motion';
import { Code, Play, FolderOpen, FileCode, ChevronRight, Download, Copy, CheckCircle, Zap, GitBranch } from 'lucide-react';
import { ThinkingIndicator } from '@/components/hud/thinking';
import { useListCodingSessions, getListCodingSessionsQueryKey, useGetCodingSession } from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { cn } from '@/lib/utils';

interface CodingFile {
  path: string;
  content: string;
  language: string;
}

interface StreamEvent {
  type: 'thinking' | 'progress' | 'file' | 'done' | 'error' | 'instructions';
  message?: string;
  path?: string;
  content?: string;
  language?: string;
  size?: number;
  sessionId?: string;
  projectName?: string;
  totalFiles?: number;
  chars?: number;
}

const LANGUAGE_COLORS: Record<string, string> = {
  typescript: 'text-blue-400',
  javascript: 'text-yellow-400',
  python: 'text-green-400',
  rust: 'text-orange-400',
  go: 'text-cyan-400',
  java: 'text-red-400',
  kotlin: 'text-violet-400',
  css: 'text-pink-400',
  html: 'text-orange-300',
  json: 'text-amber-400',
  yaml: 'text-emerald-400',
  markdown: 'text-primary/70',
  bash: 'text-emerald-300',
  shell: 'text-emerald-300',
  sql: 'text-cyan-300',
  default: 'text-primary/60',
};

const EXAMPLE_PROJECTS = [
  { label: 'REST API',    prompt: 'Build a REST API with TypeScript, Express, and PostgreSQL. Include CRUD operations for a blog system with posts, comments, and users. Add JWT authentication, input validation, error handling, and OpenAPI documentation.' },
  { label: 'React App',  prompt: 'Build a React TypeScript todo application with a beautiful UI. Include: add/edit/delete todos, priority levels, due dates, tags, local storage persistence, dark mode, and animations.' },
  { label: 'Python Bot', prompt: 'Build a Python Discord bot with slash commands. Include: fun commands (8ball, roll dice), moderation (kick/ban), utility (weather, define word), and a simple economy system.' },
  { label: 'CLI Tool',   prompt: 'Build a TypeScript CLI tool for managing environment variables across projects. Support create/read/update/delete, multiple profiles (dev/staging/prod), encryption, and .env file sync.' },
  { label: 'Next.js',   prompt: 'Build a Next.js 14 app with App Router, Tailwind CSS, and Prisma ORM. Create a portfolio website with a blog system, project showcase, contact form, and dark mode.' },
  { label: 'Flutter',   prompt: 'Build a Flutter mobile app for expense tracking. Include: add expenses with categories, monthly budget goals, charts, recurring expenses, and local SQLite storage.' },
];

export default function Coding() {
  const qc = useQueryClient();
  const [requirement, setRequirement] = useState('');
  const [language, setLanguage] = useState('');
  const [framework, setFramework] = useState('');
  const [projectName, setProjectName] = useState('');
  const [style, setStyle] = useState<'minimal' | 'production' | 'enterprise'>('production');
  const [isBuilding, setIsBuilding] = useState(false);
  const [events, setEvents] = useState<StreamEvent[]>([]);
  const [files, setFiles] = useState<CodingFile[]>([]);
  const [selectedFile, setSelectedFile] = useState<CodingFile | null>(null);
  const [copied, setCopied] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [selectedSession, setSelectedSession] = useState<string | null>(null);
  const eventsEndRef = useRef<HTMLDivElement>(null);

  const { data: sessions = [] } = useListCodingSessions({ query: { refetchInterval: 10000, queryKey: getListCodingSessionsQueryKey() } });
  const { data: sessionData } = useGetCodingSession(
    selectedSession!,
    { query: { enabled: !!selectedSession, queryKey: ['getCodingSession', selectedSession] } }
  );

  // Load session files when selected
  useEffect(() => {
    if (sessionData && selectedSession) {
      const sessionFiles = (sessionData.files as CodingFile[]) || [];
      setFiles(sessionFiles);
      if (sessionFiles.length > 0) setSelectedFile(sessionFiles[0]);
    }
  }, [sessionData, selectedSession]);

  useEffect(() => {
    eventsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [events]);

  const handleBuild = async () => {
    if (!requirement.trim()) return;
    setIsBuilding(true);
    setEvents([]);
    setFiles([]);
    setSelectedFile(null);
    setSelectedSession(null);
    setSessionId(null);

    const addEvent = (e: StreamEvent) => setEvents(prev => [...prev, e]);

    try {
      const BASE = import.meta.env.BASE_URL.replace(/\/$/, '');
      const res = await fetch(`${BASE}/api/nexus/coding/build`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requirement, language, framework, projectName, style }),
      });

      if (!res.body) throw new Error('No response stream');

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      const collectedFiles: CodingFile[] = [];

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const text = decoder.decode(value);
        const lines = text.split('\n');
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          try {
            const event: StreamEvent = JSON.parse(line.slice(6));
            addEvent(event);

            if (event.type === 'file' && event.path && event.content !== undefined) {
              const file: CodingFile = { path: event.path, content: event.content, language: event.language || 'text' };
              collectedFiles.push(file);
              setFiles([...collectedFiles]);
              if (collectedFiles.length === 1) setSelectedFile(file);
            }
            if (event.type === 'done' && event.sessionId) {
              setSessionId(event.sessionId);
              qc.invalidateQueries({ queryKey: getListCodingSessionsQueryKey() });
            }
          } catch {}
        }
      }
    } catch (err) {
      addEvent({ type: 'error', message: err instanceof Error ? err.message : 'Build failed' });
    } finally {
      setIsBuilding(false);
    }
  };

  const handleCopy = () => {
    if (!selectedFile) return;
    navigator.clipboard.writeText(selectedFile.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownload = () => {
    if (!selectedFile) return;
    const blob = new Blob([selectedFile.content], { type: 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = selectedFile.path.split('/').pop() || 'file.txt';
    a.click();
  };

  const fileColor = (lang: string) => LANGUAGE_COLORS[lang?.toLowerCase()] || LANGUAGE_COLORS.default;

  return (
    <div className="h-full flex flex-col gap-4">
      {/* Header */}
      <CyberPanel className="shrink-0 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
        <div className="flex items-center gap-3">
          <Code className="w-7 h-7 text-primary" />
          <div>
            <h2 className="font-mono text-lg text-primary tracking-widest uppercase">Coding Agent</h2>
            <p className="font-mono text-[10px] text-primary/50 uppercase">"Build This" — Complete Project Generation</p>
          </div>
        </div>
        {files.length > 0 && (
          <CyberBadge variant="success">{files.length} FILES GENERATED</CyberBadge>
        )}
      </CyberPanel>

      <div className="flex-1 grid grid-cols-1 lg:grid-cols-5 gap-4 min-h-0">
        {/* Left: Input + Sessions */}
        <div className="lg:col-span-2 flex flex-col gap-3 overflow-hidden">
          {/* Build input */}
          <CyberPanel className="flex flex-col gap-3 shrink-0">
            <div className="text-primary/50 text-[10px] font-mono uppercase tracking-widest">Describe what to build</div>

            {/* Quick examples */}
            <div className="flex flex-wrap gap-1">
              {EXAMPLE_PROJECTS.map(ex => (
                <button
                  key={ex.label}
                  onClick={() => setRequirement(ex.prompt)}
                  className="font-mono text-[9px] border border-primary/20 text-primary/50 px-2 py-0.5 hover:border-primary hover:text-primary transition-all uppercase"
                >
                  {ex.label}
                </button>
              ))}
            </div>

            <textarea
              value={requirement}
              onChange={e => setRequirement(e.target.value)}
              placeholder="Describe what to build in detail... e.g. 'Build a REST API with TypeScript and Express for a todo app with authentication'"
              className="w-full h-28 bg-background/50 border border-primary/20 p-3 text-primary font-mono text-xs focus:outline-none focus:border-primary resize-none custom-scrollbar"
            />

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-[9px] font-mono text-primary/40 uppercase block mb-1">Language</label>
                <input
                  value={language}
                  onChange={e => setLanguage(e.target.value)}
                  placeholder="Auto-detect"
                  className="w-full h-8 bg-background/50 border border-primary/20 px-2 text-primary font-mono text-xs focus:outline-none focus:border-primary"
                />
              </div>
              <div>
                <label className="text-[9px] font-mono text-primary/40 uppercase block mb-1">Framework</label>
                <input
                  value={framework}
                  onChange={e => setFramework(e.target.value)}
                  placeholder="Auto-detect"
                  className="w-full h-8 bg-background/50 border border-primary/20 px-2 text-primary font-mono text-xs focus:outline-none focus:border-primary"
                />
              </div>
              <div>
                <label className="text-[9px] font-mono text-primary/40 uppercase block mb-1">Project Name</label>
                <input
                  value={projectName}
                  onChange={e => setProjectName(e.target.value)}
                  placeholder="my-project"
                  className="w-full h-8 bg-background/50 border border-primary/20 px-2 text-primary font-mono text-xs focus:outline-none focus:border-primary"
                />
              </div>
              <div>
                <label className="text-[9px] font-mono text-primary/40 uppercase block mb-1">Style</label>
                <select
                  value={style}
                  onChange={e => setStyle(e.target.value as any)}
                  className="w-full h-8 bg-background border border-primary/20 text-primary font-mono text-xs px-2 outline-none cursor-pointer"
                >
                  <option value="minimal">Minimal</option>
                  <option value="production">Production</option>
                  <option value="enterprise">Enterprise</option>
                </select>
              </div>
            </div>

            <CyberButton
              onClick={handleBuild}
              disabled={isBuilding || !requirement.trim()}
              className="w-full h-10 text-xs"
            >
              {isBuilding
                ? <><ThinkingIndicator active size="sm" label="" /> Building...</>
                : <><Play className="w-4 h-4 mr-2" /> BUILD PROJECT</>}
            </CyberButton>
          </CyberPanel>

          {/* Build log */}
          {events.length > 0 && (
            <CyberPanel className="flex-1 flex flex-col overflow-hidden min-h-[120px]">
              <div className="text-primary/50 text-[10px] font-mono uppercase tracking-widest mb-2 shrink-0">Build Log</div>
              <div className="flex-1 overflow-y-auto custom-scrollbar font-mono text-[10px] flex flex-col gap-0.5">
                {events.map((ev, i) => (
                  <div key={i} className={cn("flex items-start gap-2",
                    ev.type === 'file' ? 'text-emerald-400' :
                    ev.type === 'done' ? 'text-primary font-bold' :
                    ev.type === 'error' ? 'text-destructive' :
                    ev.type === 'thinking' ? 'text-primary/60 italic' :
                    'text-primary/50'
                  )}>
                    <span className="shrink-0 mt-0.5">
                      {ev.type === 'file' ? '📄' : ev.type === 'done' ? '✅' : ev.type === 'error' ? '❌' : ev.type === 'thinking' ? '🤔' : '⚡'}
                    </span>
                    <span>{ev.message || (ev.type === 'file' ? `${ev.path} (${((ev.size || 0) / 1024).toFixed(1)}KB)` : '')}</span>
                  </div>
                ))}
                <div ref={eventsEndRef} />
              </div>
            </CyberPanel>
          )}

          {/* Past sessions */}
          {sessions.length > 0 && !isBuilding && (
            <CyberPanel className="shrink-0">
              <div className="text-primary/50 text-[10px] font-mono uppercase tracking-widest mb-2 flex items-center gap-2">
                <GitBranch className="w-3 h-3" /> Past Sessions
              </div>
              <div className="flex flex-col gap-1 max-h-32 overflow-y-auto custom-scrollbar">
                {sessions.slice(0, 8).map(s => (
                  <button
                    key={s.id}
                    onClick={() => setSelectedSession(s.id)}
                    className={cn(
                      "flex items-center justify-between p-2 border text-left transition-all hover:border-primary/40",
                      selectedSession === s.id ? 'border-primary bg-primary/10' : 'border-primary/10 bg-primary/3'
                    )}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="font-mono text-[10px] text-primary/80 truncate">{s.projectName}</div>
                      <div className="font-mono text-[9px] text-primary/40 truncate">{s.requirement.slice(0, 40)}...</div>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0 ml-2">
                      <span className="font-mono text-[9px] text-primary/40">{s.totalFiles}f</span>
                      <CyberBadge variant={s.status === 'complete' ? 'success' : s.status === 'error' ? 'danger' : 'warning'} className="text-[8px] py-0">
                        {s.status}
                      </CyberBadge>
                    </div>
                  </button>
                ))}
              </div>
            </CyberPanel>
          )}
        </div>

        {/* Center: File tree */}
        <div className="lg:col-span-1 flex flex-col overflow-hidden">
          <CyberPanel className="flex-1 flex flex-col overflow-hidden">
            <div className="flex items-center gap-2 border-b border-primary/20 pb-2 mb-2 shrink-0">
              <FolderOpen className="w-4 h-4 text-primary" />
              <span className="font-mono text-[10px] uppercase tracking-widest text-primary">Files ({files.length})</span>
            </div>
            <div className="flex-1 overflow-y-auto custom-scrollbar">
              {files.length === 0 ? (
                <div className="text-primary/20 font-mono text-[10px] uppercase text-center mt-6">
                  No files yet
                </div>
              ) : files.map((f, i) => (
                <motion.button
                  key={f.path}
                  initial={{ opacity: 0, x: -5 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.03 }}
                  onClick={() => setSelectedFile(f)}
                  className={cn(
                    "w-full flex items-center gap-1.5 px-2 py-1.5 text-left transition-all hover:bg-primary/5 border-b border-primary/5",
                    selectedFile?.path === f.path && "bg-primary/10 border-l-2 border-l-primary"
                  )}
                >
                  <FileCode className={cn("w-3 h-3 shrink-0", fileColor(f.language))} />
                  <span className="font-mono text-[10px] text-primary/70 truncate">{f.path}</span>
                </motion.button>
              ))}
            </div>
          </CyberPanel>
        </div>

        {/* Right: Code viewer */}
        <CyberPanel className="lg:col-span-2 flex flex-col overflow-hidden">
          <div className="flex items-center justify-between border-b border-primary/20 pb-2 mb-2 shrink-0 gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <FileCode className={cn("w-4 h-4 shrink-0", fileColor(selectedFile?.language || ''))} />
              <span className="font-mono text-[10px] text-primary/80 truncate">{selectedFile?.path || 'No file selected'}</span>
            </div>
            {selectedFile && (
              <div className="flex gap-1.5 shrink-0">
                <button onClick={handleCopy} className="w-6 h-6 border border-primary/20 text-primary/50 hover:text-primary hover:border-primary flex items-center justify-center transition-all">
                  {copied ? <CheckCircle className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                </button>
                <button onClick={handleDownload} className="w-6 h-6 border border-primary/20 text-primary/50 hover:text-primary hover:border-primary flex items-center justify-center transition-all">
                  <Download className="w-3 h-3" />
                </button>
              </div>
            )}
          </div>
          <div className="flex-1 overflow-auto custom-scrollbar bg-black/40 relative">
            {!selectedFile ? (
              <div className="absolute inset-0 flex flex-col items-center justify-center text-primary/20 font-mono text-xs uppercase gap-3">
                <Code className="w-10 h-10 opacity-20" />
                {isBuilding ? <ThinkingIndicator active size="md" label="Generating..." /> : 'Select a file to view'}
              </div>
            ) : (
              <pre className="font-mono text-[11px] leading-relaxed text-emerald-300/90 p-4 whitespace-pre-wrap break-all">
                <code>{selectedFile.content}</code>
              </pre>
            )}
          </div>
        </CyberPanel>
      </div>
    </div>
  );
}
