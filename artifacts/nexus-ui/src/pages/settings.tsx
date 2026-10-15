import React, { useState } from 'react';
import { CyberPanel, CyberBadge, CyberButton } from '@/components/ui/cyber';
import { Settings as SettingsIcon, Shield, Database, Activity, Globe, Mic, Volume2, Gauge, Sparkles, Server, Square, AlertTriangle } from 'lucide-react';
import { ProviderStatusPanel } from '@/components/hud/provider-status';
import { useUiPrefs } from '@/hooks/use-ui-prefs';
import { useGetTelemetry, getGetTelemetryQueryKey } from '@workspace/api-client-react';
import { useLangContext } from '@/hooks/use-language';
import { useVoice } from '@/hooks/use-voice';
import { VoiceIndicator } from '@/components/hud/voice-indicator';
import { cn } from '@/lib/utils';
import { hasVoiceForLanguage } from '@/lib/speech';

export default function Settings() {
  const { data: telemetry } = useGetTelemetry({ query: { queryKey: getGetTelemetryQueryKey() } });
  const { t, lang, setLanguage } = useLangContext();
  const [wakeWordEnabled, setWakeWordEnabled] = useState(true);
  const { prefs, update } = useUiPrefs();

  // Everything voice-related now lives in the shared provider, so a change here
  // immediately affects the chat page (it previously kept its own private copy).
  const voice = useVoice();
  const {
    ttsEnabled, setTtsEnabled, voiceRate, setVoiceRate, voicePitch, setVoicePitch,
    availableVoices, selectedVoiceURI, setSelectedVoiceURI, ttsSupported,
    sttSupported, ttsNotice, ttsError, conversationMode, setConversationMode,
    commandMode, setCommandMode,
  } = voice;

  const nepalVoiceInstalled = hasVoiceForLanguage(voice.allVoices, 'ne');

  const testTts = () => voice.testVoice();

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
              enabled={voice.sttEnabled}
              onToggle={voice.toggleMic}
              supported={voice.sttSupported}
              errorKind={voice.errorKind}
              onStopSpeaking={voice.stopSpeaking}
            />
            <p className="font-mono text-[10px] text-primary/40 text-center max-w-[260px] leading-snug">
              The round button controls the <span className="text-primary/70">microphone</span>.
              Spoken replies are controlled by Voice Output below — they are independent.
            </p>
          </div>

          <div className="space-y-3 font-mono text-xs border-t border-primary/10 pt-3">
            {[
              {
                label: 'Speech Recognition',
                value: sttSupported ? 'AVAILABLE' : 'UNSUPPORTED',
                good: sttSupported,
              },
              {
                label: 'Speech Synthesis',
                value: ttsSupported ? 'AVAILABLE' : 'UNSUPPORTED',
                good: ttsSupported,
              },
            ].map(({ label, value, good }) => (
              <div key={label} className="flex justify-between items-center py-1.5 px-2">
                <span className="text-primary/60 uppercase">{label}</span>
                <span className={good ? 'text-emerald-400' : 'text-destructive'}>{value}</span>
              </div>
            ))}

            <div className="flex justify-between items-center py-1.5 hover:bg-primary/5 px-2 transition-colors">
              <span className="text-primary/60 uppercase">Wake Word</span>
              <div className="flex items-center gap-2">
                <span className="text-primary font-bold">"Nexus"</span>
                <button
                  onClick={() => setWakeWordEnabled(p => !p)}
                  aria-pressed={wakeWordEnabled}
                  aria-label="Toggle wake word"
                  className={cn("w-8 h-4 border transition-all", wakeWordEnabled ? 'border-primary bg-primary/30' : 'border-primary/20 bg-primary/5')}
                />
              </div>
            </div>

            <div className="flex justify-between items-center py-1.5 hover:bg-primary/5 px-2 transition-colors">
              <span className="text-primary/60 uppercase">Voice Output (TTS)</span>
              <button
                onClick={() => setTtsEnabled(!ttsEnabled)}
                aria-pressed={ttsEnabled}
                className={cn("px-3 py-1 border text-[10px] uppercase tracking-wider transition-all",
                  ttsEnabled ? 'border-emerald-500 bg-emerald-500/10 text-emerald-400' : 'border-primary/20 text-primary/40')}
              >
                {ttsEnabled ? 'ON' : 'OFF'}
              </button>
            </div>

            <div className="flex justify-between items-center py-1.5 hover:bg-primary/5 px-2 transition-colors">
              <span className="text-primary/60 uppercase">Voice Conversation Mode</span>
              <button
                onClick={() => setConversationMode(!conversationMode)}
                aria-pressed={conversationMode}
                title="Hands-free: a finished sentence is sent to the model automatically"
                className={cn("px-3 py-1 border text-[10px] uppercase tracking-wider transition-all",
                  conversationMode ? 'border-emerald-500 bg-emerald-500/10 text-emerald-400' : 'border-primary/20 text-primary/40')}
              >
                {conversationMode ? 'ON' : 'OFF'}
              </button>
            </div>

            <div className="flex justify-between items-center py-1.5 hover:bg-primary/5 px-2 transition-colors">
              <div className="flex flex-col">
                <span className="text-primary/60 uppercase">Spoken Navigation</span>
                <span className="text-[9px] text-primary/30">
                  Requires "Nexus" or "open …". Off means transcripts only fill the composer.
                </span>
              </div>
              <button
                onClick={() => setCommandMode(!commandMode)}
                aria-pressed={commandMode}
                className={cn("px-3 py-1 border text-[10px] uppercase tracking-wider transition-all shrink-0",
                  commandMode ? 'border-emerald-500 bg-emerald-500/10 text-emerald-400' : 'border-primary/20 text-primary/40')}
              >
                {commandMode ? 'ON' : 'OFF'}
              </button>
            </div>

            <div className="flex justify-between items-center py-1.5 hover:bg-primary/5 px-2 transition-colors">
              <span className="text-primary/60 uppercase">STT Language</span>
              <span className="text-primary">{lang === 'ne' ? 'ne-NP' : 'en-US'}</span>
            </div>

            {/* Voice picker: only voices installed on this device are offered. */}
            <div className="flex flex-col gap-1 py-1.5 px-2">
              <div className="flex justify-between items-center">
                <span className="text-primary/60 uppercase">Output Voice</span>
                <span className="text-primary/40 text-[9px] uppercase">
                  {availableVoices.length} for {lang === 'ne' ? 'ne-NP' : 'en-US'}
                </span>
              </div>
              <select
                value={selectedVoiceURI}
                onChange={(e) => setSelectedVoiceURI(e.target.value)}
                aria-label="Voice output voice"
                className="w-full bg-background border border-primary/25 text-primary font-mono text-[11px] px-2 py-1.5"
              >
                <option value="">Automatic (best available)</option>
                {availableVoices.map((v) => (
                  <option key={v.voiceURI} value={v.voiceURI}>
                    {v.name} — {v.lang}
                  </option>
                ))}
              </select>
              {availableVoices.length === 0 && (
                <span className="text-amber-400/80 text-[9px] leading-snug">
                  No voice for this language is installed on this device.
                </span>
              )}
            </div>

            <div className="flex flex-col gap-1 py-1.5 px-2">
              <div className="flex justify-between">
                <span className="text-primary/60 uppercase">Speech Rate</span>
                <span className="text-primary">{voiceRate.toFixed(2)}×</span>
              </div>
              <input
                type="range"
                min={0.5}
                max={1.6}
                step={0.05}
                value={voiceRate}
                onChange={(e) => setVoiceRate(Number(e.target.value))}
                aria-label="Speech rate"
                className="w-full accent-cyan-400"
              />
            </div>

            <div className="flex flex-col gap-1 py-1.5 px-2">
              <div className="flex justify-between">
                <span className="text-primary/60 uppercase">Pitch</span>
                <span className="text-primary">{voicePitch.toFixed(2)}</span>
              </div>
              <input
                type="range"
                min={0.5}
                max={1.6}
                step={0.05}
                value={voicePitch}
                onChange={(e) => setVoicePitch(Number(e.target.value))}
                aria-label="Speech pitch"
                className="w-full accent-cyan-400"
              />
            </div>
          </div>

          {/* Honest language support: never claim a Nepali voice exists when it
              does not. */}
          {lang === 'ne' && !nepalVoiceInstalled && (
            <div className="border border-amber-500/40 bg-amber-500/5 px-3 py-2 flex items-start gap-2">
              <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" />
              <span className="font-mono text-[10px] text-amber-200/90 leading-snug">
                No Nepali (ne-NP) voice is installed on this device, so Nepali replies
                will be read with the closest available voice and may sound wrong.
                Nepali <span className="text-amber-300">speech recognition</span> is also
                browser-dependent — Chrome and Edge generally do not ship a ne-NP
                recogniser. English works everywhere.
              </span>
            </div>
          )}

          {(ttsError || ttsNotice) && (
            <div className="border border-primary/25 bg-primary/5 px-3 py-2 font-mono text-[10px] text-primary/70 leading-snug">
              {ttsError ?? ttsNotice}
            </div>
          )}

          <div className="flex gap-2">
            <CyberButton onClick={testTts} className="text-xs py-2 flex-1" disabled={!ttsSupported}>
              <Volume2 className="w-4 h-4 mr-2" />
              {lang === 'ne' ? 'TTS परीक्षण गर्नुस्' : 'Test Voice Output'}
            </CyberButton>
            {voice.isSpeaking && (
              <CyberButton onClick={voice.stopSpeaking} className="text-xs py-2">
                <Square className="w-4 h-4 mr-2" />
                Stop
              </CyberButton>
            )}
          </div>
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
