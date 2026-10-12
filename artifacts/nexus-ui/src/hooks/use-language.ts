import { useState, useCallback, createContext, useContext } from 'react';

export type Lang = 'en' | 'ne';

export const translations = {
  en: {
    appName: 'NEXUS OS',
    systemOnline: 'System Online',
    modules: 'Modules',
    hud: 'HUD',
    comms: 'Comms',
    memory: 'Memory',
    agents: 'Agents',
    sandbox: 'Sandbox',
    settings: 'Settings',
    cpuLoad: 'CPU Load',
    memLoad: 'Memory',
    netLoad: 'Network',
    battery: 'Battery',
    voiceComms: 'Voice Array',
    actionQueue: 'Action Queue',
    agentGrid: 'Agent Grid',
    liveFeed: 'Live Telemetry',
    pending: 'Pending',
    approve: 'Approve',
    deny: 'Deny',
    allClear: 'All clear. No pending requests.',
    transmit: 'Transmit Directive...',
    send: 'Send',
    listening: 'Listening...',
    wakeWord: 'Say "Nexus" to activate',
    weather: 'Weather',
    calendar: 'Calendar',
    temperature: 'Temp',
    humidity: 'Humidity',
    wind: 'Wind',
    today: 'Today',
    systemStatus: 'System Status',
    uptime: 'Uptime',
    activeAgents: 'Active Agents',
    secureNet: 'SECURE',
    language: 'Language',
    voice: 'Voice',
    voiceEnabled: 'Voice Enabled',
    voiceDisabled: 'Voice Disabled',
    ttsEnabled: 'TTS Enabled',
    liveMonitor: 'Live Monitor',
  },
  ne: {
    appName: 'NEXUS OS',
    systemOnline: 'प्रणाली अनलाइन',
    modules: 'मड्युलहरू',
    hud: 'HUD',
    comms: 'संचार',
    memory: 'स्मृति',
    agents: 'एजेन्टहरू',
    sandbox: 'स्यान्डबक्स',
    settings: 'सेटिङ',
    cpuLoad: 'CPU लोड',
    memLoad: 'मेमोरी',
    netLoad: 'नेटवर्क',
    battery: 'ब्याट्री',
    voiceComms: 'आवाज एरे',
    actionQueue: 'कार्य कतार',
    agentGrid: 'एजेन्ट ग्रिड',
    liveFeed: 'लाइभ टेलिमेट्री',
    pending: 'विचाराधीन',
    approve: 'स्वीकृत',
    deny: 'अस्वीकार',
    allClear: 'सब ठिक छ। कुनै विचाराधीन अनुरोध छैन।',
    transmit: 'निर्देशन प्रसारण गर्नुस्...',
    send: 'पठाउनुस्',
    listening: 'सुन्दैछु...',
    wakeWord: '"Nexus" भन्नुस् सक्रिय गर्न',
    weather: 'मौसम',
    calendar: 'क्यालेन्डर',
    temperature: 'तापक्रम',
    humidity: 'आर्द्रता',
    wind: 'हावा',
    today: 'आज',
    systemStatus: 'प्रणाली स्थिति',
    uptime: 'अपटाइम',
    activeAgents: 'सक्रिय एजेन्टहरू',
    secureNet: 'सुरक्षित',
    language: 'भाषा',
    voice: 'आवाज',
    voiceEnabled: 'आवाज सक्रिय',
    voiceDisabled: 'आवाज निष्क्रिय',
    ttsEnabled: 'TTS सक्रिय',
    liveMonitor: 'लाइभ निगरानी',
  }
} as const;

export type T = Record<keyof typeof translations.en, string>;

export function useLang() {
  const [lang, setLang] = useState<Lang>(() => {
    return (localStorage.getItem('nexus-lang') as Lang) || 'en';
  });

  const setLanguage = useCallback((l: Lang) => {
    setLang(l);
    localStorage.setItem('nexus-lang', l);
  }, []);

  const t = translations[lang];
  return { lang, setLanguage, t };
}

// Context for global access
import React from 'react';
interface LangContextType { lang: Lang; setLanguage: (l: Lang) => void; t: T; }
export const LangContext = createContext<LangContextType>({
  lang: 'en', setLanguage: () => {}, t: translations.en
});
export const useLangContext = () => useContext(LangContext);
export const LangProvider = ({ children }: { children: React.ReactNode }) => {
  const langState = useLang();
  return React.createElement(LangContext.Provider, { value: langState }, children);
};
