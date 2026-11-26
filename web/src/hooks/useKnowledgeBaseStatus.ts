import { useEffect, useState } from 'react';
import { allergenKnowledgeBaseReady, foodKnowledgeBaseReady } from '../services/knowledgeBase';

// Both knowledge-DB loaders start fetching the moment the module is
// imported (module-level `await`ed promises, same pattern as the vanilla
// app's `const allergenKnowledgeBaseReady = loadAllergenKnowledgeBase()`).
// This hook just re-renders the subscriber once both have settled.
export function useKnowledgeBaseStatus() {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let mounted = true;
    Promise.all([allergenKnowledgeBaseReady, foodKnowledgeBaseReady]).then(() => {
      if (mounted) setReady(true);
    });
    return () => {
      mounted = false;
    };
  }, []);
  return ready;
}
