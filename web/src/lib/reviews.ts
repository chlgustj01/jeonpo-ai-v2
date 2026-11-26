import { LANG_TO_COUNTRY } from './constants.generated';
import type { AnyReview, Lang } from '../types';

export function getUserCountry(nationality: string, lang: Lang): string {
  const custom = (nationality || '').trim();
  return custom || LANG_TO_COUNTRY[lang] || 'Traveler';
}

const SIMILAR_MIN_SAMPLE = 3;

// Cascades from the most specific match (country + spice tolerance +
// dietary) down to "all reviews" whenever a tier doesn't have enough data.
export function findSimilarTravelerReviews(
  reviews: AnyReview[],
  country: string,
  spiceTolerance: number,
  dietary: string
): { reviews: AnyReview[]; tier: 'country+spice+dietary' | 'country+spice' | 'country' | 'all' } {
  const byCountrySpiceDiet = reviews.filter(
    (r) => r.country === country && r.spiceTolerance === spiceTolerance && r.dietary === dietary
  );
  if (byCountrySpiceDiet.length >= SIMILAR_MIN_SAMPLE) {
    return { reviews: byCountrySpiceDiet, tier: 'country+spice+dietary' };
  }
  const byCountrySpice = reviews.filter((r) => r.country === country && r.spiceTolerance === spiceTolerance);
  if (byCountrySpice.length >= SIMILAR_MIN_SAMPLE) {
    return { reviews: byCountrySpice, tier: 'country+spice' };
  }
  const byCountry = reviews.filter((r) => r.country === country);
  if (byCountry.length >= SIMILAR_MIN_SAMPLE) {
    return { reviews: byCountry, tier: 'country' };
  }
  return { reviews, tier: 'all' };
}
