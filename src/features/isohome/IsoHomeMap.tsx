import { useEffect, useRef, useState, useCallback } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import type { GeoJSON } from 'geojson';
import type { CostPoint, Colormap } from './types';
import { COLORMAP_EXPRESSIONS } from './colormaps';

interface StationInfo {
  name: string;
  crs: string;
  journey_minutes: number;
  drive_budget: number;
  terminus_name: string;
  terminus_crs: string;
  terminus_lon: number;
  terminus_lat: number;
  station_lon: number;
  station_lat: number;
  rail_route: number[][] | null;
}

interface DriveRouteResult {
  coordinates: number[][];
  duration_minutes: number;
  snapped_start: [number, number];
}

interface IsoHomeMapProps {
  isochroneData: GeoJSON | undefined;
  stationsData: GeoJSON | undefined;
  railLinesData: GeoJSON | undefined;
  showStations: boolean;
  showRailLines: boolean;
  showRouteInfo: boolean;
  timeBudget: number;
  isLoading: boolean;
  costScores: CostPoint[];
  colormap: Colormap;
  carEnabled: boolean;
  walkIsochroneData: GeoJSON | undefined;
  walkCap: number;
}

/** Ray-casting point-in-polygon test for a single exterior ring */
export function isPointInRing(lng: number, lat: number, ring: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1];
    const xj = ring[j][0], yj = ring[j][1];
    if (((yi > lat) !== (yj > lat)) && (lng < (xj - xi) * (lat - yi) / (yj - yi) + xi)) {
      inside = !inside;
    }
  }
  return inside;
}

/** Check if a point is inside any Polygon/MultiPolygon feature in a FeatureCollection */
export function isPointInFC(lng: number, lat: number, data: GeoJSON | undefined): boolean {
  if (!data || data.type !== 'FeatureCollection') return false;
  for (const feat of (data as GeoJSON.FeatureCollection).features) {
    const g = feat.geometry;
    if (g.type === 'Polygon') {
      if (isPointInRing(lng, lat, g.coordinates[0] as number[][])) return true;
    } else if (g.type === 'MultiPolygon') {
      for (const poly of g.coordinates) {
        if (isPointInRing(lng, lat, poly[0] as number[][])) return true;
      }
    }
  }
  return false;
}

/** Check if a point is within any walk-iso circle (mirrors walk-iso-fill layer logic) */
function isPointInWalkCircles(lng: number, lat: number, data: GeoJSON | undefined, wCap: number): boolean {
  if (!data || data.type !== 'FeatureCollection' || wCap < MIN_WALK_BUDGET) return false;
  for (const f of (data as GeoJSON.FeatureCollection).features) {
    if (f.properties?.feature_type !== 'station' || f.geometry.type !== 'Point') continue;
    const rawBudget = (f.properties.time_budget as number) - (f.properties.journey_minutes as number) - MIN_WALK_BUDGET;
    const budget = Math.min(rawBudget, wCap);
    if (budget < MIN_WALK_BUDGET) continue;
    const [sLng, sLat] = (f.geometry as GeoJSON.Point).coordinates;
    const latRad = (sLat * Math.PI) / 180;
    const dLngKm = (lng - sLng) * 111 * Math.cos(latRad);
    const dLatKm = (lat - sLat) * 111;
    if (Math.sqrt(dLngKm * dLngKm + dLatKm * dLatKm) <= budget * WALK_SPEED_KM_PER_MIN) return true;
  }
  return false;
}

/** Check if a point is within the walk-buffer circles (mirrors walk-buffer-fill layer logic) */
function isPointInWalkBuffer(lng: number, lat: number, data: GeoJSON | undefined, timeBudget: number): boolean {
  if (!data || data.type !== 'FeatureCollection') return false;
  for (const f of (data as GeoJSON.FeatureCollection).features) {
    if (f.properties?.feature_type !== 'station' || f.geometry.type !== 'Point') continue;
    if ((f.properties.journey_minutes as number) > timeBudget - WALK_MINUTES) continue;
    const [sLng, sLat] = (f.geometry as GeoJSON.Point).coordinates;
    const latRad = (sLat * Math.PI) / 180;
    const dLngKm = (lng - sLng) * 111 * Math.cos(latRad);
    const dLatKm = (lat - sLat) * 111;
    if (Math.sqrt(dLngKm * dLngKm + dLatKm * dLatKm) <= WALK_RADIUS_KM) return true;
  }
  return false;
}

/**
 * Find the best station for a given cursor position.
 * Minimises estimated total commute time (train journey + estimated drive/walk)
 * rather than raw geographic distance, so that with multiple overlapping termini
 * we snap to the fastest overall option.
 */
export function findNearestStation(
  lng: number,
  lat: number,
  data: GeoJSON | undefined,
  maxBudget?: number, // filter stations by drive_budget/walk_budget ≤ maxBudget
): StationInfo | null {
  if (!data || data.type !== 'FeatureCollection') return null;

  let nearest: StationInfo | null = null;
  let minCost = Infinity;

  for (const feat of (data as GeoJSON.FeatureCollection).features) {
    const props = feat.properties;
    if (!props || props.feature_type !== 'station') continue;
    if (feat.geometry.type !== 'Point') continue;
    if (maxBudget !== undefined && (props.drive_budget as number) > maxBudget) continue;

    const [sLng, sLat] = feat.geometry.coordinates;
    const latRad = (sLat * Math.PI) / 180;
    const dLngKm = (lng - sLng) * 111 * Math.cos(latRad);
    const dLatKm = (lat - sLat) * 111;
    const distKm = Math.sqrt(dLngKm * dLngKm + dLatKm * dLatKm);
    // Estimate total commute: train + ~30 km/h driving
    const cost = (props.journey_minutes as number) + distKm * 2;

    if (cost < minCost) {
      minCost = cost;
      nearest = {
        name: props.name,
        crs: props.crs,
        journey_minutes: props.journey_minutes,
        drive_budget: props.drive_budget,
        terminus_name: props.terminus_name,
        terminus_crs: props.terminus_crs,
        terminus_lon: props.terminus_lon,
        terminus_lat: props.terminus_lat,
        station_lon: sLng,
        station_lat: sLat,
        rail_route: props.rail_route ?? null,
      };
    }
  }

  return nearest;
}

async function fetchWalkRoute(
  fromLng: number,
  fromLat: number,
  toLng: number,
  toLat: number,
  token: string,
  signal: AbortSignal,
): Promise<DriveRouteResult | null> {
  try {
    const url = `https://api.mapbox.com/directions/v5/mapbox/walking/${fromLng},${fromLat};${toLng},${toLat}?geometries=geojson&overview=full&access_token=${token}`;
    const res = await fetch(url, { signal });
    if (!res.ok) return null;
    const data = await res.json();
    const route = data.routes?.[0];
    if (!route?.geometry?.coordinates) return null;
    const snappedStart = data.waypoints?.[0]?.location as [number, number] | undefined;
    return {
      coordinates: route.geometry.coordinates,
      duration_minutes: Math.round(route.duration / 60),
      snapped_start: snappedStart ?? [fromLng, fromLat],
    };
  } catch {
    return null;
  }
}

async function fetchDriveRoute(
  fromLng: number,
  fromLat: number,
  toLng: number,
  toLat: number,
  token: string,
  signal: AbortSignal,
): Promise<DriveRouteResult | null> {
  try {
    const url = `https://api.mapbox.com/directions/v5/mapbox/driving/${fromLng},${fromLat};${toLng},${toLat}?geometries=geojson&overview=full&access_token=${token}`;
    const res = await fetch(url, { signal });
    if (!res.ok) return null;
    const data = await res.json();
    const route = data.routes?.[0];
    if (!route?.geometry?.coordinates) return null;

    const snappedStart = data.waypoints?.[0]?.location as [number, number] | undefined;

    return {
      coordinates: route.geometry.coordinates,
      duration_minutes: Math.round(route.duration / 60),
      snapped_start: snappedStart ?? [fromLng, fromLat],
    };
  } catch {
    return null;
  }
}

function makeEmptyFC(): GeoJSON.FeatureCollection {
  return { type: 'FeatureCollection', features: [] };
}

/** Approximate circle polygon — avoids adding @turf/circle dependency */
function makeCirclePolygon(
  lng: number,
  lat: number,
  radiusKm: number,
  steps = 24,
): GeoJSON.Feature<GeoJSON.Polygon> {
  const coords: number[][] = [];
  const latRad = (lat * Math.PI) / 180;
  for (let i = 0; i <= steps; i++) {
    const angle = (i / steps) * 2 * Math.PI;
    const dLat = (radiusKm / 111) * Math.cos(angle);
    const dLng = (radiusKm / (111 * Math.cos(latRad))) * Math.sin(angle);
    coords.push([lng + dLng, lat + dLat]);
  }
  return {
    type: 'Feature',
    geometry: { type: 'Polygon', coordinates: [coords] },
    properties: {},
  };
}

function makeLineFC(coords: number[][]): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: [{ type: 'Feature', geometry: { type: 'LineString', coordinates: coords }, properties: {} }],
  };
}

const WALK_SPEED_KM_PER_MIN = 5 / 60; // 5 km/h
const WALK_MINUTES = 10;
const WALK_RADIUS_KM = WALK_SPEED_KM_PER_MIN * WALK_MINUTES; // ~0.833 km
const MIN_WALK_BUDGET = 5; // minimum walk budget to display a zone (minutes)

interface RouteInfo {
  station: StationInfo;
  driveMinutes: number | null;
  walkMode: boolean;
}

export function IsoHomeMap({
  isochroneData,
  stationsData,
  railLinesData,
  showStations,
  showRailLines,
  showRouteInfo,
  timeBudget,
  isLoading,
  costScores,
  colormap,
  carEnabled,
  walkIsochroneData,
  walkCap,
}: IsoHomeMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [mapLoaded, setMapLoaded] = useState(false);
  const [routeInfo, setRouteInfo] = useState<RouteInfo | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: 'mapbox://styles/mapbox/light-v11',
      center: [-2.5, 54.0],
      zoom: 5.5,
      accessToken: import.meta.env.VITE_MAPBOX_TOKEN,
    });

    map.on('load', () => setMapLoaded(true));
    map.addControl(new mapboxgl.NavigationControl(), 'top-right');
    mapRef.current = map;

    return () => {
      setMapLoaded(false);
      map.remove();
    };
  }, []);

  // Isochrone layer
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded || !isochroneData) return;

    const polygonData: GeoJSON.FeatureCollection = {
      type: 'FeatureCollection',
      features: (isochroneData as GeoJSON.FeatureCollection).features.filter(
        (f) => f.geometry.type === 'Polygon' || f.geometry.type === 'MultiPolygon',
      ),
    };

    const source = map.getSource('isochrone-source') as mapboxgl.GeoJSONSource | undefined;
    if (source) {
      source.setData(polygonData);
    } else {
      map.addSource('isochrone-source', { type: 'geojson', data: polygonData });
      map.addLayer({ id: 'isochrone-fill', type: 'fill', source: 'isochrone-source', paint: { 'fill-color': '#ef4444', 'fill-opacity': 0.25 } });
      map.addLayer({ id: 'isochrone-outline', type: 'line', source: 'isochrone-source', paint: { 'line-color': '#dc2626', 'line-width': 1.5 } });
    }

    // Ensure cost heatmap source/layer exists (inserted below isochrone-fill)
    if (!map.getSource('cost-heatmap-source')) {
      map.addSource('cost-heatmap-source', { type: 'geojson', data: makeEmptyFC() });
      map.addLayer({
        id: 'cost-heatmap-layer',
        type: 'heatmap',
        source: 'cost-heatmap-source',
        paint: {
          'heatmap-weight': ['get', 'score'],
          'heatmap-radius': [
            'interpolate', ['exponential', 2], ['zoom'],
            5, 20,
            8, 60,
            10, 120,
            12, 250,
          ],
          'heatmap-opacity': 0.75,
          'heatmap-intensity': [
            'interpolate', ['linear'], ['zoom'],
            5, 1.5,
            8, 1,
            10, 0.8,
            12, 0.6,
          ],
          'heatmap-color': COLORMAP_EXPRESSIONS['viridis'],
        },
      }, 'isochrone-fill');
    }
  }, [isochroneData, mapLoaded]);

  // Walk-buffer layer (shown when car is disabled)
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded) return;

    // Ensure source/layers exist
    if (!map.getSource('walk-buffer-source')) {
      map.addSource('walk-buffer-source', { type: 'geojson', data: makeEmptyFC() });
      map.addLayer(
        { id: 'walk-buffer-fill', type: 'fill', source: 'walk-buffer-source',
          paint: { 'fill-color': '#ef4444', 'fill-opacity': 0.25 } },
        'isochrone-fill',
      );
      map.addLayer(
        { id: 'walk-buffer-outline', type: 'line', source: 'walk-buffer-source',
          paint: { 'line-color': '#dc2626', 'line-width': 1.5 } },
        'isochrone-outline',
      );
    }

    // Toggle drive isochrone vs walk circles
    const driveVisibility = carEnabled ? 'visible' : 'none';
    const walkVisibility = carEnabled ? 'none' : 'visible';
    if (map.getLayer('isochrone-fill')) {
      map.setLayoutProperty('isochrone-fill', 'visibility', driveVisibility);
      map.setLayoutProperty('isochrone-outline', 'visibility', driveVisibility);
    }
    map.setLayoutProperty('walk-buffer-fill', 'visibility', walkVisibility);
    map.setLayoutProperty('walk-buffer-outline', 'visibility', walkVisibility);

    if (!carEnabled && isochroneData && isochroneData.type === 'FeatureCollection') {
      // Only include stations where the train leg leaves enough budget for the walk
      const stationFeatures = (isochroneData as GeoJSON.FeatureCollection).features.filter(
        (f) =>
          f.properties?.feature_type === 'station' &&
          f.geometry.type === 'Point' &&
          (f.properties?.journey_minutes as number) <= timeBudget - WALK_MINUTES,
      );

      const circles: GeoJSON.Feature<GeoJSON.Polygon>[] = stationFeatures.map((f) => {
        const [lng, lat] = (f.geometry as GeoJSON.Point).coordinates;
        return makeCirclePolygon(lng, lat, WALK_RADIUS_KM);
      });

      const fc: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: circles };
      (map.getSource('walk-buffer-source') as mapboxgl.GeoJSONSource)?.setData(fc);
    } else {
      (map.getSource('walk-buffer-source') as mapboxgl.GeoJSONSource)?.setData(makeEmptyFC());
    }
  }, [carEnabled, isochroneData, mapLoaded, timeBudget]);

  // Walk isochrone layer — circles per station sized to min(walk_budget, walkCap)
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded) return;

    const circles: GeoJSON.Feature<GeoJSON.Polygon>[] = [];
    if (walkIsochroneData && walkIsochroneData.type === 'FeatureCollection' && walkCap >= MIN_WALK_BUDGET) {
      for (const f of (walkIsochroneData as GeoJSON.FeatureCollection).features) {
        if (f.properties?.feature_type !== 'station' || f.geometry.type !== 'Point') continue;
        // Derive the uncapped budget from stored time_budget and journey_minutes
        // (stored drive_budget is min(actual, 15) — the precompute cap)
        const rawBudget = (f.properties.time_budget as number) - (f.properties.journey_minutes as number) - MIN_WALK_BUDGET;
        const budget = Math.min(rawBudget, walkCap);
        if (budget < MIN_WALK_BUDGET) continue;
        const [lng, lat] = (f.geometry as GeoJSON.Point).coordinates;
        circles.push(makeCirclePolygon(lng, lat, budget * WALK_SPEED_KM_PER_MIN));
      }
    }

    const polygonData: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: circles };

    const source = map.getSource('walk-iso-source') as mapboxgl.GeoJSONSource | undefined;
    if (source) {
      source.setData(polygonData);
    } else {
      map.addSource('walk-iso-source', { type: 'geojson', data: polygonData });
      map.addLayer({
        id: 'walk-iso-fill',
        type: 'fill',
        source: 'walk-iso-source',
        paint: { 'fill-color': '#16a34a', 'fill-opacity': 0.2 },
      });
      map.addLayer({
        id: 'walk-iso-outline',
        type: 'line',
        source: 'walk-iso-source',
        paint: { 'line-color': '#15803d', 'line-width': 1.5 },
      });
    }
  }, [walkIsochroneData, walkCap, mapLoaded]);

  // Stations layer
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded || !stationsData) return;
    if (!map.getSource('stations-source')) {
      map.addSource('stations-source', { type: 'geojson', data: stationsData as GeoJSON.FeatureCollection });
      map.addLayer({ id: 'stations-layer', type: 'circle', source: 'stations-source', paint: { 'circle-radius': 4, 'circle-color': '#1d4ed8', 'circle-opacity': 0.8 } });
    }
    map.setLayoutProperty('stations-layer', 'visibility', showStations ? 'visible' : 'none');
  }, [stationsData, showStations, mapLoaded]);

  // Rail lines layer
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded || !railLinesData) return;
    if (!map.getSource('rail-lines-source')) {
      map.addSource('rail-lines-source', { type: 'geojson', data: railLinesData as GeoJSON.FeatureCollection });
      map.addLayer({ id: 'rail-lines-layer', type: 'line', source: 'rail-lines-source', paint: { 'line-color': '#1d4ed8', 'line-width': 1, 'line-opacity': 0.6 } });
    }
    map.setLayoutProperty('rail-lines-layer', 'visibility', showRailLines ? 'visible' : 'none');
  }, [railLinesData, showRailLines, mapLoaded]);

  // Update cost heatmap data
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded) return;
    const source = map.getSource('cost-heatmap-source') as mapboxgl.GeoJSONSource | undefined;
    if (!source) return;

    const fc: GeoJSON.FeatureCollection = {
      type: 'FeatureCollection',
      features: costScores.map(p => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [p.lng, p.lat] },
        properties: { score: p.score },
      })),
    };
    source.setData(fc);
  }, [costScores, mapLoaded]);

  // Update colormap
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded) return;
    if (map.getLayer('cost-heatmap-layer')) {
      map.setPaintProperty('cost-heatmap-layer', 'heatmap-color', COLORMAP_EXPRESSIONS[colormap]);
    }
  }, [colormap, mapLoaded]);

  // Clear all route display elements
  const clearRouteDisplay = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;
    setRouteInfo(null);
    abortRef.current?.abort();
    abortRef.current = null;
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
    const empty = makeEmptyFC();
    (map.getSource('route-drive-source') as mapboxgl.GeoJSONSource | undefined)?.setData(empty);
    (map.getSource('route-snap-source') as mapboxgl.GeoJSONSource | undefined)?.setData(empty);
    (map.getSource('route-train-source') as mapboxgl.GeoJSONSource | undefined)?.setData(empty);
  }, []);

  // Route hover interaction
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded) return;

    // Ensure route sources/layers exist
    for (const [src, id, paint] of [
      ['route-snap-source', 'route-snap-layer', { 'line-color': '#9ca3af', 'line-width': 2, 'line-dasharray': [1, 3] }],
      ['route-drive-source', 'route-drive-layer', { 'line-color': '#16a34a', 'line-width': 3, 'line-dasharray': [2, 2] }],
      ['route-train-source', 'route-train-layer', { 'line-color': '#2563eb', 'line-width': 3 }],
    ] as const) {
      if (!map.getSource(src)) {
        map.addSource(src, { type: 'geojson', data: makeEmptyFC() });
        map.addLayer({ id, type: 'line', source: src, paint: paint as mapboxgl.LinePaint });
      }
    }

    if (!showRouteInfo) {
      clearRouteDisplay();
      map.getCanvas().style.cursor = '';
      return;
    }

    let lastFetchKey = '';

    function onMouseMove(e: mapboxgl.MapMouseEvent) {
      if (!showRouteInfo || !map) return;

      const { lng, lat } = e.lngLat;

      // Use direct data checks instead of queryRenderedFeatures to avoid the
      // rendering delay after setData (which caused car routes to fail after termini change).
      const inWalkIso = isPointInWalkCircles(lng, lat, walkIsochroneData, walkCap);
      const inMainZone = carEnabled
        ? isPointInFC(lng, lat, isochroneData)
        : isPointInWalkBuffer(lng, lat, isochroneData, timeBudget);

      if (!inWalkIso && !inMainZone) {
        clearRouteDisplay();
        lastFetchKey = '';
        map.getCanvas().style.cursor = '';
        return;
      }

      map.getCanvas().style.cursor = 'crosshair';

      // In the walk-iso zone, find nearest station from walk isochrone data (respects walkCap filter)
      const searchData = inWalkIso ? walkIsochroneData : isochroneData;
      const station = findNearestStation(e.lngLat.lng, e.lngLat.lat, searchData);
      if (!station) { clearRouteDisplay(); lastFetchKey = ''; return; }

      // Train leg — precomputed rail route
      const trainCoords = station.rail_route ??
        [[station.station_lon, station.station_lat], [station.terminus_lon, station.terminus_lat]];
      (map.getSource('route-train-source') as mapboxgl.GeoJSONSource)?.setData(makeLineFC(trainCoords));

      if (!carEnabled || inWalkIso) {
        // Walk mode: show straight line immediately, then fetch road-snapped walking route
        const straightCoords = [[e.lngLat.lng, e.lngLat.lat], [station.station_lon, station.station_lat]];
        (map.getSource('route-drive-source') as mapboxgl.GeoJSONSource)?.setData(makeLineFC(straightCoords));
        (map.getSource('route-snap-source') as mapboxgl.GeoJSONSource)?.setData(makeEmptyFC());
        setRouteInfo({ station, driveMinutes: station.drive_budget, walkMode: true });

        const fetchKey = `walk-${e.lngLat.lng.toFixed(3)},${e.lngLat.lat.toFixed(3)}-${station.crs}`;
        if (fetchKey === lastFetchKey) return;

        abortRef.current?.abort();
        if (timerRef.current) clearTimeout(timerRef.current);

        const hoverLng = e.lngLat.lng;
        const hoverLat = e.lngLat.lat;
        const capturedStation = station;

        timerRef.current = setTimeout(async () => {
          const controller = new AbortController();
          abortRef.current = controller;
          const token = import.meta.env.VITE_MAPBOX_TOKEN;
          const result = await fetchWalkRoute(
            hoverLng, hoverLat,
            capturedStation.station_lon, capturedStation.station_lat,
            token, controller.signal,
          );
          if (controller.signal.aborted) return;
          lastFetchKey = fetchKey;
          if (result && result.coordinates.length >= 2) {
            (map.getSource('route-drive-source') as mapboxgl.GeoJSONSource)?.setData(makeLineFC(result.coordinates));
            setRouteInfo({ station: capturedStation, driveMinutes: result.duration_minutes, walkMode: true });
          }
        }, 150);
        return;
      }

      // Car mode: show straight line immediately as loading state
      setRouteInfo({ station, driveMinutes: null, walkMode: false });
      const straightCoords = [[e.lngLat.lng, e.lngLat.lat], [station.station_lon, station.station_lat]];
      (map.getSource('route-drive-source') as mapboxgl.GeoJSONSource)?.setData(makeLineFC(straightCoords));
      (map.getSource('route-snap-source') as mapboxgl.GeoJSONSource)?.setData(makeEmptyFC());

      // Build a key to avoid re-fetching the same route
      const fetchKey = `${e.lngLat.lng.toFixed(3)},${e.lngLat.lat.toFixed(3)}-${station.crs}`;
      if (fetchKey === lastFetchKey) return;

      abortRef.current?.abort();
      if (timerRef.current) clearTimeout(timerRef.current);

      const hoverLng = e.lngLat.lng;
      const hoverLat = e.lngLat.lat;
      const capturedStation = station;

      // Debounce: fetch road route after cursor stops for 150ms
      timerRef.current = setTimeout(async () => {
        const controller = new AbortController();
        abortRef.current = controller;

        const token = import.meta.env.VITE_MAPBOX_TOKEN;
        const result = await fetchDriveRoute(
          hoverLng, hoverLat,
          capturedStation.station_lon, capturedStation.station_lat,
          token, controller.signal,
        );

        if (controller.signal.aborted) return;
        lastFetchKey = fetchKey;

        if (result && result.coordinates.length >= 2) {
          (map.getSource('route-drive-source') as mapboxgl.GeoJSONSource)?.setData(
            makeLineFC(result.coordinates),
          );

          const [snapLng, snapLat] = result.snapped_start;
          const snapDist = Math.abs(snapLng - hoverLng) + Math.abs(snapLat - hoverLat);
          if (snapDist > 0.0005) {
            (map.getSource('route-snap-source') as mapboxgl.GeoJSONSource)?.setData(
              makeLineFC([[hoverLng, hoverLat], [snapLng, snapLat]]),
            );
          }

          setRouteInfo({ station: capturedStation, driveMinutes: result.duration_minutes, walkMode: false });
        }
      }, 150);
    }

    function onMouseLeave() {
      clearRouteDisplay();
      lastFetchKey = '';
      if (map) map.getCanvas().style.cursor = '';
    }

    map.on('mousemove', onMouseMove);
    map.on('mouseleave', 'isochrone-fill', onMouseLeave);
    map.on('mouseleave', 'walk-buffer-fill', onMouseLeave);
    map.on('mouseleave', 'walk-iso-fill', onMouseLeave);

    return () => {
      map.off('mousemove', onMouseMove);
      map.off('mouseleave', 'isochrone-fill', onMouseLeave);
      map.off('mouseleave', 'walk-buffer-fill', onMouseLeave);
      map.off('mouseleave', 'walk-iso-fill', onMouseLeave);
      clearRouteDisplay();
    };
  }, [showRouteInfo, mapLoaded, isochroneData, walkIsochroneData, walkCap, carEnabled, timeBudget, clearRouteDisplay]);

  const legMinutes = routeInfo?.driveMinutes ?? null;
  const legText = routeInfo
    ? legMinutes !== null
      ? `~${legMinutes} min`
      : `≤${routeInfo.station.drive_budget} min`
    : '';
  const totalMinutes = routeInfo && legMinutes !== null
    ? legMinutes + routeInfo.station.journey_minutes
    : null;
  const totalText = routeInfo
    ? totalMinutes !== null
      ? `~${totalMinutes} min`
      : `≤${routeInfo.station.drive_budget + routeInfo.station.journey_minutes} min`
    : '';
  const overBudget = totalMinutes !== null && totalMinutes > timeBudget;

  return (
    <div className="relative w-full h-full">
      <div
        ref={containerRef}
        data-testid="map-container"
        className="w-full h-full"
        style={{ opacity: isLoading ? 0.5 : 1, transition: 'opacity 0.2s' }}
      />
      {routeInfo && (
        <div
          data-testid="route-info-panel"
          className="absolute bottom-4 right-4 bg-white rounded-lg shadow-lg px-4 py-3 pointer-events-none"
          style={{ maxWidth: 280, fontSize: 13, lineHeight: 1.4, zIndex: 10 }}
        >
          <div className="font-semibold mb-1">Route via {routeInfo.station.name}</div>
          <div style={{ color: '#16a34a' }}>
            {routeInfo.walkMode ? '🚶' : '🚗'}{' '}
            {routeInfo.walkMode ? 'Walk' : 'Drive'} to {routeInfo.station.name}: {legText}
          </div>
          <div style={{ color: '#2563eb' }}>🚆 Train to {routeInfo.station.terminus_name}: {routeInfo.station.journey_minutes} min</div>
          <div className="border-t border-gray-200 mt-1 pt-1 font-semibold" style={overBudget ? { color: '#dc2626' } : undefined}>
            Total: {totalText}{overBudget ? ` (exceeds ${timeBudget} min)` : ''}
          </div>
        </div>
      )}
    </div>
  );
}
