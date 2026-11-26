// Wraps the single source of truth for allergen ids (shared/allergens.js,
// §IMP-11) — imported from outside this Vite project (see vite.config.ts's
// `@shared` alias and `server.fs.allow`), never duplicated.
// @ts-expect-error - plain UMD CommonJS module, no .d.ts
import ALLERGEN_REGISTRY_RAW from '@shared/allergens.js';
import type { StandardAllergen } from '../types';

interface RegistryEntry {
  id: string;
  legacyIds: string[];
  labels: Record<string, string>;
  icon: string;
}

const ALLERGEN_REGISTRY = ALLERGEN_REGISTRY_RAW as RegistryEntry[];

export const standardAllergens: StandardAllergen[] = ALLERGEN_REGISTRY.map((entry) => ({
  id: entry.id,
  icon: entry.icon,
  labels: entry.labels as StandardAllergen['labels'],
}));

// legacy id (e.g. 'pineneut') -> current standard id (e.g. 'pinenut').
export const LEGACY_ALLERGEN_ID_MAP: Record<string, string> = ALLERGEN_REGISTRY.reduce(
  (map, entry) => {
    (entry.legacyIds || []).forEach((legacyId) => {
      map[legacyId] = entry.id;
    });
    return map;
  },
  {} as Record<string, string>
);

export function getAllergenById(id: string): StandardAllergen | undefined {
  return standardAllergens.find((a) => a.id === id);
}

// [IMP-11] Migrate legacy allergy ids to canonical ids, deduping, while
// preserving any id this registry still doesn't recognize (never silently
// drop a user's past selection just because it's unfamiliar).
export function migrateLegacyAllergyIds(rawIds: string[]): { ids: string[]; changed: boolean } {
  const seen = new Set<string>();
  const migratedIds: string[] = [];
  let changed = false;

  rawIds.forEach((rawId) => {
    const canonicalId = LEGACY_ALLERGEN_ID_MAP[rawId] || rawId;
    if (canonicalId !== rawId) changed = true;
    if (!seen.has(canonicalId)) {
      seen.add(canonicalId);
      migratedIds.push(canonicalId);
    } else {
      changed = true;
    }
  });

  return { ids: migratedIds, changed };
}
