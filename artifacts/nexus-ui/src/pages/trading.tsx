import { useMemo, useState } from 'react';
import { useLangContext } from '@/hooks/use-language';
import { AlertTriangle, ArrowDownRight, ArrowUpRight, Check, CircleHelp, RotateCcw, ShieldCheck, SlidersHorizontal, Sparkles, Waypoints } from 'lucide-react';

type FieldKey = 'capital' | 'riskPercent' | 'entry' | 'stop' | 'target';
type ChecklistKey = 'thesis' | 'invalidation' | 'size' | 'conditions';

const INITIAL_INPUTS: Record<FieldKey, string> = {
  capital: '',
  riskPercent: '1',
  entry: '',
  stop: '',
  target: '',
};

const COPY = {
  en: {
    eyebrow: 'NEXUS / PERSONAL FINANCE TOOLS',
    title: 'Risk, made visible.',
    subtitle: 'A quiet space to map a hypothetical position before you act.',
    inputTag: '01 / YOUR ASSUMPTIONS',
    setupTitle: 'Position parameters',
    setupDescription: 'Use one consistent currency and price unit throughout.',
    capital: 'Account capital',
    capitalHint: 'Capital considered for this plan',
    riskPercent: 'Risk per plan',
    riskHint: 'Percentage of account capital',
    entry: 'Entry price',
    stop: 'Stop price',
    target: 'Target price',
    unit: 'Currency / price unit',
    unitHint: 'Example: USD, NPR, points',
    direction: 'Scenario direction',
    long: 'Long scenario',
    short: 'Short scenario',
    auto: 'Detected from prices',
    calculations: '02 / PLANNING SNAPSHOT',
    metricsTitle: 'If these inputs hold',
    emptyTitle: 'Your plan starts with five inputs.',
    emptyBody: 'Add account capital, a risk percentage, and three price levels to see a mathematical scenario. Nothing here is a quote or a recommendation.',
    riskBudget: 'Risk budget',
    unitRisk: 'Risk per unit',
    quantity: 'Estimated quantity',
    maxLoss: 'Maximum planned loss',
    reward: 'Potential gross reward',
    ratio: 'Reward / risk',
    units: 'units',
    ratioUnit: 'to 1',
    formulaTitle: 'How this is calculated',
    formulaBody: 'Risk budget = capital × risk %. Quantity = risk budget ÷ absolute entry-to-stop distance. Gross reward = quantity × absolute target-to-entry distance.',
    checklistTag: '03 / BEFORE YOU PROCEED',
    checklistTitle: 'Pause & verify',
    checklistIntro: 'A planning prompt, not a permission slip.',
    checklist: [
      'I can explain the reason for this hypothetical plan.',
      'I know what would invalidate the idea.',
      'The estimated size is within my own limits.',
      'I have considered market conditions and gaps.',
    ],
    checked: 'complete',
    reset: 'Reset planner',
    guardrailTitle: 'A tool, not a signal.',
    guardrailBody: 'All values come only from your inputs. There are no live quotes. Fees, slippage, tax, and contract multipliers are excluded. Options and instruments with multipliers are not supported.',
    disclaimer: 'For informational and educational use only. This is not financial advice and is not a recommendation to buy or sell. It does not execute orders or connect to a bank or broker. No accuracy or profit is promised.',
    localNote: 'Your financial inputs stay in this page only and are not stored.',
    invalidTitle: 'Check the plan inputs',
    invalidCapital: 'Enter account capital greater than zero.',
    invalidRiskPercent: 'Risk percentage must be greater than 0 and no more than 100.',
    invalidPrices: 'Enter positive, finite values for entry, stop, and target.',
    invalidDirection: 'Prices must form a clear scenario: long requires stop < entry < target; short requires target < entry < stop.',
    invalidOverflow: 'These values are outside the calculator’s supported numeric range.',
    validLong: 'Long scenario detected',
    validShort: 'Short scenario detected',
    setupStatus: 'Inputs are private to this session',
    noChecks: 'No checklist items completed',
    checks: 'items checked',
    whatIncluded: 'Linear instrument · 1× assumed',
    liveData: 'OFFLINE BY DESIGN',
    riskNotice: 'Loss estimate assumes the stop is filled at its stated price.',
    disclaimerShort: 'No orders · No market feed · No advice',
  },
  ne: {
    eyebrow: 'नेक्सस / व्यक्तिगत वित्त उपकरण',
    title: 'जोखिम, स्पष्ट रूपमा।',
    subtitle: 'कार्य गर्नुअघि सम्भावित पोजिसनको योजना बनाउन शान्त ठाउँ।',
    inputTag: '०१ / तपाईंका अनुमान',
    setupTitle: 'पोजिसनका मापदण्ड',
    setupDescription: 'सबै ठाउँमा एउटै मुद्रा र मूल्य एकाइ प्रयोग गर्नुहोस्।',
    capital: 'खाताको पूँजी',
    capitalHint: 'यो योजनाका लागि विचार गरिएको पूँजी',
    riskPercent: 'प्रति योजनाको जोखिम',
    riskHint: 'खाताको पूँजीको प्रतिशत',
    entry: 'प्रवेश मूल्य',
    stop: 'स्टप मूल्य',
    target: 'लक्ष्य मूल्य',
    unit: 'मुद्रा / मूल्य एकाइ',
    unitHint: 'उदाहरण: USD, NPR, पोइन्ट',
    direction: 'परिदृश्यको दिशा',
    long: 'लङ परिदृश्य',
    short: 'सर्ट परिदृश्य',
    auto: 'मूल्यबाट पहिचान',
    calculations: '०२ / योजना सारांश',
    metricsTitle: 'यी इनपुट कायम रहेमा',
    emptyTitle: 'तपाईंको योजना पाँच इनपुटबाट सुरु हुन्छ।',
    emptyBody: 'गणितीय परिदृश्य हेर्न खाताको पूँजी, जोखिम प्रतिशत र तीन मूल्य तह थप्नुहोस्। यहाँ कुनै पनि कुरा बजार मूल्य वा सिफारिस होइन।',
    riskBudget: 'जोखिम बजेट',
    unitRisk: 'प्रति एकाइ जोखिम',
    quantity: 'अनुमानित परिमाण',
    maxLoss: 'अधिकतम योजनाबद्ध नोक्सानी',
    reward: 'सम्भावित कुल प्रतिफल',
    ratio: 'प्रतिफल / जोखिम',
    units: 'एकाइ',
    ratioUnit: 'को १',
    formulaTitle: 'यो कसरी गणना हुन्छ',
    formulaBody: 'जोखिम बजेट = पूँजी × जोखिम %. परिमाण = जोखिम बजेट ÷ प्रवेश र स्टपको निरपेक्ष दूरी। कुल प्रतिफल = परिमाण × लक्ष्य र प्रवेशको निरपेक्ष दूरी।',
    checklistTag: '०३ / अघि बढ्नुअघि',
    checklistTitle: 'रोक्नुहोस् र जाँच्नुहोस्',
    checklistIntro: 'योजना बनाउने सम्झना हो, अनुमति होइन।',
    checklist: [
      'यो सम्भावित योजनाको कारण म स्पष्ट गर्न सक्छु।',
      'यो विचार अमान्य हुने अवस्था मलाई थाहा छ।',
      'अनुमानित आकार मेरो आफ्नै सीमाभित्र छ।',
      'मैले बजार अवस्था र मूल्य अन्तरबारे विचार गरेको छु।',
    ],
    checked: 'पूरा',
    reset: 'योजना रिसेट',
    guardrailTitle: 'यो उपकरण हो, संकेत होइन।',
    guardrailBody: 'सबै मान तपाईंका इनपुटबाट मात्र आउँछन्। कुनै लाइभ मूल्य छैन। शुल्क, स्लिपेज, कर र कन्ट्र्याक्ट मल्टिप्लायर समावेश छैनन्। विकल्प कारोबार र मल्टिप्लायर भएका उपकरण समर्थित छैनन्।',
    disclaimer: 'जानकारी र शिक्षाका लागि मात्र। यो वित्तीय सल्लाह वा किन्न/बेच्न सिफारिस होइन। यसले अर्डर कार्यान्वयन गर्दैन र बैंक वा ब्रोकरसँग जोडिँदैन। शुद्धता वा नाफाको कुनै प्रत्याभूति छैन।',
    localNote: 'तपाईंका वित्तीय इनपुट यही पृष्ठमा मात्र रहन्छन् र भण्डारण हुँदैनन्।',
    invalidTitle: 'योजनाका इनपुट जाँच्नुहोस्',
    invalidCapital: 'शून्यभन्दा ठूलो खाताको पूँजी लेख्नुहोस्।',
    invalidRiskPercent: 'जोखिम प्रतिशत ० भन्दा ठूलो र १०० भन्दा बढी हुनु हुँदैन।',
    invalidPrices: 'प्रवेश, स्टप र लक्ष्यका लागि सकारात्मक, सीमित मान लेख्नुहोस्।',
    invalidDirection: 'मूल्यले स्पष्ट परिदृश्य बनाउनुपर्छ: लङका लागि स्टप < प्रवेश < लक्ष्य; सर्टका लागि लक्ष्य < प्रवेश < स्टप।',
    invalidOverflow: 'यी मान क्याल्कुलेटरको समर्थित संख्यात्मक सीमाभन्दा बाहिर छन्।',
    validLong: 'लङ परिदृश्य पहिचान भयो',
    validShort: 'सर्ट परिदृश्य पहिचान भयो',
    setupStatus: 'इनपुट यो सत्रमा निजी रहन्छ',
    noChecks: 'चेकलिस्टको कुनै बुँदा पूरा छैन',
    checks: 'बुँदा जाँचिए',
    whatIncluded: 'रेखीय उपकरण · १× मानिएको',
    liveData: 'लाइभ डेटा छैन',
    riskNotice: 'स्टप तोकिएको मूल्यमा भरिएको मान्दै नोक्सानी अनुमान गरिएको छ।',
    disclaimerShort: 'अर्डर छैन · बजार फिड छैन · सल्लाह होइन',
  },
} as const;

const CHECKLIST_KEYS: ChecklistKey[] = ['thesis', 'invalidation', 'size', 'conditions'];

function parsePositive(value: string): number | null {
  if (value.trim() === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function formatNumber(value: number, locale: string): string {
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 4 }).format(value);
}

export default function Trading() {
  const { lang } = useLangContext();
  const copy = COPY[lang === 'ne' ? 'ne' : 'en'];
  const [inputs, setInputs] = useState(INITIAL_INPUTS);
  const [currency, setCurrency] = useState('');
  const [checked, setChecked] = useState<Record<ChecklistKey, boolean>>({
    thesis: false,
    invalidation: false,
    size: false,
    conditions: false,
  });

  const result = useMemo(() => {
    const capital = parsePositive(inputs.capital);
    const riskPercent = parsePositive(inputs.riskPercent);
    const entry = parsePositive(inputs.entry);
    const stop = parsePositive(inputs.stop);
    const target = parsePositive(inputs.target);

    if (!capital || !riskPercent || !entry || !stop || !target) {
      const errors: string[] = [];
      if (inputs.capital.trim() && !capital) errors.push(copy.invalidCapital);
      if (inputs.riskPercent.trim() && (!riskPercent || riskPercent > 100)) errors.push(copy.invalidRiskPercent);
      if ([inputs.entry, inputs.stop, inputs.target].some((value) => value.trim() && !parsePositive(value))) errors.push(copy.invalidPrices);
      return { kind: errors.length ? 'invalid' as const : 'empty' as const, errors };
    }

    if (riskPercent > 100) return { kind: 'invalid' as const, errors: [copy.invalidRiskPercent] };

    const direction = stop < entry && entry < target ? 'long' : target < entry && entry < stop ? 'short' : null;
    if (!direction) return { kind: 'invalid' as const, errors: [copy.invalidDirection] };

    const riskBudget = capital * (riskPercent / 100);
    const perUnitRisk = Math.abs(entry - stop);
    const quantity = riskBudget / perUnitRisk;
    const maximumLoss = quantity * perUnitRisk;
    const grossReward = quantity * Math.abs(target - entry);
    const rewardRisk = grossReward / maximumLoss;
    if (![riskBudget, perUnitRisk, quantity, maximumLoss, grossReward, rewardRisk].every(Number.isFinite)) {
      return { kind: 'invalid' as const, errors: [copy.invalidOverflow] };
    }
    return { kind: 'valid' as const, direction, riskBudget, perUnitRisk, quantity, maximumLoss, grossReward, rewardRisk };
  }, [inputs, copy]);

  const update = (key: FieldKey, value: string) => setInputs((current) => ({ ...current, [key]: value }));
  const reset = () => {
    setInputs(INITIAL_INPUTS);
    setCurrency('');
    setChecked({ thesis: false, invalidation: false, size: false, conditions: false });
  };
  const checkedCount = Object.values(checked).filter(Boolean).length;
  const locale = lang === 'ne' ? 'ne-NP' : 'en-US';
  const currencyPrefix = currency.trim() ? `${currency.trim().toUpperCase()} ` : '';
  const money = (value: number) => `${currencyPrefix}${formatNumber(value, locale)}`;

  const fields: { key: FieldKey; label: string; hint?: string; step: string; min?: string; suffix?: string }[] = [
    { key: 'capital', label: copy.capital, hint: copy.capitalHint, step: 'any', min: '0' },
    { key: 'riskPercent', label: copy.riskPercent, hint: copy.riskHint, step: 'any', min: '0', suffix: '%' },
    { key: 'entry', label: copy.entry, step: 'any', min: '0' },
    { key: 'stop', label: copy.stop, step: 'any', min: '0' },
    { key: 'target', label: copy.target, step: 'any', min: '0' },
  ];

  return (
    <main className="min-h-[100dvh] w-full px-4 py-5 text-foreground sm:px-6 sm:py-8 lg:px-10">
      <div className="mx-auto max-w-7xl">
        <header className="relative mb-6 overflow-hidden border border-primary/20 bg-gradient-to-br from-primary/[0.09] via-background/60 to-emerald-400/[0.04] p-5 sm:p-7">
          <div className="pointer-events-none absolute -right-8 -top-16 h-56 w-56 rounded-full border border-primary/10" />
          <div className="pointer-events-none absolute -right-2 -top-10 h-44 w-44 rounded-full border border-primary/10" />
          <div className="relative z-10 flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
            <div className="max-w-2xl">
              <div className="mb-3 flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.22em] text-primary/70">
                <Waypoints className="h-3.5 w-3.5" aria-hidden="true" />
                {copy.eyebrow}
              </div>
              <h1 className="font-mono text-3xl font-bold tracking-tight text-foreground sm:text-4xl">{copy.title}</h1>
              <p className="mt-2 max-w-xl text-sm leading-relaxed text-muted-foreground sm:text-base">{copy.subtitle}</p>
            </div>
            <div className="inline-flex w-fit items-center gap-2 border border-primary/20 bg-background/40 px-3 py-2 font-mono text-[10px] tracking-wider text-primary/80">
              <span className="relative flex h-2 w-2" aria-hidden="true">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-30" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-primary" />
              </span>
              {copy.liveData}
            </div>
          </div>
          <div className="relative z-10 mt-5 flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-primary/10 pt-3 font-mono text-[10px] text-muted-foreground">
            <span>{copy.setupStatus}</span>
            <span className="text-primary/30" aria-hidden="true">/</span>
            <span>{copy.disclaimerShort}</span>
          </div>
        </header>

        <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1.02fr)_minmax(360px,0.98fr)]">
          <section className="cyber-panel p-5 sm:p-6" aria-labelledby="setup-heading">
            <div className="mb-5 flex items-start justify-between gap-3">
              <div>
                <p className="font-mono text-[10px] tracking-[0.2em] text-primary/60">{copy.inputTag}</p>
                <h2 id="setup-heading" className="mt-1 text-xl font-semibold text-foreground">{copy.setupTitle}</h2>
                <p className="mt-1 text-xs text-muted-foreground">{copy.setupDescription}</p>
              </div>
              <SlidersHorizontal className="mt-1 h-5 w-5 shrink-0 text-primary/60" aria-hidden="true" />
            </div>

            <div className="grid grid-cols-1 gap-x-4 gap-y-4 sm:grid-cols-2">
              {fields.map(({ key, label, hint, step, min, suffix }) => (
                <div key={key} className={key === 'capital' ? 'sm:col-span-2' : ''}>
                  <label htmlFor={`trading-${key}`} className="mb-1.5 block text-xs font-medium text-foreground/90">{label}</label>
                  {hint && <p id={`trading-${key}-hint`} className="mb-1.5 text-[11px] text-muted-foreground">{hint}</p>}
                  <div className="relative">
                    <input
                      id={`trading-${key}`}
                      data-testid={`input-${key}`}
                      type="number"
                      inputMode="decimal"
                      min={min}
                      step={step}
                      value={inputs[key]}
                      onChange={(event) => update(key, event.target.value)}
                      aria-describedby={hint ? `trading-${key}-hint` : undefined}
                      className="h-11 w-full border border-primary/20 bg-background/60 px-3 font-mono text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground/50 focus:border-primary focus:ring-2 focus:ring-primary/20"
                      placeholder="0"
                    />
                    {suffix && <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 font-mono text-xs text-muted-foreground">{suffix}</span>}
                  </div>
                </div>
              ))}
              <div>
                <label htmlFor="trading-currency" className="mb-1.5 block text-xs font-medium text-foreground/90">{copy.unit}</label>
                <p id="trading-currency-hint" className="mb-1.5 text-[11px] text-muted-foreground">{copy.unitHint}</p>
                <input
                  id="trading-currency"
                  data-testid="input-currency"
                  type="text"
                  maxLength={8}
                  value={currency}
                  onChange={(event) => setCurrency(event.target.value.replace(/[^\p{L}\p{N}]/gu, ''))}
                  aria-describedby="trading-currency-hint"
                  className="h-11 w-full border border-primary/20 bg-background/60 px-3 font-mono text-sm uppercase text-foreground outline-none transition-colors placeholder:text-muted-foreground/50 focus:border-primary focus:ring-2 focus:ring-primary/20"
                  placeholder="USD"
                />
              </div>
            </div>

            <div className="mt-5 border-t border-primary/10 pt-4">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <CircleHelp className="h-3.5 w-3.5 text-primary/70" aria-hidden="true" />
                <span>{copy.direction}</span>
              </div>
              {result.kind === 'valid' ? (
                <div className="mt-2 inline-flex items-center gap-2 border border-primary/20 bg-primary/[0.06] px-3 py-2 font-mono text-xs text-primary" role="status" data-testid="status-direction">
                  {result.direction === 'long' ? <ArrowUpRight className="h-4 w-4" aria-hidden="true" /> : <ArrowDownRight className="h-4 w-4" aria-hidden="true" />}
                  {result.direction === 'long' ? copy.validLong : copy.validShort}
                  <span className="text-primary/50">· {copy.auto}</span>
                </div>
              ) : (
                <p className="mt-2 text-xs text-muted-foreground">{copy.long}: stop &lt; entry &lt; target · {copy.short}: target &lt; entry &lt; stop</p>
              )}
            </div>

            <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-primary/10 pt-4">
              <p className="max-w-xs text-[11px] leading-relaxed text-muted-foreground">{copy.localNote}</p>
              <button
                type="button"
                data-testid="button-reset"
                onClick={reset}
                className="inline-flex min-h-10 items-center gap-2 border border-primary/20 px-3 py-2 text-xs font-medium text-foreground/80 transition-colors hover:border-primary/50 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                {copy.reset}
              </button>
            </div>
          </section>

          <section className="cyber-panel p-5 sm:p-6" aria-labelledby="results-heading">
            <div className="mb-5 flex items-start justify-between gap-3">
              <div>
                <p className="font-mono text-[10px] tracking-[0.2em] text-primary/60">{copy.calculations}</p>
                <h2 id="results-heading" className="mt-1 text-xl font-semibold text-foreground">{copy.metricsTitle}</h2>
              </div>
              <Sparkles className="mt-1 h-5 w-5 text-primary/60" aria-hidden="true" />
            </div>

            {result.kind === 'empty' && (
              <div className="flex min-h-[310px] flex-col items-center justify-center border border-dashed border-primary/20 bg-primary/[0.025] px-5 text-center" data-testid="state-empty">
                <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full border border-primary/20 bg-primary/[0.06]">
                  <Waypoints className="h-5 w-5 text-primary/80" aria-hidden="true" />
                </div>
                <h3 className="text-sm font-semibold text-foreground">{copy.emptyTitle}</h3>
                <p className="mt-2 max-w-sm text-xs leading-relaxed text-muted-foreground">{copy.emptyBody}</p>
              </div>
            )}

            {result.kind === 'invalid' && (
              <div role="alert" className="border border-amber-400/30 bg-amber-400/[0.06] p-4" data-testid="state-invalid">
                <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-amber-200">
                  <AlertTriangle className="h-4 w-4" aria-hidden="true" />
                  {copy.invalidTitle}
                </div>
                <ul className="space-y-2">
                  {result.errors.map((error) => <li key={error} className="text-xs leading-relaxed text-amber-100/80">{error}</li>)}
                </ul>
              </div>
            )}

            {result.kind === 'valid' && (
              <div data-testid="state-results" aria-live="polite">
                <div className="mb-3 grid grid-cols-2 gap-2 sm:gap-3">
                  <Metric label={copy.riskBudget} value={money(result.riskBudget)} strong />
                  <Metric label={copy.unitRisk} value={money(result.perUnitRisk)} />
                  <Metric label={copy.quantity} value={formatNumber(result.quantity, locale)} detail={copy.units} />
                  <Metric label={copy.maxLoss} value={money(result.maximumLoss)} tone="risk" />
                  <Metric label={copy.reward} value={money(result.grossReward)} tone="reward" />
                  <Metric label={copy.ratio} value={`${formatNumber(result.rewardRisk, locale)} : 1`} />
                </div>
                <div className="flex items-start gap-2 border border-primary/15 bg-primary/[0.04] p-3 text-[11px] leading-relaxed text-muted-foreground">
                  <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary/75" aria-hidden="true" />
                  <span>{copy.whatIncluded}<br />{copy.riskNotice}</span>
                </div>
                <div className="mt-4 border border-primary/10 bg-background/30 p-3">
                  <h3 className="font-mono text-[10px] uppercase tracking-widest text-primary/80">{copy.formulaTitle}</h3>
                  <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">{copy.formulaBody}</p>
                </div>
              </div>
            )}
          </section>
        </div>

        <section className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <div className="cyber-panel p-5 sm:p-6">
            <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
              <div>
                <p className="font-mono text-[10px] tracking-[0.2em] text-primary/60">{copy.checklistTag}</p>
                <h2 className="mt-1 text-lg font-semibold text-foreground">{copy.checklistTitle}</h2>
                <p className="mt-1 text-xs text-muted-foreground">{copy.checklistIntro}</p>
              </div>
              <span className="font-mono text-[10px] text-primary/70" data-testid="status-checklist">
                {checkedCount === 0 ? copy.noChecks : `${checkedCount} / 4 ${copy.checks}`}
              </span>
            </div>
            <div className="space-y-2">
              {CHECKLIST_KEYS.map((key, index) => (
                <label key={key} className="flex cursor-pointer items-start gap-3 border border-primary/10 bg-background/20 p-3 transition-colors hover:border-primary/30">
                  <input
                    type="checkbox"
                    data-testid={`checkbox-${key}`}
                    checked={checked[key]}
                    onChange={(event) => setChecked((current) => ({ ...current, [key]: event.target.checked }))}
                    className="mt-0.5 h-4 w-4 shrink-0 accent-cyan-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  />
                  <span className="text-xs leading-relaxed text-foreground/85">{copy.checklist[index]}</span>
                  {checked[key] && <Check className="ml-auto mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" aria-hidden="true" />}
                </label>
              ))}
            </div>
          </div>

          <aside className="relative overflow-hidden border border-amber-300/20 bg-amber-200/[0.035] p-5 sm:p-6" aria-labelledby="guardrail-heading">
            <div className="pointer-events-none absolute -bottom-12 -right-8 h-40 w-40 rounded-full border border-amber-200/10" />
            <div className="relative">
              <div className="mb-3 flex items-center gap-2 text-amber-200/90">
                <AlertTriangle className="h-4 w-4" aria-hidden="true" />
                <span className="font-mono text-[10px] uppercase tracking-[0.18em]">{copy.disclaimerShort}</span>
              </div>
              <h2 id="guardrail-heading" className="text-lg font-semibold text-foreground">{copy.guardrailTitle}</h2>
              <p className="mt-2 text-xs leading-relaxed text-foreground/75">{copy.guardrailBody}</p>
              <p className="mt-3 border-l-2 border-amber-300/50 pl-3 text-xs leading-relaxed text-amber-100/75">{copy.disclaimer}</p>
            </div>
          </aside>
        </section>
      </div>
    </main>
  );
}

function Metric({ label, value, detail, strong = false, tone }: { label: string; value: string; detail?: string; strong?: boolean; tone?: 'risk' | 'reward' }) {
  const toneClass = tone === 'risk' ? 'text-rose-200' : tone === 'reward' ? 'text-emerald-200' : 'text-foreground';
  return (
    <div className={`min-h-[88px] border p-3 ${strong ? 'border-primary/30 bg-primary/[0.07]' : 'border-primary/12 bg-background/35'}`}>
      <div className="text-[10px] leading-snug text-muted-foreground">{label}</div>
      <div className={`mt-2 break-words font-mono text-base font-bold tracking-tight sm:text-lg ${toneClass}`} data-testid={`metric-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`}>
        {value}
      </div>
      {detail && <div className="mt-0.5 text-[10px] text-muted-foreground">{detail}</div>}
    </div>
  );
}
