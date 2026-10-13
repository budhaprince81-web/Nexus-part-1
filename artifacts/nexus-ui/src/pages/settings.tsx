import React, { useState } from 'react';
import { CyberPanel, CyberBadge, CyberButton } from '@/components/ui/cyber';
import { Settings as SettingsIcon, Shield, Database, Activity, Globe, Mic, Volume2, Gauge, Sparkles, Server } from 'lucide-react';
import { ProviderStatusPanel } from '@/components/hud/provider-status';
import { useUiPrefs } from '@/hooks/use-ui-prefs';
import { useGetTelemetry, getGetTelemetryQueryKey } from '@workspace/api-client-react';
import { useLangContext } from '@/hooks/use-language';
import { useVoice } from '@/hooks/use-voice';
import { VoiceIndicator } from '@/components/hud/voice-indicator';
import { cn } from '@/lib/utils';

export default function Settings() {
  const { data: telemetry } = useGetTelemetry({ query: { queryKey: getGetTelemetryQueryKey() } });
  const { t, lang, setLanguage } = useLangContext();
  const [ttsEnabled, setTtsEnabled] = useState(true);
  const [voiceRate, setVoiceRate] = useState(0.95);
  const [wakeWordEnabled, setWakeWordEnabled] = useState(true);
  const { prefs, update } = useUiPrefs();

  const voice = useVoice({ wakeWord: 'nexus', lang: lang === 'ne' ? 'ne-NP' : 'en-US', ttsEnabled });

  const testTts = () => {
    voice.speak(lang === 'ne' ? 'नमस्ते, म NEXUS हुँ। तपाईंको AI सहायक।' : 'Hello. I am NEXUS, your AI operating system. All systems are online.');
  };

  return (
    <div className="max-w-5xl mx-auto h-full flex flex-col gap-5">
      <CyberPanel className="shrink-0 flex items-center gap-4 border-b-2 border-primary">
        <SettingsIcon className="w-7 h-7 text-primary" />
        <div>
          <h2 className="font-mono text-lg text-primary tracking-widest uppercase">{t.settings} — System Configuration</h2>
          <p className="font-mono text-[10px] text-primary/50 uppercase">NEXUS Core Operating Parameters</p>
        </div>
      </CyberPanel>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-5 overflow-y-auto custom-scrollbar pr-1 pb-6">

        {/* Language */}
        <CyberPanel className="flex flex-col gap-4">
          <div className="flex items-center gap-3 border-b border-primary/20 pb-3">
            <Globe className="w-5 h-5 text-primary" />
            <h3 className="font-mono text-base text-primary uppercase tracking-widest">{t.language}</h3>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <button
              onClick={() => setLanguage('en')}
              className={cn(
                "p-4 border font-mono text-sm uppercase tracking-widest transition-all",
                lang === 'en'
                  ? 'border-primary bg-primary/15 text-primary shadow-[0_0_15px_rgba(0,212,255,0.2)]'
                  : 'border-primary/20 text-primary/50 hover:border-primary/50'
              )}
            >
              <div className="text-2xl mb-2">🇺🇸</div>
              <div>English</div>
            </button>
            <button
              onClick={() => setLanguage('ne')}
              className={cn(
                "p-4 border font-mono text-sm uppercase tracking-widest transition-all",
                lang === 'ne'
                  ? 'border-primary bg-primary/15 text-primary shadow-[0_0_15px_rgba(0,212,255,0.2)]'
                  : 'border-primary/20 text-primary/50 hover:border-primary/50'
              )}
            >
              <div className="text-2xl mb-2">🇳🇵</div>
              <div>नेपाली</div>
            </button>
          </div>
          <div className="font-mono text-xs text-primary/40 uppercase tracking-wider">
            Active: {lang === 'en' ? 'English (en-US)' : 'Nepali (ne-NP)'}
          </div>
        </CyberPanel>

        {/* Voice */}
        <CyberPanel className="flex flex-col gap-4">
          <div className="flex items-center gap-3 border-b border-primary/20 pb-3">
            <Mic className="w-5 h-5 text-primary" />
            <h3 className="font-mono text-base text-primary uppercase tracking-widest">{t.voice}</h3>
          </div>

          <div className="flex flex-col items-center gap-4">
            <VoiceIndicator
              state={voice.state}
              wakeWordDetected={voice.wakeWordDetected}
              transcript={voice.transcript}
              enabled={voice.enabled}
              onToggle={voice.toggle}
              supported={voice.supported}
              errorKind={voice.errorKind}
              onStopSpeaking={voice.stopSpeaking}
            />
          </div>

          <div className="space-y-3 font-mono text-xs border-t border-primary/10 pt-3">
            <div className="flex justify-between items-center py-1.5 hover:bg-primary/5 px-2 transition-colors">
              <span className="text-primary/60 uppercase">Wake Word</span>
              <div className="flex items-center gap-2">
                <span className="text-primary font-bold">"Nexus"</span>
                <button
                  onClick={() => setWakeWordEnabled(p => !p)}
                  className={cn("w-8 h-4 border transition-all", wakeWordEnabled ? 'border-primary bg-primary/30' : 'border-primary/20 bg-primary/5')}
                />
              </div>
            </div>
            <div className="flex justify-between items-center py-1.5 hover:bg-primary/5 px-2 transition-colors">
              <span className="text-primary/60 uppercase">TTS (Text-to-Speech)</span>
              <button
                onClick={() => setTtsEnabled(p => !p)}
                className={cn("px-3 py-1 border text-[10px] uppercase tracking-wider transition-all",
                  ttsEnabled ? 'border-emerald-500 bg-emerald-500/10 text-emerald-400' : 'border-primary/20 text-primary/40')}
              >
                {ttsEnabled ? 'ON' : 'OFF'}
              </button>
            </div>
            <div className="flex justify-between items-center py-1.5 hover:bg-primary/5 px-2 transition-colors">
              <span className="text-primary/60 uppercase">STT Language</span>
              <span className="text-primary">{lang === 'ne' ? 'ne-NP' : 'en-US'}</span>
            </div>
          </div>

          <CyberButton onClick={testTts} className="text-xs py-2">
            <Volume2 className="w-4 h-4 mr-2" />
            {lang === 'ne' ? 'TTS परीक्षण गर्नुस्' : 'Test Voice Output'}
          </CyberButton>
        </CyberPanel>

        {/* Multi-provider AI configuration (live status + real telemetry) */}
        <div className="flex flex-col gap-3">
          <ProviderStatusPanel />
          <CyberPanel className="flex flex-col gap-3">
            <div className="flex items-center gap-3 border-b border-primary/20 pb-3">
              <Server className="w-5 h-5 text-primary" />
              <h3 className="font-mono text-base text-primary uppercase tracking-widest">Provider Setup</h3>
            </div>
            <div className="space-y-2 font-mono text-[11px] text-primary/60 leading-relaxed px-1">
              <p>
                Credentials live only in server-side environment variables
                (Replit Secrets) and are never sent to this browser.
              </p>
              <div className="border border-primary/10 p-2 bg-primary/[0.03]">
                <div className="text-primary/40 uppercase text-[9px] mb-1">Default &amp; fallback</div>
                <div className="text-primary/70">
                  NEXUS_DEFAULT_PROVIDER · NEXUS_FALLBACK_PROVIDERS
                </div>
              </div>
              <div className="border border-primary/10 p-2 bg-primary/[0.03]">
                <div className="text-primary/40 uppercase text-[9px] mb-1">Optional tuning</div>
                <div className="text-primary/70">
                  NEXUS_AI_TIMEOUT_MS · NEXUS_AI_MAX_RETRIES · NEXUS_AI_RETRY_BASE_MS ·
                  &lt;PROVIDER&gt;_MODEL
                </div>
              </div>
              <p className="text-primary/40">
                After changing secrets, press the refresh icon above to reload the
                provider registry without restarting the service.
              </p>
            </div>
          </CyberPanel>
        </div>

        {/* Interface intensity & accessibility */}
        <CyberPanel className="flex flex-col gap-4">
          <div className="flex items-center gap-3 border-b border-primary/20 pb-3">
            {prefs.lowResource ? (
              <Gauge className="w-5 h-5 text-primary" />
            ) : (
              <Sparkles className="w-5 h-5 text-primary" />
            )}
            <h3 className="font-mono text-base text-primary uppercase tracking-widest">Interface</h3>
          </div>

          <div className="space-y-3 font-mono text-xs px-2">
            <div className="flex justify-between items-center py-1.5 hover:bg-primary/5 px-2 transition-colors">
              <div className="flex flex-col">
                <span className="text-primary/60 uppercase">Low-resource mode</span>
                <span className="text-[9px] text-primary/30">
                  Disables particles, scanlines and blur
                </span>
              </div>
              <button
                onClick={() => update({ lowResource: !prefs.lowResource })}
                aria-pressed={prefs.lowResource}
                className={cn(
                  'px-3 py-1 border text-[10px] uppercase tracking-wider transition-all',
                  prefs.lowResource
                    ? 'border-emerald-500 bg-emerald-500/10 text-emerald-400'
                    : 'border-primary/20 text-primary/40',
                )}
              >
                {prefs.lowResource ? 'ON' : 'OFF'}
              </button>
            </div>

            <div className="flex justify-between items-center py-1.5 hover:bg-primary/5 px-2 transition-colors">
              <div className="flex flex-col">
                <span className="text-primary/60 uppercase">Animation</span>
                <span className="text-[9px] text-primary/30">
                  System follows your OS accessibility setting
                </span>
              </div>
              <div className="flex gap-1">
                {(['system', 'full', 'reduced'] as const).map((mode) => (
                  <button
                    key={mode}
                    onClick={() => update({ motion: mode })}
                    className={cn(
                      'px-2 py-1 border text-[10px] uppercase tracking-wider transition-all',
                      prefs.motion === mode
                        ? 'border-primary bg-primary/15 text-primary'
                        : 'border-primary/20 text-primary/40 hover:border-primary/40',
                    )}
                  >
                    {mode}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex justify-between items-center py-1.5 px-2">
              <span className="text-primary/60 uppercase">Keyboard navigation</span>
              <span className="text-emerald-400 text-[10px] uppercase">Enabled</span>
            </div>
            <div className="flex justify-between items-center py-1.5 px-2">
              <span className="text-primary/60 uppercase">Skip boot sequence</span>
              <span className="text-primary/50 text-[10px] uppercase">
                {prefs.lowResource ? 'On (low-resource)' : 'Press any key'}
              </span>
            </div>
          </div>
        </CyberPanel>

        {/* Security */}
        <CyberPanel className="flex flex-col gap-4">
          <div className="flex items-center gap-3 border-b border-primary/20 pb-3">
            <Shield className="w-5 h-5 text-primary" />
            <h3 className="font-mono text-base text-primary uppercase tracking-widest">Security</h3>
          </div>
          <div className="space-y-3 font-mono text-xs px-2">
            {[
              { label: 'Sandbox Engine', badge: <CyberBadge variant="success">ISOLATED</CyberBadge> },
              { label: 'Auto-Approve Actions', badge: <CyberBadge variant="danger">DISABLED</CyberBadge> },
              { label: 'Network Access', badge: <CyberBadge variant="warning">RESTRICTED</CyberBadge> },
              { label: 'Guardrail Stages', value: '5' },
              { label: 'Rate Limit', value: '20/min' },
            ].map(({ label, badge, value }) => (
              <div key={label} className="flex justify-between items-center py-2 border-b border-primary/5 hover:bg-primary/5 px-2 transition-colors">
                <span className="text-primary/60 uppercase">{label}</span>
                <div className="flex items-center gap-2">
                  {badge}
                  {value && <span className="text-primary font-bold">{value}</span>}
                </div>
              </div>
            ))}
          </div>
        </CyberPanel>

        {/* Memory Metrics */}
        <CyberPanel className="flex flex-col gap-4">
          <div className="flex items-center gap-3 border-b border-primary/20 pb-3">
            <Database className="w-5 h-5 text-primary" />
            <h3 className="font-mono text-base text-primary uppercase tracking-widest">{t.memory} Metrics</h3>
          </div>
          <div className="space-y-3 font-mono text-xs px-2">
            {[
              { label: 'Total Records', value: telemetry?.memoryRecords || 0 },
              { label: 'RAM Used', value: `${telemetry?.memoryUsedMb || 0} MB` },
              { label: 'RAM Total', value: `${telemetry?.memoryTotalMb || 0} MB` },
              { label: 'Search Engine', value: 'Full-Text' },
            ].map(({ label, value }) => (
              <div key={label} className="flex justify-between items-center py-2 border-b border-primary/5 hover:bg-primary/5 px-2 transition-colors">
                <span className="text-primary/60 uppercase">{label}</span>
                <span className="text-primary font-bold">{value}</span>
              </div>
            ))}
          </div>
        </CyberPanel>

        {/* System Health */}
        <CyberPanel className="flex flex-col gap-4">
          <div className="flex items-center gap-3 border-b border-primary/20 pb-3">
            <Activity className="w-5 h-5 text-primary" />
            <h3 className="font-mono text-base text-primary uppercase tracking-widest">System Health</h3>
          </div>
          <div className="space-y-3 font-mono text-xs px-2">
            {[
              { label: t.uptime, value: `${Math.floor((telemetry?.uptimeSeconds || 0) / 3600)}h ${Math.floor(((telemetry?.uptimeSeconds || 0) % 3600) / 60)}m` },
              { label: t.activeAgents, value: telemetry?.activeAgents || 0 },
              { label: 'Pending Actions', value: telemetry?.pendingActions || 0 },
              { label: 'CPU %', value: `${Math.round(telemetry?.cpuPercent || 0)}%` },
              { label: 'Mem %', value: `${Math.round(telemetry?.memoryPercent || 0)}%` },
            ].map(({ label, value }) => (
              <div key={label} className="flex justify-between items-center py-2 border-b border-primary/5 hover:bg-primary/5 px-2 transition-colors">
                <span className="text-primary/60 uppercase">{label}</span>
                <span className="text-primary font-bold">{value}</span>
              </div>
            ))}
          </div>
        </CyberPanel>
      </div>
    </div>
  );
}
