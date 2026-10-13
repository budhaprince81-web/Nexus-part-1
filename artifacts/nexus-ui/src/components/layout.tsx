import React, { useState, useCallback, useRef } from 'react';
import { Link, useLocation } from 'wouter';
import { cn } from '@/lib/utils';
import {
  Activity, MessageSquare, Database,
  Network, Code, Settings, Cpu, Globe,
  Eye, Brain, CheckSquare, FlaskConical, LineChart,
  ChevronLeft, ChevronRight, Menu, X
} from 'lucide-react';
import { useGetAgentStatus } from '@workspace/api-client-react';
import { useLangContext } from '@/hooks/use-language';
import { useVoice } from '@/hooks/use-voice';
import { VoiceIndicator } from '@/components/hud/voice-indicator';
import { NotificationsCenter } from '@/components/hud/notifications-center';
import { ParticleSystem } from '@/components/hud/particles';
import { motion, AnimatePresence } from 'framer-motion';

function Clock() {
  const [time, setTime] = React.useState(new Date());
  React.useEffect(() => {
    const timer = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    <div className="font-mono text-primary/80 flex items-center gap-2">
      <span className="hidden sm:inline text-primary/30 text-[10px] tracking-widest uppercase">SYS</span>
      <div className="flex flex-col items-end">
        <span className="cyber-glow-text text-primary font-bold text-sm tracking-widest">
          {pad(time.getHours())}:{pad(time.getMinutes())}:{pad(time.getSeconds())}
        </span>
        <span className="text-primary/30 text-[9px] tracking-wider hidden sm:block">
          {time.toLocaleDateString('en', { weekday: 'short', month: 'short', day: 'numeric' }).toUpperCase()}
        </span>
      </div>
    </div>
  );
}

export function Layout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const { t, lang, setLanguage } = useLangContext();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const { data: agentStatus } = useGetAgentStatus({ query: { refetchInterval: 5000, queryKey: ['agents-status-nav'] } });
  const activeAgents = agentStatus?.filter((a: any) => a.status === 'active').length || 0;

  const voice = useVoice({
    wakeWord: 'nexus',
    lang: lang === 'ne' ? 'ne-NP' : 'en-US',
    ttsEnabled: true,
    onTranscript: (text) => {
      const lower = text.toLowerCase();
      const navigate = (path: string) => {
        window.location.href = `${import.meta.env.BASE_URL.replace(/\/$/, '')}${path}`;
      };
      if (lower.includes('chat') || lower.includes('comms')) navigate('/chat');
      else if (lower.includes('memory') || lower.includes('स्मृति')) navigate('/memory');
      else if (lower.includes('agent')) navigate('/agents');
      else if (lower.includes('sandbox') || lower.includes('code') && !lower.includes('coding')) navigate('/sandbox');
      else if (lower.includes('vision') || lower.includes('camera')) navigate('/vision');
      else if (lower.includes('coding') || lower.includes('build')) navigate('/coding');
      else if (lower.includes('task')) navigate('/tasks');
      else if (lower.includes('research')) navigate('/research');
      else if (lower.includes('trading') || lower.includes('risk')) navigate('/trading');
      else if (lower.includes('setting')) navigate('/settings');
      else if (lower.includes('home') || lower.includes('dashboard') || lower.includes('hud')) navigate('/');
    }
  });

  const navItems = [
    { href: '/',         icon: Activity,      label: t.hud,      group: 'core' },
    { href: '/chat',     icon: MessageSquare, label: t.comms,    group: 'core' },
    { href: '/vision',   icon: Eye,           label: 'Vision',   group: 'ai' },
    { href: '/research', icon: Brain,         label: 'Research', group: 'ai' },
    { href: '/coding',   icon: Code,          label: 'Coding',   group: 'ai' },
    { href: '/agents',   icon: Network,       label: t.agents,   group: 'ai' },
    { href: '/sandbox',  icon: FlaskConical,  label: t.sandbox,  group: 'tools' },
    { href: '/tasks',    icon: CheckSquare,   label: 'Tasks',    group: 'tools' },
    { href: '/trading',  icon: LineChart,     label: lang === 'ne' ? 'ट्रेडिङ' : 'Trading', group: 'tools' },
    { href: '/memory',   icon: Database,      label: t.memory,   group: 'tools' },
    { href: '/settings', icon: Settings,      label: t.settings, group: 'system' },
  ];

  const groups = [
    { key: 'core',   label: 'Core' },
    { key: 'ai',     label: 'AI Agents' },
    { key: 'tools',  label: 'Tools' },
    { key: 'system', label: 'System' },
  ];

  const SidebarContent = () => (
    <>
      {groups.map(group => {
        const groupItems = navItems.filter(n => n.group === group.key);
        return (
          <div key={group.key}>
            {!sidebarCollapsed && (
              <div className="text-[9px] font-mono text-primary/30 px-4 py-1.5 uppercase tracking-widest">
                {group.label}
              </div>
            )}
            {groupItems.map((item) => {
              const isActive = location === item.href;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setMobileSidebarOpen(false)}
                  className={cn(
                    "flex items-center gap-3 px-3 py-2.5 cursor-pointer transition-all duration-200 border-l-2 w-full relative",
                    sidebarCollapsed ? "justify-center" : "justify-start",
                    isActive
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-transparent text-primary/40 hover:bg-primary/5 hover:text-primary/80 hover:border-primary/30"
                  )}
                >
                  {isActive && (
                    <motion.div
                      className="absolute left-0 top-0 bottom-0 w-0.5 bg-primary shadow-[0_0_8px_rgba(0,212,255,0.8)]"
                      layoutId="nav-active"
                      transition={{ type: 'spring', stiffness: 400, damping: 35 }}
                    />
                  )}
                  <item.icon className={cn("shrink-0", isActive ? "w-4 h-4" : "w-4 h-4")} />
                  {!sidebarCollapsed && (
                    <span className="font-mono text-xs uppercase tracking-wider">{item.label}</span>
                  )}
                </Link>
              );
            })}
          </div>
        );
      })}
    </>
  );

  return (
    <div className="min-h-[100dvh] h-screen bg-background text-foreground flex flex-col overflow-hidden relative">
      {/* Global particle system */}
      <div className="fixed inset-0 pointer-events-none z-0">
        <ParticleSystem count={40} interactive={false} />
      </div>

      {/* Scanlines overlay */}
      <div className="scanlines fixed inset-0 pointer-events-none z-0" />

      {/* ── TOP HUD BAR ── */}
      <header className="h-14 border-b border-primary/20 cyber-panel flex items-center justify-between px-4 sm:px-6 z-20 shrink-0 relative">
        <div className="flex items-center gap-3">
          {/* Mobile menu */}
          <button
            onClick={() => setMobileSidebarOpen(p => !p)}
            className="md:hidden w-8 h-8 border border-primary/20 flex items-center justify-center text-primary/60 hover:text-primary"
          >
            {mobileSidebarOpen ? <X className="w-4 h-4" /> : <Menu className="w-4 h-4" />}
          </button>

          {/* Logo */}
          <div className="flex items-center gap-2">
            <motion.div
              animate={{ rotate: [0, 360] }}
              transition={{ duration: 20, repeat: Infinity, ease: 'linear' }}
            >
              <Cpu className="w-5 h-5 sm:w-6 sm:h-6 text-primary" />
            </motion.div>
            <div>
              <h1 className="text-base sm:text-lg font-bold tracking-[0.2em] text-primary cyber-glow-text uppercase leading-none">
                NEXUS
              </h1>
              <div className="text-[8px] text-primary/40 font-mono tracking-[0.3em] hidden sm:block">AI OPERATING SYSTEM</div>
            </div>
          </div>

          <div className="h-5 w-px bg-primary/20 mx-1 hidden sm:block" />

          <div className="hidden sm:flex items-center gap-2 text-[10px] font-mono uppercase text-primary/50">
            <span className="relative flex h-1.5 w-1.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75"></span>
              <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-primary"></span>
            </span>
            {t.systemOnline}
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Language toggle */}
          <button
            onClick={() => setLanguage(lang === 'en' ? 'ne' : 'en')}
            className="flex items-center gap-1 px-2 py-1 border border-primary/15 hover:border-primary/40 text-primary/50 hover:text-primary transition-all font-mono text-[10px] uppercase tracking-wider"
          >
            <Globe className="w-3 h-3" />
            <span className="hidden sm:inline">{lang === 'en' ? 'EN' : 'NE'}</span>
          </button>

          {/* Notifications */}
          <NotificationsCenter />

          {/* Voice */}
          <VoiceIndicator
            state={voice.state}
            wakeWordDetected={voice.wakeWordDetected}
            transcript={voice.transcript}
            enabled={voice.enabled}
            onToggle={voice.toggle}
            compact
          />

          <div className="h-4 w-px bg-primary/20 hidden sm:block" />
          <Clock />
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden relative z-10">
        {/* ── SIDEBAR — desktop ── */}
        <motion.aside
          animate={{ width: sidebarCollapsed ? 52 : 200 }}
          transition={{ type: 'spring', stiffness: 300, damping: 30 }}
          className="hidden md:flex border-r border-primary/20 bg-background/80 backdrop-blur-sm flex-col py-3 shrink-0 z-10 overflow-hidden relative"
        >
          <div className="flex flex-col flex-1 overflow-y-auto custom-scrollbar overflow-x-hidden">
            <SidebarContent />
          </div>

          {/* System stats + collapse */}
          <div className="border-t border-primary/10 pt-3 px-3 mt-2 shrink-0">
            {!sidebarCollapsed && (
              <div className="font-mono text-[9px] text-primary/30 uppercase mb-3 flex flex-col gap-1.5">
                <div className="flex justify-between">
                  <span>Agents</span>
                  <span className={activeAgents > 0 ? 'text-primary' : 'text-primary/30'}>{activeAgents} ACT</span>
                </div>
                <div className="flex justify-between">
                  <span>NET</span>
                  <span className="text-emerald-500">{t.secureNet}</span>
                </div>
                <div className="flex justify-between">
                  <span>VOICE</span>
                  <span className={voice.enabled ? 'text-primary' : 'text-primary/20'}>{voice.enabled ? 'ON' : 'OFF'}</span>
                </div>
              </div>
            )}
            <button
              onClick={() => setSidebarCollapsed(p => !p)}
              className="w-full flex items-center justify-center text-primary/30 hover:text-primary transition-colors py-1"
            >
              {sidebarCollapsed ? <ChevronRight className="w-3 h-3" /> : <ChevronLeft className="w-3 h-3" />}
            </button>
          </div>
        </motion.aside>

        {/* ── SIDEBAR — mobile overlay ── */}
        <AnimatePresence>
          {mobileSidebarOpen && (
            <>
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="fixed inset-0 bg-background/60 backdrop-blur-sm z-20 md:hidden"
                onClick={() => setMobileSidebarOpen(false)}
              />
              <motion.aside
                initial={{ x: -220 }}
                animate={{ x: 0 }}
                exit={{ x: -220 }}
                transition={{ type: 'spring', stiffness: 300, damping: 30 }}
                className="fixed left-0 top-14 bottom-0 w-52 border-r border-primary/20 bg-background/95 backdrop-blur-xl flex flex-col py-3 z-30 overflow-y-auto custom-scrollbar md:hidden"
              >
                <SidebarContent />
              </motion.aside>
            </>
          )}
        </AnimatePresence>

        {/* ── MAIN CONTENT ── */}
        <main className="flex-1 relative overflow-y-auto overflow-x-hidden p-4 sm:p-5 custom-scrollbar z-0">
          {children}
        </main>
      </div>

      {/* Wake word global flash */}
      <AnimatePresence>
        {voice.wakeWordDetected && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 bg-primary/10 border border-primary backdrop-blur-md px-6 py-3 font-mono text-primary text-sm uppercase tracking-widest shadow-[0_0_30px_rgba(0,212,255,0.5)]"
          >
            ⚡ {lang === 'ne' ? 'NEXUS सक्रिय — के गर्नु छ?' : 'NEXUS ACTIVATED — How can I help?'}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
