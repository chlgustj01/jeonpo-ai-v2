import { useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useScanStore } from '../../store/scanStore';
import { useUIStore } from '../../store/uiStore';
import { useT } from '../../hooks/useT';
import { readFileAsDataUrl, resizeImageForUpload } from '../../lib/image';
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
  const { status, displayedDishes, kind, errorMessage, lastTranslationFailed, partialResults, analyzePhoto, reset } = useScanStore(
    useShallow((s) => ({
      status: s.status,
      displayedDishes: s.displayedDishes,
      kind: s.kind,
      errorMessage: s.errorMessage,
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

  const hasResult = kind !== null && displayedDishes.length > 0 && status !== 'analyzing';

  return (
    <section className="p-4 space-y-4" aria-label={t('scanTitle')}>
      <div>
        <h2 className="font-serif text-2xl font-bold text-vintage-dark">{t('scanTitle')}</h2>
        <p className="text-xs text-vintage-olive">{t('scanSub')}</p>
      </div>

      {!hasResult && (
        <div className="bg-white rounded-2xl p-4 vintage-border vintage-shadow space-y-3">
          <div className="aspect-square rounded-xl bg-vintage-beige/50 border-2 border-dashed border-vintage-dark/15 flex flex-col items-center justify-center text-center overflow-hidden relative">
            {pendingImage ? (
              <img src={pendingImage} alt={t('camTitle')} className="absolute inset-0 w-full h-full object-cover" />
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

      {status === 'error' && (
        <div className="space-y-2">
          <ErrorNotice title={t('errorTitle')} description={errorMessage || t('toastAiError')} />
          <Button variant="secondary" onClick={onReset}>
            {t('camTitle')}
          </Button>
        </div>
      )}

      {hasResult && (
        <div className="space-y-3">
          {lastTranslationFailed && (
            <p className="text-[10px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-2">{t('toastTranslationFailed')}</p>
          )}
          <DishResultList dishes={displayedDishes} source={kind === 'single' ? 'demo_location' : 'ai_scan'} partialResults={partialResults} />
          <Button variant="ghost" className="w-full" onClick={onReset}>
            {t('camTitle')}
          </Button>
        </div>
      )}
    </section>
  );
}
