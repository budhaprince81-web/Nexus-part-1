import React, { useMemo } from 'react';
import { CyberPanel, CyberBadge, CyberButton } from '@/components/ui/cyber';
import { motion, AnimatePresence } from 'framer-motion';
import { Activity, ShieldAlert, Database, CheckCircle, XCircle, Network, Wifi, Battery, BatteryCharging } from 'lucide-react';
import {
  useGetTelemetry, getGetTelemetryQueryKey,
  useGetRecentLogs, getGetRecentLogsQueryKey,
  useListPendingActions, getListPendingActionsQueryKey,
  useConfirmAction,
  useGetAgentStatus
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { cn } from '@/lib/utils';
import { ArcReactor, MiniArcRing } from '@/components/hud/arc-reactor';
import { VoiceWaveform } from '@/components/hud/voice-indicator';
import { useVoice } from '@/hooks/use-voice';
import { useLangContext } from '@/hooks/use-language';
import { useWeather, getWeatherIcon, getWeatherDesc } from '@/hooks/use-weather';

// Battery API hook
function useBattery() {
  const [battery, setBattery] = React.useState<{ level: number; charging: boolean } | null>(null);
  React.useEffect(() => {
    if (!('getBattery' in navigator)) return;
    (navigator as any).getBattery().then((b: any) => {
      const update = () => setBattery({ level: Math.round(b.level * 100), charging: b.charging });
      update();
      b.addEventListener('levelchange', update);
      b.addEventListener('chargingchange', update);
      return () => {
        b.removeEventListener('levelchange', update);
        b.removeEventListener('chargingchange', update);
      };
    }).catch(() => {});
  }, []);
  return battery;
}

// Network speed estimate
function useNetworkInfo() {
  const [info, setInfo] = React.useState<{ effectiveType?: string; downlink?: number } | null>(null);
  React.useEffect(() => {
    const conn = (navigator as any).connection;
    if (!conn) return;
    const update = () => setInfo({ effectiveType: conn.effectiveType, downlink: conn.downlink });
    update();
    conn.addEventListener('change', update);
    return () => conn.removeEventListener('change', update);
  }, []);
  return info;
}

// Calendar widget
function CalendarWidget() {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  const today = now.getDate();
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const monthNames = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
  const days: (number | null)[] = [
    ...Array.from({ length: firstDay }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1)
  ];

  return (
    <div className="flex flex-col gap-2 font-mono">
      <div className="text-center text-primary/60 text-xs tracking-widest uppercase">
        {monthNames[month]} {year}
      </div>
      <div className="grid grid-cols-7 gap-0.5 text-center text-[9px] text-primary/40">
        {['S','M','T','W','T','F','S'].map((d, i) => (
          <div key={i} className="py-0.5">{d}</div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-0.5 text-center text-[10px]">
        {days.map((d, i) => (
          <div key={i} className={cn(
            "py-1 transition-colors",
            d === null ? '' : d === today
              ? 'bg-primary/20 text-primary border border-primary/50 shadow-[0_0_8px_rgba(0,212,255,0.3)] font-bold'
              : 'text-primary/60 hover:bg-primary/10 cursor-default'
          )}>
            {d || ''}
          </div>
        ))}
      </div>
    </div>
  );
}

// Weather card
function WeatherCard() {
  const { weather, loading } = useWeather();
  const { t } = useLangContext();

  if (loading) return (
    <div className="flex items-center justify-center h-full font-mono text-primary/30 text-xs animate-pulse uppercase">
      Scanning atmosphere...
    </div>
  );
  if (!weather) return (
    <div className="font-mono text-xs text-primary/30 text-center">Weather unavailable</div>
  );

  const icon = getWeatherIcon(weather.weathercode);
  const desc = getWeatherDesc(weather.weathercode);
  const battColor = weather.temp > 35 ? '#ef4444' : weather.temp < 5 ? '#60a5fa' : 'hsl(var(--primary))';

  return (
    <div className="flex flex-col gap-3 font-mono h-full">
      <div className="flex items-start justify-between">
        <div>
          <div className="text-3xl">{icon}</div>
          <div className="text-xs text-primary/50 uppercase tracking-wider mt-1">{weather.city}</div>
        </div>
        <div className="text-right">
          <div className="text-3xl font-bold" style={{ color: battColor }}>{weather.temp}°C</div>
          <div className="text-[10px] text-primary/50 uppercase">{desc}</div>
        </div>
      </div>
      <div className="grid grid-cols-3 gap-2 text-[9px] uppercase border-t border-primary/10 pt-2">
        <div className="flex flex-col items-center gap-1 text-primary/60">
          <span>💧</span>
          <span className="text-primary">{weather.humidity}%</span>
          <span>{t.humidity}</span>
        </div>
        <div className="flex flex-col items-center gap-1 text-primary/60">
          <span>💨</span>
          <span className="text-primary">{weather.windspeed} km/h</span>
          <span>{t.wind}</span>
        </div>
        <div className="flex flex-col items-center gap-1 text-primary/60">
          <span>🌡️</span>
          <span className="text-primary">{weather.feelsLike}°C</span>
          <span>Feels</span>
        </div>
      </div>
    </div>
  );
}

export default function Dashboard() {
  const queryClient = useQueryClient();
  const { t } = useLangContext();
  const { data: telemetry } = useGetTelemetry({ query: { refetchInterval: 4000, queryKey: getGetTelemetryQueryKey() } });
  const { data: logs } = useGetRecentLogs({ limit: 18 }, { query: { refetchInterval: 3000, queryKey: getGetRecentLogsQueryKey({ limit: 18 }) } });
  const { data: pendingActions } = useListPendingActions({ query: { refetchInterval: 3000, queryKey: getListPendingActionsQueryKey() } });
  const { data: agentStatus } = useGetAgentStatus({ query: { refetchInterval: 5000, queryKey: ['agents-status-hud'] } });

  const battery = useBattery();
  const network = useNetworkInfo();

  const confirmAction = useConfirmAction();
  const voice = useVoice({ wakeWord: 'nexus', ttsEnabled: true });

  const handleConfirm = (id: string, approved: boolean) => {
    confirmAction.mutate({ id, data: { approved } }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListPendingActionsQueryKey() });
        if (approved) voice.speak('Action approved. Executing.');
        else voice.speak('Action denied.');
      }
    });
  };

  const cpu = telemetry?.cpuPercent || 0;
  const mem = telemetry?.memoryPercent || 0;
  const netSignal = network?.downlink ? Math.min(network.downlink * 5, 100) : 65;
  const battLevel = battery?.level || 88;

  const reactorActive = true;

  return (
    <div className="h-full flex flex-col gap-4 relative">

      {/* ===== TOP ROW: Arc Reactor HUD + Gauges ===== */}
      <div className="grid grid-cols-1 md:grid-cols-5 gap-4 shrink-0">

        {/* Arc Reactor — center HUD */}
        <CyberPanel className="md:col-span-2 flex flex-col items-center justify-center py-6 relative overflow-hidden min-h-[280px]">
          <div className="absolute inset-0 pointer-events-none">
            {/* corner brackets */}
            {['top-0 left-0', 'top-0 right-0', 'bottom-0 left-0', 'bottom-0 right-0'].map((pos, i) => (
              <div key={i} className={`absolute ${pos} w-4 h-4 border-primary/40`}
                style={{
                  borderTop: i < 2 ? '2px solid' : 'none',
                  borderBottom: i >= 2 ? '2px solid' : 'none',
                  borderLeft: i % 2 === 0 ? '2px solid' : 'none',
                  borderRight: i % 2 === 1 ? '2px solid' : 'none',
                }}
              />
            ))}
          </div>
          <ArcReactor size={240} active={reactorActive} className="mx-auto">
            <div className="flex flex-col items-center text-center gap-1 pointer-events-none">
              <motion.div
                className="text-2xl font-bold font-mono text-primary cyber-glow-text tracking-widest"
                animate={{ opacity: [1, 0.7, 1] }}
                transition={{ duration: 2, repeat: Infinity }}
              >
                NEXUS
              </motion.div>
              <div className="text-[9px] font-mono text-primary/60 uppercase tracking-[0.3em]">
                AI CORE ONLINE
              </div>
              <div className="text-[8px] font-mono text-primary/40 uppercase mt-1">
                {new Date().toISOString().split('T')[0]}
              </div>
            </div>
          </ArcReactor>

          {/* Voice waveform below reactor */}
          <div className="w-full mt-2 px-4">
            <VoiceWaveform active={voice.state === 'listening' || voice.state === 'speaking'} bars={24} />
          </div>
          <div className="text-[9px] font-mono text-primary/40 uppercase tracking-widest mt-1">
            {t.voiceComms}
          </div>
        </CyberPanel>

        {/* System Gauges — 4 metrics */}
        <div className="md:col-span-3 grid grid-cols-2 gap-4">
          <CyberPanel className="flex flex-col items-center justify-center py-4">
            <MiniArcRing value={cpu} size={110} label={t.cpuLoad} sublabel="%" />
          </CyberPanel>

          <CyberPanel className="flex flex-col items-center justify-center py-4">
            <MiniArcRing value={mem} size={110} label={t.memLoad} sublabel="%" />
          </CyberPanel>

          <CyberPanel className="flex flex-col items-center justify-center py-4">
            <MiniArcRing
              value={battLevel}
              size={110}
              label={t.battery}
              sublabel={battery?.charging ? '⚡CHG' : '%'}
              color={battLevel < 20 ? '#ef4444' : battLevel < 40 ? '#f59e0b' : 'rgba(16,185,129,0.9)'}
            />
          </CyberPanel>

          <CyberPanel className="flex flex-col items-center justify-center py-4">
            <MiniArcRing
              value={netSignal}
              size={110}
              label={t.netLoad}
              sublabel={network?.effectiveType?.toUpperCase() || '4G'}
              color="rgba(147,51,234,0.9)"
            />
          </CyberPanel>
        </div>
      </div>

      {/* ===== MIDDLE ROW: Weather + Calendar + Agent Grid + Actions ===== */}
      <div className="grid grid-cols-1 md:grid-cols-4 lg:grid-cols-6 gap-4 flex-1 min-h-[220px]">

        {/* Weather */}
        <CyberPanel className="md:col-span-2 lg:col-span-1 flex flex-col">
          <div className="flex items-center gap-2 mb-3 border-b border-primary/20 pb-2 shrink-0">
            <span className="text-sm">🌤️</span>
            <h3 className="text-xs font-mono uppercase tracking-widest text-primary/80">{t.weather}</h3>
          </div>
          <div className="flex-1 relative z-10">
            <WeatherCard />
          </div>
        </CyberPanel>

        {/* Calendar */}
        <CyberPanel className="md:col-span-2 lg:col-span-1 flex flex-col">
          <div className="flex items-center gap-2 mb-3 border-b border-primary/20 pb-2 shrink-0">
            <span className="text-sm">📅</span>
            <h3 className="text-xs font-mono uppercase tracking-widest text-primary/80">{t.calendar}</h3>
          </div>
          <div className="flex-1 relative z-10">
            <CalendarWidget />
          </div>
        </CyberPanel>

        {/* Agent Grid */}
        <CyberPanel className="md:col-span-4 lg:col-span-2 flex flex-col">
          <div className="flex items-center gap-2 mb-3 border-b border-primary/20 pb-2 shrink-0">
            <Network className="w-4 h-4 text-primary" />
            <h3 className="text-xs font-mono uppercase tracking-widest text-primary/80">{t.agentGrid}</h3>
          </div>
          <div className="flex-1 overflow-y-auto custom-scrollbar flex flex-col gap-2 relative z-10">
            {agentStatus?.map(agent => (
              <div key={agent.name} className="flex items-center justify-between p-2 border border-primary/10 bg-primary/5 hover:bg-primary/10 transition-colors">
                <div className="flex items-center gap-2">
                  <div className={cn("w-1.5 h-1.5 rounded-full", agent.status === 'active' ? 'bg-primary animate-pulse' : agent.status === 'error' ? 'bg-destructive' : 'bg-amber-500')} />
                  <div className="font-mono text-xs uppercase">{agent.name}</div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="font-mono text-[10px] text-primary/50">{agent.tasksCompleted} tasks</span>
                  <CyberBadge variant={agent.status === 'active' ? 'info' : agent.status === 'error' ? 'danger' : 'warning'}>
                    {agent.status}
                  </CyberBadge>
                </div>
              </div>
            ))}
          </div>
        </CyberPanel>

        {/* Action Queue */}
        <CyberPanel className="md:col-span-4 lg:col-span-2 flex flex-col">
          <div className="flex items-center justify-between mb-3 border-b border-primary/20 pb-2 shrink-0">
            <div className="flex items-center gap-2">
              <ShieldAlert className="w-4 h-4 text-primary" />
              <h3 className="text-xs font-mono uppercase tracking-widest text-primary/80">{t.actionQueue}</h3>
            </div>
            <CyberBadge variant={pendingActions?.length ? 'warning' : 'success'}>
              {pendingActions?.length || 0} {t.pending}
            </CyberBadge>
          </div>

          <div className="flex-1 overflow-y-auto custom-scrollbar flex flex-col gap-2 relative z-10">
            <AnimatePresence>
              {pendingActions?.length === 0 && (
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-center font-mono text-primary/40 text-xs uppercase h-full flex items-center justify-center">
                  {t.allClear}
                </motion.div>
              )}
              {pendingActions?.map(action => (
                <motion.div
                  key={action.id}
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, scale: 0.95 }}
                  className="p-3 border border-amber-500/30 bg-amber-500/5 relative overflow-hidden"
                >
                  <div className="absolute top-0 left-0 w-1 h-full bg-amber-500 shadow-[0_0_8px_#f59e0b]" />
                  <div className="pl-3 mb-2">
                    <div className="font-mono text-xs font-bold text-amber-500 tracking-wider flex items-center gap-2 flex-wrap">
                      {action.actionType}
                      <CyberBadge variant={action.riskLevel === 'HIGH' ? 'danger' : 'warning'} className="py-0">
                        {action.riskLevel}
                      </CyberBadge>
                    </div>
                    <div className="text-xs text-primary/70 mt-1 font-mono leading-relaxed">{action.description}</div>
                  </div>
                  <div className="pl-3 flex gap-2">
                    <CyberButton variant="success" onClick={() => handleConfirm(action.id, true)} className="flex-1 py-1 text-xs">
                      <CheckCircle className="w-3 h-3 mr-1" /> {t.approve}
                    </CyberButton>
                    <CyberButton variant="danger" onClick={() => handleConfirm(action.id, false)} className="flex-1 py-1 text-xs">
                      <XCircle className="w-3 h-3 mr-1" /> {t.deny}
                    </CyberButton>
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        </CyberPanel>
      </div>

      {/* ===== BOTTOM: Live Log Feed ===== */}
      <CyberPanel className="h-36 shrink-0 flex flex-col">
        <div className="flex items-center justify-between mb-2 border-b border-primary/20 pb-1 shrink-0">
          <div className="flex items-center gap-2">
            <Database className="w-3.5 h-3.5 text-primary" />
            <h3 className="text-[10px] font-mono uppercase tracking-widest text-primary/80">{t.liveFeed}</h3>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="relative flex h-1.5 w-1.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75"></span>
              <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-primary"></span>
            </span>
            <span className="text-[9px] font-mono text-primary/50 uppercase">LIVE</span>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto custom-scrollbar font-mono text-[10px] flex flex-col relative z-10">
          {logs?.map(log => {
            const colors = {
              INFO: 'text-primary', WARN: 'text-amber-500',
              ERROR: 'text-destructive', DEBUG: 'text-primary/50'
            };
            return (
              <div key={log.id} className="flex gap-2 py-0.5 hover:bg-primary/5 border-b border-primary/5 items-start">
                <span className="text-primary/30 shrink-0 w-16">{new Date(log.timestamp).toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
                <span className={cn("w-10 shrink-0 font-bold", colors[log.level as keyof typeof colors])}>{log.level}</span>
                <span className="text-primary/50 shrink-0 w-16 truncate hidden sm:block">[{log.source}]</span>
                <span className="text-primary/80 flex-1">{log.message}</span>
              </div>
            );
          })}
        </div>
      </CyberPanel>
    </div>
  );
}
