import { useEffect, useRef, useState } from 'react';
import type { LayerGroup, Map as LeafletMap, Marker } from 'leaflet';

import { toast } from '@/lib/toast';
import { SHOP_LOCATION } from '@/lib/geolocation';
import type { PunchPin, PunchSegment } from '@/lib/punch-map';

const NEARBY_MILES = 1;

/**
 * Raster tiles that do not require an API key.
 * OSM volunteer tiles block apps; CARTO's public CDN now watermarks "API KEY REQUIRED".
 * Esri World Street Map is a standard XYZ layer (note {z}/{y}/{x} order).
 */
const MAP_TILES = {
  url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}',
  options: {
    attribution:
      'Tiles &copy; <a href="https://www.esri.com/">Esri</a> — Esri, HERE, Garmin, USGS, Intermap, INCREMENT P, NRCan, Esri Japan, METI, OSM contributors, and the GIS User Community',
    maxZoom: 19,
  },
};

type PunchMapCanvasProps = {
  pins: PunchPin[];
  segments: PunchSegment[];
  selectedPinId: string;
  onSelectPin: (id: string) => void;
};

function pinColor(kind: PunchPin['kind'], far: boolean) {
  if (far) return '#c92a2a';
  return kind === 'in' ? '#2f9e44' : '#e8590c';
}

function pinLabel(kind: PunchPin['kind']) {
  return kind === 'in' ? 'In' : 'Out';
}

export function PunchMapCanvas({ pins, segments, selectedPinId, onSelectPin }: PunchMapCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const layersRef = useRef<LayerGroup | null>(null);
  const markersRef = useRef<Map<string, Marker>>(new Map());
  const onSelectRef = useRef(onSelectPin);
  const [mapReady, setMapReady] = useState(false);
  const fittedKeyRef = useRef('');

  useEffect(() => {
    onSelectRef.current = onSelectPin;
  }, [onSelectPin]);

  useEffect(() => {
    let cancelled = false;
    let tileErrorToasted = false;

    const setup = async () => {
      const leaflet = await import('leaflet');
      await import('leaflet/dist/leaflet.css');
      if (cancelled || !containerRef.current) return;

      const L = leaflet.default;
      const map = L.map(containerRef.current, { scrollWheelZoom: true });
      map.setView([SHOP_LOCATION.lat, SHOP_LOCATION.lon], 12);

      const tiles = L.tileLayer(MAP_TILES.url, MAP_TILES.options);
      tiles.on('tileerror', () => {
        if (tileErrorToasted) return;
        tileErrorToasted = true;
        toast.error('Map tiles failed to load. Check the network and try again.');
      });
      tiles.addTo(map);

      const layers = L.layerGroup().addTo(map);
      mapRef.current = map;
      layersRef.current = layers;
      requestAnimationFrame(() => {
        map.invalidateSize();
        if (!cancelled) setMapReady(true);
      });
    };

    void setup();

    return () => {
      cancelled = true;
      setMapReady(false);
      fittedKeyRef.current = '';
      mapRef.current?.remove();
      mapRef.current = null;
      layersRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    const layers = layersRef.current;
    if (!mapReady || !map || !layers) return;

    let cancelled = false;
    const draw = async () => {
      const leaflet = await import('leaflet');
      if (cancelled) return;
      const L = leaflet.default;

      map.closePopup();
      layers.clearLayers();
      markersRef.current.clear();

      const shopIcon = L.divIcon({
        className: 'punch-map-pin',
        html: '<span class="punch-map-shop" title="Shop">S</span>',
        iconSize: [22, 22],
        iconAnchor: [11, 11],
      });
      L.marker([SHOP_LOCATION.lat, SHOP_LOCATION.lon], { icon: shopIcon, zIndexOffset: 200 }).bindPopup('Shop').addTo(layers);

      for (const segment of segments) {
        L.polyline(
          [
            [segment.from.lat, segment.from.lon],
            [segment.to.lat, segment.to.lon],
          ],
          { color: '#868e96', weight: 2, dashArray: '6 6', opacity: 0.75 },
        ).addTo(layers);
      }

      for (const punch of pins) {
        const far = punch.distanceMiles != null && punch.distanceMiles > NEARBY_MILES;
        const color = pinColor(punch.kind, far);
        const icon = L.divIcon({
          className: 'punch-map-pin',
          html: `<span class="punch-map-dot" style="background:${color}">${pinLabel(punch.kind)}</span>`,
          iconSize: [28, 28],
          iconAnchor: [14, 14],
        });

        const popup = document.createElement('div');
        popup.className = 'space-y-1 text-sm';
        const title = document.createElement('p');
        title.className = 'font-semibold';
        title.textContent = punch.employeeName;
        const when = document.createElement('p');
        when.textContent = `Clock ${punch.kind} · ${new Date(punch.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
        const distance = document.createElement('p');
        distance.textContent =
          punch.distanceMiles == null ? 'Distance from shop unknown' : `${punch.distanceMiles.toFixed(1)} mi from shop`;
        if (far) distance.style.color = '#c92a2a';
        const asset = document.createElement('p');
        asset.className = 'text-muted-foreground';
        asset.textContent = punch.assetName;
        popup.append(title, when, distance, asset);

        const marker = L.marker([punch.displayLat, punch.displayLon], { icon, zIndexOffset: punch.kind === 'out' ? 80 : 60 })
          .bindPopup(popup)
          .on('click', () => onSelectRef.current(punch.id))
          .addTo(layers);
        markersRef.current.set(punch.id, marker);
      }

      const fitKey = pins.map((punch) => punch.id).join('|');
      if (fitKey !== fittedKeyRef.current) {
        fittedKeyRef.current = fitKey;
        if (pins.length > 0) {
          const bounds = L.latLngBounds(pins.map((punch) => [punch.lat, punch.lon] as [number, number]));
          bounds.extend([SHOP_LOCATION.lat, SHOP_LOCATION.lon]);
          map.fitBounds(bounds, { padding: [36, 36], maxZoom: 15 });
        } else {
          map.setView([SHOP_LOCATION.lat, SHOP_LOCATION.lon], 12);
        }
      }

      const selected = selectedPinId ? markersRef.current.get(selectedPinId) : undefined;
      if (selected) {
        selected.openPopup();
        map.panTo(selected.getLatLng());
      }
    };

    void draw();
    return () => {
      cancelled = true;
    };
  }, [mapReady, pins, segments, selectedPinId]);

  return (
    <div
      ref={containerRef}
      className="punch-map-canvas h-[min(70vh,560px)] min-h-[360px] w-full rounded-lg border border-border"
      role="img"
      aria-label="Map of clock-in and clock-out locations"
    />
  );
}
