import { useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useScanStore } from '../../store/scanStore';
import { useUIStore } from '../../store/uiStore';
import { useT } from '../../hooks/useT';
import { readFileAsDataUrl, resizeImageForUpload } from '../../lib/image';
import { ERROR_MESSAGE_KEYS } from '../../services/api';
import { formatTemplate } from '../../i18n';
import type { AnalysisCoverage } from '../../types';
import { Button, ErrorNotice, Spinner } from '../common/ui';
import { DishResultList } from './DishResultList';

// Ports the "Menu Translation" scanner tab (upload -> preview -> scan ->
// result). Drops the original laser-sweep animation (§6 "과도한 장식과
// 애니메이션 지양") but keeps the two-step upload-then-scan flow, since
// that's also how the map's "Scan Menu Here" demo path arrives here.
export function ScannerView() {
  const { t } = useT();
  const showToast = useUIStore((s) => s.showToast);
  const inputRef = useRef<HTMLInputElement>(null);
  const [pendingImage, setPendingImage] = useState<string | null>(null);

  // [bug found via Playwright — "Maximum update depth exceeded"] A selector
  // that returns a brand-new object literal every call makes zustand's
  // useSyncExternalStore think the snapshot changed on every render,
  // which infinite-loops. useShallow compares the picked fields instead
  // of the wrapper object's identity.
  const { status, displayedDishes, kind, errorMessage, errorCode, errorRetryable, coverage, lastTranslationFailed, partialResults, analyzePhoto, retryAnalysis, reset } = useScanStore(
    useShallow((s) => ({
      status: s.status,
      displayedDishes: s.displayedDishes,
      kind: s.kind,
      errorMessage: s.errorMessage,
      errorCode: s.errorCode,
      errorRetryable: s.errorRetryable,
      coverage: s.coverage,
      retryAnalysis: s.retryAnalysis,
      lastTranslationFailed: s.lastTranslationFailed,
      partialResults: s.partialResults,
      analyzePhoto: s.analyzePhoto,
      reset: s.reset,
    }))
  );

  const onFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const raw = await readFileAsDataUrl(file);
      const resized = await resizeImageForUpload(raw, 1024, 0.75);
      setPendingImage(resized);
    } catch (err) {
      console.error('Image resize failed:', err);
      showToast(t('toastAiError'));
    }
  };

  const onScan = () => {
    if (!pendingImage) return;
    showToast(t('toastScanning'));
    void analyzePhoto(pendingImage);
  };

  const onReset = () => {
    setPendingImage(null);
    reset();
    if (inputRef.current) inputRef.current.value = '';
  };

  // [Package 5] Results are shown only for a finished analysis — never next to an error.
  const hasResult = kind !== null && displayedDishes.length > 0 && (status === 'ready' || status === 'translating');

  return (
    <section className="p-4 space-y-4" aria-label={t('scanTitle')}>
      <div>
        <h2 className="font-serif text-2xl font-bold text-vintage-dark">{t('scanTitle')}</h2>
        <p className="text-xs text-vintage-olive">{t('scanSub')}</p>
      </div>

      {/* [Package 5] Error first, above the photo card, so it is visible without scrolling on a phone. */}
      {status === 'error' && (
        <div className="space-y-2">
          <ErrorNotice title={t('errorTitle')} description={t(ERROR_MESSAGE_KEYS[errorCode ?? 'UNKNOWN'])} />
          {errorMessage && (
            <details className="text-[10px] text-vintage-olive">
              <summary className="cursor-pointer min-h-[32px] inline-flex items-center">{t('errTechDetails')}</summary>
              <code className="block font-mono break-all">{errorMessage}</code>
            </details>
          )}
          {/* Only a retry button here: choosing another photo is the card's own button just below. */}
          {errorRetryable && (
            <Button variant="primary" onClick={() => void retryAnalysis()}>
              {t('retryBtn')}
            </Button>
          )}
        </div>
      )}

      {!hasResult && (
        <div className="bg-white rounded-2xl p-4 vintage-border vintage-shadow space-y-3">
          <div className="aspect-square rounded-xl bg-vintage-beige/50 border-2 border-dashed border-vintage-dark/15 flex flex-col items-center justify-center text-center overflow-hidden relative">
            {pendingImage ? (
              <img src={pendingImage} alt={t('camTitle')} className="absolute inset-0 w-full h-full object-contain" />
            ) : (
              <div className="p-6">
                <p className="font-bold text-vintage-dark text-sm">{t('camTitle')}</p>
                <p className="text-xs text-vintage-olive mt-1">{t('camDesc')}</p>
              </div>
            )}
          </div>

          <label className="block">
            <input
              ref={inputRef}
              type="file"
              accept="image/*"
              capture="environment"
              onChange={onFileChange}
              className="sr-only"
              aria-label={t('camTitle')}
            />
            <Button variant="secondary" className="w-full" onClick={() => inputRef.current?.click()}>
              {t('camTitle')}
            </Button>
          </label>

          <Button variant="primary" className="w-full" disabled={!pendingImage || status === 'analyzing'} onClick={onScan}>
            {status === 'analyzing' ? t('toastScanning') : t('scanBtn')}
          </Button>
        </div>
      )}

      {status === 'analyzing' && <Spinner label={t('toastScanning')} />}

      {hasResult && (
        <div className="space-y-3">
          {lastTranslationFailed && (
            <p className="text-xs text-amber-900 bg-amber-50 border border-amber-200 rounded-lg p-2" role="status">{t('toastTranslationFailed')}</p>
          )}
          {kind === 'multi' && coverage && <CoverageNotice coverage={coverage} />}
          <DishResultList dishes={displayedDishes} source={kind === 'single' ? 'demo_location' : 'ai_scan'} partialResults={partialResults} />
          <Button variant="ghost" className="w-full" onClick={onReset}>
            {t('camTitle')}
          </Button>
        </div>
      )}
    </section>
  );
}

// [Package 5] Says when only part of the photographed menu was analyzed, so
// a partial result never reads as "the whole menu checked".
function CoverageNotice({ coverage }: { coverage: AnalysisCoverage }) {
  const { t } = useT();
  if (coverage.isComplete !== false) return null;
  const text =
    coverage.visibleItemCount !== null && coverage.visibleItemCount > coverage.returnedCount
      ? formatTemplate(t('coverageIncomplete'), { shown: coverage.returnedCount, total: coverage.visibleItemCount, max: coverage.maxDishes })
      : formatTemplate(t('coverageCapped'), { shown: coverage.returnedCount, max: coverage.maxDishes });
  return (
    <p className="text-xs text-amber-900 bg-amber-50 border border-amber-200 rounded-lg p-2" role="status">
      {text}
    </p>
  );
}