import { useT } from '../../hooks/useT';
import { BADGE_KEY } from '../../lib/riskReasons';
import type { SafetyState } from '../../types';

// [UX-IMPROVEMENT P0] Per-dish risk badge: icon + text + color, so it is
// never color-only. GREEN reads "No match", not "Safe".
const STYLE: Record<SafetyState, { box: string; icon: string }> = {
  red: { box: 'bg-red-50 text-red-900 border-red-300', icon: '⛔' },
  orange: { box: 'bg-amber-50 text-amber-900 border-amber-300', icon: '⚠️' },
  unknown: { box: 'bg-slate-100 text-slate-800 border-slate-300', icon: '❔' },
  error: { box: 'bg-purple-50 text-purple-900 border-purple-300', icon: '✖' },
  green: { box: 'bg-emerald-50 text-emerald-900 border-emerald-300', icon: '○' },
};

export function RiskBadge({ state, compact = false }: { state: SafetyState; compact?: boolean }) {
  const { t } = useT();
  const s = STYLE[state];
  return (
    <span
      className={`shrink-0 inline-flex items-center gap-1 rounded-lg border font-bold ${s.box} ${
        compact ? 'flex-col justify-center w-16 min-h-[40px] px-1 py-1 text-[11px] leading-tight text-center' : 'px-2 py-1 text-xs'
      }`}
    >
      <span aria-hidden="true">{s.icon}</span>
      <span>{t(BADGE_KEY[state])}</span>
    </span>
  );
}
