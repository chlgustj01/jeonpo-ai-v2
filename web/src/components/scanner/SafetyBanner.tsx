import { useT } from '../../hooks/useT';
import type { SafetyResult } from '../../types';

// Ports renderSafetyBanner()/SAFETY_BANNER_STYLES (§IMP-03/15). §7 of this
// package's request: RED/ORANGE/UNKNOWN/ERROR must be distinguishable by
// icon + text, not color alone (accessibility — color-blind users), and
// GREEN must never read as "guaranteed safe to eat".
const STYLES: Record<SafetyResult['safetyState'], { box: string; icon: string; iconPath: string }> = {
  green: {
    box: 'bg-emerald-50 text-emerald-900 border-emerald-200',
    icon: 'text-emerald-600',
    iconPath: 'M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z',
  },
  orange: {
    box: 'bg-amber-50 text-amber-900 border-amber-200',
    icon: 'text-amber-600',
    iconPath: 'M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z',
  },
  red: {
    box: 'bg-red-50 text-red-900 border-red-200',
    icon: 'text-red-600',
    iconPath: 'M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z',
  },
  unknown: {
    box: 'bg-slate-100 text-slate-800 border-slate-300',
    icon: 'text-slate-500',
    iconPath: 'M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z',
  },
  error: {
    box: 'bg-purple-50 text-purple-900 border-purple-300',
    icon: 'text-purple-600',
    iconPath: 'M18.364 5.636l-12.728 12.728M5.636 5.636l12.728 12.728',
  },
};

// Text label shown alongside the icon (never color-only) — short, so it
// reads at a glance even before the longer description below it.
const STATE_BADGE: Record<SafetyResult['safetyState'], string> = {
  green: 'GREEN',
  orange: 'ORANGE',
  red: 'RED',
  unknown: 'UNKNOWN',
  error: 'ERROR',
};

export function SafetyBanner({ result, sourceNoteKey }: { result: SafetyResult; sourceNoteKey: 'sourceAiScanNote' | 'sourceDemoNote' }) {
  const { t } = useT();
  const style = STYLES[result.safetyState];

  let title: string;
  let desc: string;
  if (result.safetyState === 'green') {
    title = t('safeTitle');
    desc = t('safeDesc');
  } else if (result.safetyState === 'orange') {
    title = t('warnTitle');
    desc = result.isCrossContact
      ? `${t('crossDesc')} (${result.matchedDangers.join(', ').toUpperCase()})`
      : t('warnDesc');
  } else if (result.safetyState === 'red') {
    title = t('dangerTitle');
    desc = `${t('dangerDesc')} (Matched: ${result.matchedDangers.join(', ').toUpperCase()})`;
  } else if (result.safetyState === 'unknown') {
    title = t('unknownTitle');
    desc = t('unknownDesc');
  } else {
    title = t('errorTitle');
    desc = t('errorDesc');
  }
  const sourceNote = t(sourceNoteKey);
  if (sourceNote) desc = `${desc} ${sourceNote}`;

  return (
    <div className={`p-3 rounded-xl border ${style.box}`} role="status">
      <div className="flex items-start gap-2">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          className={`h-5 w-5 shrink-0 mt-0.5 ${style.icon}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          aria-hidden="true"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d={style.iconPath} />
        </svg>
        <div>
          <p className="font-bold text-sm">
            <span className="uppercase tracking-wide text-[10px] mr-1.5 opacity-70">{STATE_BADGE[result.safetyState]}</span>
            {title}
          </p>
          <p className="text-xs mt-0.5 leading-relaxed">{desc}</p>
        </div>
      </div>
    </div>
  );
}
