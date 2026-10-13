import React, { useState } from 'react';
import { CyberPanel, CyberButton, CyberBadge } from '@/components/ui/cyber';
import { Code, Terminal, Play, AlertTriangle } from 'lucide-react';
import { useRunSandbox } from '@workspace/api-client-react';

export default function Sandbox() {
  const [code, setCode] = useState('console.log("Hello, NEXUS");');
  const [language, setLanguage] = useState('javascript');
  const runSandbox = useRunSandbox();

  const handleRun = () => {
    runSandbox.mutate({ data: { code, language } });
  };

  return (
    <div className="h-full flex flex-col gap-6">
      <CyberPanel className="shrink-0 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div className="flex items-center gap-4">
          <Code className="w-8 h-8 text-primary shrink-0" />
          <div>
            <h2 className="font-mono text-lg md:text-xl text-primary tracking-widest uppercase">Execution Sandbox</h2>
            <p className="font-mono text-[10px] md:text-xs text-destructive flex items-center gap-1 uppercase tracking-wider mt-1">
              <AlertTriangle className="w-3 h-3 shrink-0" /> Security Protocol Active. Network restricted.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 w-full md:w-auto">
          <select 
            value={language}
            onChange={(e) => setLanguage(e.target.value)}
            className="bg-background border border-primary/30 text-primary font-mono text-sm px-3 py-2 h-10 outline-none uppercase cursor-pointer hover:border-primary focus:border-primary focus:shadow-[0_0_10px_rgba(0,212,255,0.2)] transition-all flex-1 md:flex-none"
          >
            <option value="javascript">JavaScript</option>
            <option value="typescript">TypeScript</option>
            <option value="python">Python</option>
            <option value="bash">Bash</option>
          </select>
          <CyberButton onClick={handleRun} disabled={runSandbox.isPending} className="h-10 shrink-0">
            <Play className="w-4 h-4 md:mr-2" /> <span className="hidden md:inline">{runSandbox.isPending ? 'EXECUTING...' : 'RUN SEQUENCE'}</span>
          </CyberButton>
        </div>
      </CyberPanel>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 flex-1 min-h-[400px]">
        <div className="flex flex-col relative border border-primary/20 bg-background/50 font-mono text-sm shadow-[inset_0_0_20px_rgba(0,0,0,0.5)]">
          <div className="bg-primary/10 px-4 py-2 border-b border-primary/20 text-primary/70 uppercase flex justify-between tracking-widest shrink-0">
            <span>Editor</span>
            <span>{language}</span>
          </div>
          <div className="relative flex-1 flex">
            {/* Fake line numbers */}
            <div className="w-10 border-r border-primary/10 bg-primary/5 text-primary/30 text-right pr-2 py-4 select-none flex flex-col gap-1 text-xs shrink-0 overflow-hidden">
              {Array.from({ length: 30 }).map((_, i) => <span key={i}>{i + 1}</span>)}
            </div>
            <textarea 
              className="flex-1 w-full bg-transparent p-4 text-primary focus:outline-none resize-none custom-scrollbar leading-relaxed"
              value={code}
              onChange={e => setCode(e.target.value)}
              spellCheck={false}
            />
          </div>
        </div>

        <div className="flex flex-col border border-primary/20 bg-[#0a0a0a] font-mono text-sm relative overflow-hidden shadow-[inset_0_0_20px_rgba(0,0,0,0.8)]">
          <div className="bg-primary/10 px-4 py-2 border-b border-primary/20 text-primary/70 uppercase flex justify-between items-center tracking-widest shrink-0">
            <div className="flex items-center gap-2">
              <Terminal className="w-4 h-4" /> Terminal Output
            </div>
            {runSandbox.data && (
              <div className="flex gap-2">
                <CyberBadge variant={runSandbox.data.exitCode === 0 ? 'success' : 'danger'}>
                  EXIT {runSandbox.data.exitCode}
                </CyberBadge>
                <CyberBadge variant="info">{runSandbox.data.executionTimeMs}ms</CyberBadge>
              </div>
            )}
          </div>
          <div className="flex-1 p-4 overflow-y-auto custom-scrollbar text-emerald-400 whitespace-pre-wrap relative z-10 leading-relaxed text-xs md:text-sm">
            {runSandbox.isPending ? (
              <span className="animate-pulse flex items-center gap-2">
                <span className="inline-block w-2 h-4 bg-emerald-400"></span> Executing routine...
              </span>
            ) : runSandbox.data ? (
              <>
                {runSandbox.data.blocked && (
                  <div className="bg-destructive/10 border border-destructive text-destructive p-3 mb-4 flex items-start gap-3 cyber-glow">
                    <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" />
                    <div>
                      <div className="font-bold tracking-widest">EXECUTION BLOCKED</div>
                      <div className="text-xs mt-1 text-destructive/80">{runSandbox.data.blockReason}</div>
                    </div>
                  </div>
                )}
                {runSandbox.data.stdout && <div className="text-emerald-300">{runSandbox.data.stdout}</div>}
                {runSandbox.data.stderr && <div className="text-destructive mt-4">{runSandbox.data.stderr}</div>}
                {!runSandbox.data.stdout && !runSandbox.data.stderr && !runSandbox.data.blocked && (
                  <span className="text-emerald-400/50 italic">Process completed with no output.</span>
                )}
                <div className="mt-4 flex items-center gap-2 text-emerald-400/50">
                  <span className="inline-block w-2 h-4 bg-emerald-400/50 animate-pulse"></span>
                </div>
              </>
            ) : (
              <div className="text-emerald-400/30 flex items-center gap-2">
                <span className="inline-block w-2 h-4 bg-emerald-400/30"></span> Awaiting execution...
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}