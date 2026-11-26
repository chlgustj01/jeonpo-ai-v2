import { useEffect, useRef, useState } from 'react';
import { useProfileStore } from '../../store/profileStore';
import { useReviewStore, EMPTY_REVIEWS } from '../../store/reviewStore';
import { useUIStore } from '../../store/uiStore';
import { useT } from '../../hooks/useT';
import { getUserCountry } from '../../lib/reviews';
import { Button } from '../common/ui';

// Ports submitReview()/editReview()/cancelEditReview() (§IMP-14).
export function ReviewForm({
  foodId,
  editingId,
  onDoneEditing,
}: {
  foodId: string;
  editingId: string | null;
  onDoneEditing: () => void;
}) {
  const { t } = useT();
  const nationality = useProfileStore((s) => s.nationality);
  const lang = useProfileStore((s) => s.lang);
  const selectedSpicy = useProfileStore((s) => s.selectedSpicy);
  const dietary = useProfileStore((s) => s.dietary);
  const userReviews = useReviewStore((s) => s.userReviews[foodId] || EMPTY_REVIEWS);
  const addReview = useReviewStore((s) => s.addReview);
  const updateReview = useReviewStore((s) => s.updateReview);
  const showToast = useUIStore((s) => s.showToast);

  const [rating, setRating] = useState(5);
  const [spiceFelt, setSpiceFelt] = useState(3);
  const [text, setText] = useState('');
  // [§3 "중복 저장 방지"] 동기 재진입(이중 클릭)만 막는다 — 네트워크
  // 호출이 없는 로컬 저장이라 이것으로 충분하다(§IMP-14와 동일한 판단).
  const isSubmittingRef = useRef(false);

  useEffect(() => {
    if (!editingId) return;
    const existing = userReviews.find((r) => r.id === editingId);
    if (existing) {
      setRating(existing.rating);
      setSpiceFelt(existing.spiceFelt);
      setText(existing.text);
    }
  }, [editingId, userReviews]);

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmittingRef.current) return;
    if (!text.trim()) return;
    isSubmittingRef.current = true;
    try {
      if (editingId) {
        updateReview(foodId, editingId, { rating, spiceFelt, text, wouldAgain: rating >= 3 });
        onDoneEditing();
        showToast(t('reviewUpdatedToast'));
      } else {
        addReview(foodId, {
          user: 'You',
          country: getUserCountry(nationality, lang),
          spiceTolerance: selectedSpicy + 1,
          dietary,
          tasteTags: [],
          rating,
          spiceFelt,
          text,
          wouldAgain: rating >= 3,
        });
        showToast(t('reviewAddedToast'));
      }
      setText('');
      setRating(5);
      setSpiceFelt(3);
    } finally {
      isSubmittingRef.current = false;
    }
  };

  const onCancel = () => {
    onDoneEditing();
    setText('');
    setRating(5);
    setSpiceFelt(3);
  };

  return (
    <form onSubmit={onSubmit} className="bg-vintage-beige/30 p-4 rounded-xl space-y-3 vintage-border">
      <span className="text-xs font-bold text-vintage-olive uppercase">{t('addYourReviewLabel')}</span>
      <div className="grid grid-cols-2 gap-2">
        <select
          value={rating}
          onChange={(e) => setRating(Number(e.target.value))}
          className="min-h-[44px] text-xs p-2 rounded-lg bg-white vintage-border"
          aria-label="Rating"
        >
          <option value={5}>⭐ 5</option>
          <option value={4}>⭐ 4</option>
          <option value={3}>⭐ 3</option>
          <option value={2}>⭐ 2</option>
          <option value={1}>⭐ 1</option>
        </select>
        <select
          value={spiceFelt}
          onChange={(e) => setSpiceFelt(Number(e.target.value))}
          className="min-h-[44px] text-xs p-2 rounded-lg bg-white vintage-border"
          aria-label="Spice felt"
        >
          <option value={1}>🌶️ 1</option>
          <option value={2}>🌶️ 2</option>
          <option value={3}>🌶️ 3</option>
          <option value={4}>🌶️ 4</option>
          <option value={5}>🌶️ 5</option>
        </select>
      </div>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        required
        placeholder="Share your experience..."
        className="w-full h-16 text-xs p-2.5 rounded-lg bg-white vintage-border focus:outline-none focus:ring-1 focus:ring-vintage-clay"
      />
      <div className="flex gap-2">
        <Button type="submit" variant="primary" className="flex-1">
          {editingId ? t('reviewUpdateBtn') : t('reviewSubmitBtn')}
        </Button>
        {editingId && (
          <Button type="button" variant="secondary" onClick={onCancel}>
            {t('reviewCancelEditBtn')}
          </Button>
        )}
      </div>
    </form>
  );
}
