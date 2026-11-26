import { useMemo, useState } from 'react';
import { useProfileStore } from '../../store/profileStore';
import { useReviewStore, EMPTY_REVIEWS } from '../../store/reviewStore';
import { useUIStore } from '../../store/uiStore';
import { useT } from '../../hooks/useT';
import { findSimilarTravelerReviews, getUserCountry } from '../../lib/reviews';
import { demoReviews } from '../../data/demoReviews.generated';
import { Card, EmptyState } from '../common/ui';
import { ReviewForm, type ReviewContext } from './ReviewForm';
import { translateCountryName, translateTasteTag } from '../../i18n/uxExtra';
import type { AnyReview } from '../../types';

const FILTER_TABS: { key: 'similar' | 'country' | 'all'; labelKey: string }[] = [
  { key: 'similar', labelKey: 'reviewsFilterSimilar' },
  { key: 'country', labelKey: 'reviewsFilterCountry' },
  { key: 'all', labelKey: 'reviewsFilterAll' },
];

const DIET_LABEL_KEY: Record<string, string> = { none: 'dietNone', vegan: 'dietVegan', halal: 'dietHalal', vegetarian: 'dietVegetarian' };

// Ports renderReviewsList()/setReviewsFilter() (§IMP-14). Demo seed
// (demoReviews, read-only) and real user reviews (reviewStore, editable)
// are only ever merged at render time, inside this component — never in
// storage — same separation the vanilla app's §IMP-14 devlog establishes.
export function ReviewSection({ foodId, context }: { foodId: string; context?: ReviewContext }) {
  const { t, lang: uiLang } = useT();
  const nationality = useProfileStore((s) => s.nationality);
  const lang = useProfileStore((s) => s.lang);
  const selectedSpicy = useProfileStore((s) => s.selectedSpicy);
  const dietary = useProfileStore((s) => s.dietary);
  const userReviewsForFood = useReviewStore((s) => s.userReviews[foodId] || EMPTY_REVIEWS);
  const filterMode = useUIStore((s) => s.reviewsFilterMode);
  const setFilterMode = useUIStore((s) => s.setReviewsFilterMode);
  const [editingId, setEditingId] = useState<string | null>(null);

  const demoForFood = (demoReviews[foodId] || []) as AnyReview[];
  const allReviews: AnyReview[] = [...demoForFood, ...userReviewsForFood];

  const userCountry = getUserCountry(nationality, lang);
  const userSpiceTolerance = selectedSpicy + 1;

  const stats = useMemo(() => {
    if (allReviews.length === 0) return null;
    const sameCountryReviews = allReviews.filter((r) => r.country === userCountry);
    const strongPct =
      sameCountryReviews.length > 0
        ? Math.round((sameCountryReviews.filter((r) => r.spiceFelt >= 4).length / sameCountryReviews.length) * 100)
        : null;
    const { reviews: similarReviews, tier } = findSimilarTravelerReviews(allReviews, userCountry, userSpiceTolerance, dietary);
    const avgSpice = similarReviews.length > 0 ? (similarReviews.reduce((sum, r) => sum + r.spiceFelt, 0) / similarReviews.length).toFixed(1) : '—';
    const againPct = similarReviews.length > 0 ? Math.round((similarReviews.filter((r) => r.wouldAgain).length / similarReviews.length) * 100) : null;
    return { sameCountryReviews, strongPct, similarReviews, tier, avgSpice, againPct };
  }, [allReviews, userCountry, userSpiceTolerance, dietary]);

  if (!stats) {
    return (
      <Card>
        <EmptyState icon="⭐" title={t('reviewsNoneYet')} />
        <ReviewForm foodId={foodId} editingId={null} onDoneEditing={() => setEditingId(null)} context={context} />
      </Card>
    );
  }

  const listedReviews =
    filterMode === 'country' ? (stats.sameCountryReviews.length > 0 ? stats.sameCountryReviews : allReviews)
    : filterMode === 'all' ? allReviews
    : stats.similarReviews;

  const tierBasisText =
    stats.tier === 'country+spice+dietary'
      ? `${translateCountryName(uiLang, userCountry)} · ${t('spiceLvl')} ${userSpiceTolerance} · ${t(DIET_LABEL_KEY[dietary])}`
      : stats.tier === 'country+spice'
        ? `${translateCountryName(uiLang, userCountry)} · ${t('spiceLvl')} ${userSpiceTolerance}`
        : stats.tier === 'country'
          ? translateCountryName(uiLang, userCountry)
          : t('reviewsFilterAll');

  return (
    <Card className="space-y-4">
      <div className="flex items-center gap-2">
        <span className="text-xl" aria-hidden="true">⭐</span>
        <h3 className="font-serif text-lg font-bold text-vintage-dark">{t('reviewsTitle')}</h3>
      </div>

      <div className="bg-vintage-beige/40 p-3.5 rounded-xl grid grid-cols-2 gap-2.5 text-center">
        <StatTile value={stats.strongPct !== null ? `${stats.strongPct}%` : '—'} label={`${translateCountryName(uiLang, userCountry)} ${t('reviewsStrongLabel')}`} color="text-vintage-terracotta" />
        <StatTile value={`${stats.similarReviews.length}`} label={t('reviewsSimilarTravelersLabel')} color="text-vintage-dark" />
        <StatTile value={`${stats.avgSpice} / 5`} label={t('reviewsAvgSpiceLabel')} color="text-vintage-clay" />
        <StatTile value={stats.againPct !== null ? `${stats.againPct}%` : '—'} label={t('reviewsWouldAgainLabel')} color="text-vintage-sage" />
      </div>
      <p className="text-[10px] text-vintage-olive text-center">{t('reviewsBasedOnPrefix')}: {tierBasisText}</p>

      <div className="flex gap-1.5 p-1 bg-vintage-beige/50 rounded-xl vintage-border" role="group">
        {FILTER_TABS.map((f) => (
          <button
            key={f.key}
            type="button"
            onClick={() => setFilterMode(f.key)}
            aria-pressed={filterMode === f.key}
            className={`flex-1 min-h-[44px] py-1.5 text-[11px] leading-tight font-semibold rounded-lg transition ${
              filterMode === f.key ? 'bg-white text-vintage-dark shadow-sm' : 'text-vintage-olive hover:bg-white/50'
            }`}
          >
            {t(f.labelKey)}
          </button>
        ))}
      </div>

      <div className="space-y-3">
        {listedReviews.length === 0 ? (
          <EmptyState title={t('reviewsNoneMatchFilter')} />
        ) : (
          listedReviews
            .slice()
            .reverse()
            .map((review, i) => <ReviewCard key={('id' in review && review.id) || i} review={review} foodId={foodId} onEdit={setEditingId} />)
        )}
      </div>

      <p className="text-[10px] text-vintage-olive text-center">{t('reviewsSafetyDisclaimer')}</p>
      <ReviewForm foodId={foodId} editingId={editingId} onDoneEditing={() => setEditingId(null)} context={context} />
    </Card>
  );
}

function StatTile({ value, label, color }: { value: string; label: string; color: string }) {
  return (
    <div className="bg-white p-2.5 rounded-lg vintage-border">
      <span className={`text-base font-serif font-bold ${color}`}>{value}</span>
      <span className="text-[9px] text-vintage-olive block leading-tight mt-0.5">{label}</span>
    </div>
  );
}

function ReviewCard({ review, foodId, onEdit }: { review: AnyReview; foodId: string; onEdit: (id: string) => void }) {
  const { t, lang } = useT();
  const deleteReview = useReviewStore((s) => s.deleteReview);
  const isUserReview = 'isUserReview' in review && review.isUserReview;
  const stars = '⭐'.repeat(review.rating) + '☆'.repeat(5 - review.rating);

  return (
    <div className="bg-white p-3.5 rounded-xl vintage-border space-y-1.5">
      <div className="flex justify-between items-start">
        <div>
          <span className="font-bold text-vintage-dark text-sm block">
            {isUserReview && review.user === 'You' ? t('reviewYouName') : review.user}{' '}
            {isUserReview ? (
              <span className="text-[11px] font-bold px-1.5 py-0.5 rounded-full bg-vintage-sage/20 text-vintage-dark">
                📱 {t('reviewYourBadge')}
              </span>
            ) : (
              // [UX-IMPROVEMENT] Demo seed reviews are labeled as samples so they
              // are never mistaken for real travelers' records.
              <span className="text-[11px] font-bold px-1.5 py-0.5 rounded-full bg-purple-50 text-purple-900 border border-purple-200">
                🧪 {t('demoReviewBadge')}
              </span>
            )}
          </span>
          {isUserReview && 'locationName' in review && review.locationName && (
            <span className="block text-[11px] text-vintage-olive">📍 {review.locationName}</span>
          )}
          <span className="text-[11px] text-vintage-olive">
            {translateCountryName(lang, review.country)} • {t('spiceLvl')} {review.spiceTolerance}
            {review.dietary && review.dietary !== 'none' ? ` • ${DIET_LABEL_KEY[review.dietary] ? t(DIET_LABEL_KEY[review.dietary]) : review.dietary}` : ''}
          </span>
        </div>
        <span className="text-xs" aria-label={`${review.rating} / 5`}>{stars}</span>
      </div>
      <p className="text-xs text-vintage-dark leading-relaxed">&quot;{review.text}&quot;</p>
      {'tasteTags' in review && review.tasteTags && review.tasteTags.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {review.tasteTags.map((tag) => (
            <span key={tag} className="text-[9px] px-1.5 py-0.5 rounded-full bg-vintage-beige text-vintage-olive">
              {translateTasteTag(lang, tag)}
            </span>
          ))}
        </div>
      )}
      <div className="flex items-center justify-between pt-1">
        <span className="text-[11px] font-mono text-vintage-clay">🌶️ {t('spiceLvl')} {review.spiceFelt}</span>
        <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${review.wouldAgain ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>
          {t(review.wouldAgain ? 'reviewsWouldAgainBadge' : 'reviewsWouldAvoidBadge')}
        </span>
      </div>
      {isUserReview && 'id' in review && (
        <div className="flex gap-1 pt-1">
          <button type="button" onClick={() => onEdit(review.id)} className="text-xs min-h-[44px] px-3 rounded-full bg-vintage-dark/5 text-vintage-dark hover:bg-vintage-dark/10">
            {t('reviewEditBtn')}
          </button>
          <button
            type="button"
            onClick={() => {
              if (window.confirm(t('reviewDeleteConfirm'))) deleteReview(foodId, review.id);
            }}
            className="text-xs min-h-[44px] px-3 rounded-full bg-red-50 text-red-700 hover:bg-red-100"
          >
            {t('reviewDeleteBtn')}
          </button>
        </div>
      )}
    </div>
  );
}
