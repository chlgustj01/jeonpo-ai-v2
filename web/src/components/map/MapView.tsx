import { useEffect, useRef } from 'react';
import L from 'leaflet';
import { locations } from '../../data/locations.generated';
import { useUIStore } from '../../store/uiStore';
import { useScanStore } from '../../store/scanStore';
import { useT } from '../../hooks/useT';
import { demoMatchObjToDish } from '../../lib/demoDish';
import { Button } from '../common/ui';
import { ReviewSection } from '../reviews/ReviewSection';
import type { Lang } from '../../types';

const JEONPO_CENTER: [number, number] = [35.155823, 129.063712];

type LocationEntry = typeof locations[number];

const FILTERS: { key: 'all' | 'restaurant' | 'cafe'; labelKey: string }[] = [
  { key: 'all', labelKey: 'allLocs' },
  { key: 'restaurant', labelKey: 'restLocs' },
  { key: 'cafe', labelKey: 'cafeLocs' },
];

// Ports initLeafletMap()/updateMapMarkers()/setMapFilter()/selectLocation()
// (§ map tab). Leaflet is an imperative library by design — a thin ref +
// effect wrapper is the idiomatic React integration (no react-leaflet
// dependency needed for this scope, per "필요한 의존성만 설치").
export function MapView() {
  const { t, lang } = useT();
  const mapFilter = useUIStore((s) => s.currentMapFilter);
  const setMapFilter = useUIStore((s) => s.setMapFilter);
  const selectedLocationId = useUIStore((s) => s.selectedLocationId);
  const selectLocationInStore = useUIStore((s) => s.selectLocation);
  const setActiveTab = useUIStore((s) => s.setActiveTab);
  const showDemoDish = useScanStore((s) => s.showDemoDish);

  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markersRef = useRef<L.Marker[]>([]);
  const selectLocationRef = useRef((_id: number) => {});

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = L.map(containerRef.current, { center: JEONPO_CENTER, zoom: 16, scrollWheelZoom: false });
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors',
      maxZoom: 19,
    }).addTo(map);
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  selectLocationRef.current = (id: number) => {
    selectLocationInStore(id);
    const loc = locations.find((l) => l.id === id);
    if (loc && mapRef.current) mapRef.current.panTo([loc.lat, loc.lng]);
  };

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    markersRef.current.forEach((m) => map.removeLayer(m));
    markersRef.current = [];

    locations.forEach((loc) => {
      if (mapFilter !== 'all' && loc.category !== mapFilter) return;
      const iconSymbol = loc.category === 'restaurant' ? '🍚' : '☕';
      const pinIcon = L.divIcon({
        className: '',
        html: `<div class="w-8 h-8 rounded-full border border-vintage-dark/20 bg-white shadow-lg flex items-center justify-center text-sm">${iconSymbol}</div>`,
        iconSize: [32, 32],
        iconAnchor: [16, 16],
        popupAnchor: [0, -18],
      });
      const marker = L.marker([loc.lat, loc.lng], { icon: pinIcon }).addTo(map);
      const storeName = lang === 'ko' ? loc.nameKo : loc.name;
      const mainDish = (loc.mainDish as Record<string, string>)[lang] || loc.mainDish.en;
      marker.bindPopup(
        `<div style="font-family:'Noto Sans KR', sans-serif;"><strong style="display:block;color:#2E2520;">${storeName}</strong><span style="display:block;font-size:11px;color:#5F6F65;margin-top:2px;">${mainDish}</span></div>`
      );
      marker.on('click', () => {
        selectLocationRef.current(loc.id);
        marker.openPopup();
      });
      markersRef.current.push(marker);
    });
  }, [mapFilter, lang]);

  const selectedLocation: LocationEntry | undefined = locations.find((l) => l.id === selectedLocationId);

  const onScanHere = () => {
    if (!selectedLocation) return;
    showDemoDish(demoMatchObjToDish(selectedLocation.matchedFoodObj));
    setActiveTab('scanner');
  };

  return (
    <section className="p-4 space-y-4" aria-label={t('mapTitle')}>
      <div>
        <h2 className="font-serif text-2xl font-bold text-vintage-dark">{t('mapTitle')}</h2>
        <p className="text-xs text-vintage-olive">{t('mapSub')}</p>
      </div>

      <div className="flex gap-1.5 p-1 bg-vintage-beige/50 rounded-xl vintage-border" role="group" aria-label={t('mapTitle')}>
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            onClick={() => setMapFilter(f.key)}
            aria-pressed={mapFilter === f.key}
            className={`flex-1 min-h-[40px] py-1.5 text-xs font-semibold rounded-lg transition ${
              mapFilter === f.key ? 'bg-white text-vintage-dark shadow-sm' : 'text-vintage-olive hover:bg-white/50'
            }`}
          >
            {t(f.labelKey)}
          </button>
        ))}
      </div>

      <div ref={containerRef} id="jeonpo-map" className="w-full h-64 rounded-xl vintage-border overflow-hidden" />

      {selectedLocation && (
        <div className="space-y-4">
          <LocationDetailCard location={selectedLocation} lang={lang} onScanHere={onScanHere} />
          <ReviewSection foodId={selectedLocation.matchedFoodObj.foodId} />
        </div>
      )}
    </section>
  );
}

function LocationDetailCard({ location, lang, onScanHere }: { location: LocationEntry; lang: Lang; onScanHere: () => void }) {
  const { t } = useT();
  const desc = (location.desc as Record<string, string>)[lang] || location.desc.en;
  const mainDish = (location.mainDish as Record<string, string>)[lang] || location.mainDish.en;
  const allergensText = (location.allergens as Record<string, string>)[lang] || location.allergens.en;
  const categoryDisplay = (location.categoryDisplay as Record<string, string>)[lang] || location.category.toUpperCase();

  return (
    <div className="bg-white p-4 rounded-xl vintage-border vintage-shadow space-y-2">
      <span className="text-[10px] font-bold text-vintage-terracotta uppercase tracking-wide">{categoryDisplay}</span>
      <h3 className="font-serif text-lg font-bold text-vintage-dark">{lang === 'ko' ? location.nameKo : location.name}</h3>
      <p className="text-xs text-vintage-olive leading-relaxed">{desc}</p>
      <div className="grid grid-cols-2 gap-2 text-xs pt-1">
        <div>
          <span className="block text-[10px] text-vintage-olive uppercase font-bold">{t('mainDish')}</span>
          <span>{mainDish}</span>
        </div>
        <div>
          <span className="block text-[10px] text-vintage-olive uppercase font-bold">{t('triggers')}</span>
          <span>{allergensText}</span>
        </div>
      </div>
      <Button variant="primary" className="w-full mt-2" onClick={onScanHere}>
        {t('scanBtn')}
      </Button>
    </div>
  );
}
