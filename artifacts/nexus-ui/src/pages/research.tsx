import React, { useState } from 'react';
import { CyberPanel, CyberButton, CyberBadge } from '@/components/ui/cyber';
import { motion, AnimatePresence } from 'framer-motion';
import { Search, BookOpen, Zap, Brain, Star, Globe, ChevronRight, ArrowRight } from 'lucide-react';
import { ThinkingIndicator } from '@/components/hud/thinking';
import { useConductResearch } from '@workspace/api-client-react';
import { useLangContext } from '@/hooks/use-language';
import { cn } from '@/lib/utils';

type Depth = 'quick' | 'standard' | 'deep' | 'expert';
type Format = 'summary' | 'report' | 'analysis' | 'technical';

interface ResearchResult {
  id: string;
  query: string;
  depth: string;
  summary: string;
  keyPoints: string[];
  sources: string[];
  technicalDetails: string;
  practicalApplications: string;
  relatedTopics: string[];
  createdAt: string;
}

const DEPTH_CONFIG: Record<Depth, { label: string; time: string; points: string; color: string }> = {
  quick:    { label: 'Quick',    time: '~5s',  points: '3-5 pts',   color: 'text-primary/70' },
  standard: { label: 'Standard', time: '~10s', points: '5-8 pts',   color: 'text-primary' },
  deep:     { label: 'Deep',     time: '~20s', points: '8-12 pts',  color: 'text-amber-400' },
  expert:   { label: 'Expert',   time: '~30s', points: '10-15 pts', color: 'text-violet-400' },
};

const EXAMPLE_QUERIES = [
  'Quantum computing applications in cryptography',
  'How does transformer architecture work in LLMs?',
  'Best practices for microservices security',
  'Current state of fusion energy research',
  'Neural interface technology developments 2024',
  'Rust vs Go for systems programming',
  'AI ethics frameworks comparison',
  'WebAssembly future use cases',
];

export default function Research() {
  const { lang } = useLangContext();
  const [query, setQuery] = useState('');
  const [depth, setDepth] = useState<Depth>('standard');
  const [format, setFormat] = useState<Format>('summary');
  const [result, setResult] = useState<ResearchResult | null>(null);
  const [activeTab, setActiveTab] = useState<'summary' | 'technical' | 'applications' | 'related'>('summary');

  const conductResearch = useConductResearch();

  const handleResearch = () => {
    if (!query.trim()) return;
    setResult(null);
    conductResearch.mutate(
      { data: { query, depth, format, language: lang } as any },
      { onSuccess: (data: any) => { setResult(data); setActiveTab('summary'); } }
    );
  };

  return (
    <div className="h-full flex flex-col gap-4">
      {/* Header */}
      <CyberPanel className="shrink-0 flex items-center gap-3">
        <Brain className="w-7 h-7 text-primary" />
        <div>
          <h2 className="font-mono text-lg text-primary tracking-widest uppercase">Research Agent</h2>
          <p className="font-mono text-[10px] text-primary/50 uppercase">Deep knowledge synthesis · Multi-domain expertise</p>
        </div>
      </CyberPanel>

      {/* Input */}
      <CyberPanel className="shrink-0 flex flex-col gap-4">
        {/* Query input */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-primary/40" />
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleResearch()}
            placeholder={lang === 'ne' ? 'के खोज्नु छ? यहाँ लेख्नुस्...' : 'What do you want to research? Enter a topic or question...'}
            className="w-full h-11 bg-background/50 border border-primary/20 pl-10 pr-4 text-primary font-mono text-sm focus:outline-none focus:border-primary focus:shadow-[0_0_15px_rgba(0,212,255,0.2)] transition-all"
          />
        </div>

        {/* Quick queries */}
        <div className="flex flex-wrap gap-1.5">
          {EXAMPLE_QUERIES.map(q => (
            <button
              key={q}
              onClick={() => setQuery(q)}
              className="font-mono text-[10px] border border-primary/15 text-primary/50 px-2 py-1 hover:border-primary/50 hover:text-primary transition-all"
            >
              {q}
            </button>
          ))}
        </div>

        {/* Depth + Format selectors */}
        <div className="flex flex-col sm:flex-row gap-4">
          <div className="flex-1">
            <div className="text-[10px] font-mono text-primary/40 uppercase mb-2">Research Depth</div>
            <div className="grid grid-cols-4 gap-1.5">
              {(Object.entries(DEPTH_CONFIG) as [Depth, typeof DEPTH_CONFIG.quick][]).map(([key, cfg]) => (
                <button
                  key={key}
                  onClick={() => setDepth(key)}
                  className={cn(
                    "flex flex-col items-center py-2 border transition-all text-center",
                    depth === key ? `border-primary bg-primary/10 ${cfg.color}` : 'border-primary/15 text-primary/40 hover:border-primary/40'
                  )}
                >
                  <span className="font-mono text-xs font-bold">{cfg.label}</span>
                  <span className="font-mono text-[9px] opacity-70">{cfg.time}</span>
                  <span className="font-mono text-[9px] opacity-50">{cfg.points}</span>
                </button>
              ))}
            </div>
          </div>
          <div>
            <div className="text-[10px] font-mono text-primary/40 uppercase mb-2">Format</div>
            <div className="grid grid-cols-2 gap-1.5">
              {(['summary', 'report', 'analysis', 'technical'] as Format[]).map(f => (
                <button
                  key={f}
                  onClick={() => setFormat(f)}
                  className={cn(
                    "font-mono text-[10px] uppercase px-3 py-2 border transition-all",
                    format === f ? 'border-primary bg-primary/10 text-primary' : 'border-primary/15 text-primary/40 hover:border-primary/40'
                  )}
                >
                  {f}
                </button>
              ))}
            </div>
          </div>
        </div>

        <CyberButton
          onClick={handleResearch}
          disabled={conductResearch.isPending || !query.trim()}
          className="h-10 text-sm"
        >
          {conductResearch.isPending
            ? <><ThinkingIndicator active size="sm" label="" /> Researching...</>
            : <><Search className="w-4 h-4 mr-2" /> {lang === 'ne' ? 'अनुसन्धान गर्नुस्' : 'Research'}</>}
        </CyberButton>
      </CyberPanel>

      {/* Results */}
      <AnimatePresence>
        {result && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex-1 flex flex-col gap-4 min-h-0"
          >
            {/* Result header */}
            <div className="flex items-center justify-between shrink-0">
              <div className="flex items-center gap-3">
                <BookOpen className="w-5 h-5 text-primary" />
                <div>
                  <div className="font-mono text-sm text-primary/90">{result.query}</div>
                  <div className="font-mono text-[10px] text-primary/40 uppercase">
                    {result.depth} research · {result.keyPoints.length} key points · {result.sources.length} sources
                  </div>
                </div>
              </div>
              <CyberBadge variant="info">{result.depth.toUpperCase()}</CyberBadge>
            </div>

            {/* Tab navigation */}
            <div className="flex gap-1 border-b border-primary/20 pb-0 shrink-0">
              {(['summary', 'technical', 'applications', 'related'] as const).map(tab => (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  className={cn(
                    "font-mono text-[10px] uppercase px-3 py-2 border-b-2 transition-all -mb-px tracking-wider",
                    activeTab === tab ? 'border-primary text-primary' : 'border-transparent text-primary/40 hover:text-primary/70'
                  )}
                >
                  {tab}
                </button>
              ))}
            </div>

            {/* Tab content */}
            <div className="flex-1 overflow-hidden grid grid-cols-1 md:grid-cols-3 gap-4 min-h-0">
              {/* Main content */}
              <CyberPanel className="md:col-span-2 overflow-y-auto custom-scrollbar">
                <AnimatePresence mode="wait">
                  {activeTab === 'summary' && (
                    <motion.div key="summary" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                      <div className="font-mono text-sm text-primary/90 leading-relaxed whitespace-pre-wrap">
                        {result.summary}
                      </div>
                    </motion.div>
                  )}
                  {activeTab === 'technical' && (
                    <motion.div key="technical" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                      {result.technicalDetails ? (
                        <div className="font-mono text-xs text-primary/80 leading-relaxed whitespace-pre-wrap">
                          {result.technicalDetails}
                        </div>
                      ) : (
                        <div className="text-primary/30 font-mono text-xs text-center mt-8">No technical details available for this depth level.</div>
                      )}
                    </motion.div>
                  )}
                  {activeTab === 'applications' && (
                    <motion.div key="applications" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                      {result.practicalApplications ? (
                        <div className="font-mono text-xs text-primary/80 leading-relaxed whitespace-pre-wrap">
                          {result.practicalApplications}
                        </div>
                      ) : (
                        <div className="text-primary/30 font-mono text-xs text-center mt-8">No applications data available.</div>
                      )}
                    </motion.div>
                  )}
                  {activeTab === 'related' && (
                    <motion.div key="related" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex flex-col gap-2">
                      {result.relatedTopics.map((topic, i) => (
                        <button
                          key={i}
                          onClick={() => { setQuery(topic); setResult(null); }}
                          className="flex items-center gap-2 p-3 border border-primary/15 hover:border-primary/50 text-left transition-all group"
                        >
                          <Globe className="w-4 h-4 text-primary/40 shrink-0" />
                          <span className="font-mono text-xs text-primary/70 group-hover:text-primary transition-colors">{topic}</span>
                          <ArrowRight className="w-3 h-3 text-primary/30 group-hover:text-primary ml-auto shrink-0 transition-colors" />
                        </button>
                      ))}
                    </motion.div>
                  )}
                </AnimatePresence>
              </CyberPanel>

              {/* Key points + sources */}
              <div className="flex flex-col gap-3 overflow-hidden">
                {/* Key points */}
                <CyberPanel className="flex flex-col overflow-hidden flex-1">
                  <div className="flex items-center gap-2 mb-3 shrink-0">
                    <Star className="w-3.5 h-3.5 text-primary" />
                    <span className="font-mono text-[10px] uppercase tracking-widest text-primary">Key Points</span>
                    <CyberBadge variant="info" className="ml-auto">{result.keyPoints.length}</CyberBadge>
                  </div>
                  <div className="flex-1 overflow-y-auto custom-scrollbar flex flex-col gap-2">
                    {result.keyPoints.map((pt, i) => (
                      <motion.div
                        key={i}
                        initial={{ opacity: 0, x: 10 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: i * 0.05 }}
                        className="flex items-start gap-2"
                      >
                        <span className="text-primary font-mono text-[10px] font-bold shrink-0 mt-0.5">{String(i + 1).padStart(2, '0')}.</span>
                        <span className="font-mono text-[11px] text-primary/80 leading-relaxed">{pt}</span>
                      </motion.div>
                    ))}
                  </div>
                </CyberPanel>

                {/* Sources */}
                {result.sources.length > 0 && (
                  <CyberPanel className="shrink-0">
                    <div className="flex items-center gap-2 mb-2">
                      <Globe className="w-3.5 h-3.5 text-primary" />
                      <span className="font-mono text-[10px] uppercase tracking-widest text-primary">Sources</span>
                    </div>
                    <div className="flex flex-col gap-1">
                      {result.sources.map((src, i) => (
                        <div key={i} className="flex items-center gap-1.5 font-mono text-[10px] text-primary/50">
                          <ChevronRight className="w-2.5 h-2.5 shrink-0" />
                          <span className="truncate">{src}</span>
                        </div>
                      ))}
                    </div>
                  </CyberPanel>
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Thinking overlay */}
      {conductResearch.isPending && !result && (
        <div className="flex-1 flex items-center justify-center">
          <ThinkingIndicator active size="lg" label={`${depth} research in progress...`} />
        </div>
      )}
    </div>
  );
}
