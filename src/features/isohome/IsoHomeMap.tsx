import { useEffect, useRef, useState, useCallback } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import type { GeoJSON } from 'geojson';

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
}

function findNearestStation(
  lng: number,
  lat: number,
  data: GeoJSON | undefined,
): StationInfo | null {
  if (!data || data.type !== 'FeatureCollection') return null;

  let nearest: StationInfo | null = null;
  let minDist = Infinity;

  for (const feat of data.features) {
    const props = feat.properties;
    if (!props || props.feature_type !== 'station') continue;
    if (feat.geometry.type !== 'Point') continue;

    const [sLng, sLat] = feat.geometry.coordinates;
    const dx = lng - sLng;
    const dy = lat - sLat;
    const dist = dx * dx + dy * dy;

    if (dist < minDist) {
      minDist = dist;
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

function makeLineFC(coords: number[][]): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: [{ type: 'Feature', geometry: { type: 'LineString', coordinates: coords }, properties: {} }],
  };
}

interface RouteInfo {
  station: StationInfo;
  driveMinutes: number | null;
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
  }, [isochroneData, mapLoaded]);

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

      const features = map.queryRenderedFeatures(e.point, { layers: ['isochrone-fill'] });
      if (features.length === 0) {
        clearRouteDisplay();
        lastFetchKey = '';
        map.getCanvas().style.cursor = '';
        return;
      }

      map.getCanvas().style.cursor = 'crosshair';

      const station = findNearestStation(e.lngLat.lng, e.lngLat.lat, isochroneData);
      if (!station) { clearRouteDisplay(); lastFetchKey = ''; return; }

      // Show route info with static drive budget initially
      setRouteInfo({ station, driveMinutes: null });

      // Train leg — precomputed rail route
      const trainCoords = station.rail_route ??
        [[station.station_lon, station.station_lat], [station.terminus_lon, station.terminus_lat]];
      (map.getSource('route-train-source') as mapboxgl.GeoJSONSource)?.setData(makeLineFC(trainCoords));

      // Drive leg — show straight line immediately as loading state
      const straightCoords = [[e.lngLat.lng, e.lngLat.lat], [station.station_lon, station.station_lat]];
      (map.getSource('route-drive-source') as mapboxgl.GeoJSONSource)?.setData(makeLineFC(straightCoords));
      (map.getSource('route-snap-source') as mapboxgl.GeoJSONSource)?.setData(makeEmptyFC());

      // Build a key to avoid re-fetching the same route
      const fetchKey = `${e.lngLat.lng.toFixed(3)},${e.lngLat.lat.toFixed(3)}-${station.crs}`;
      if (fetchKey === lastFetchKey) return;

      // Cancel previous fetch
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
          // Draw road route (snapped start → station)
          (map.getSource('route-drive-source') as mapboxgl.GeoJSONSource)?.setData(
            makeLineFC(result.coordinates),
          );

          // Draw snap line (hover point → road snap point) if they differ
          const [snapLng, snapLat] = result.snapped_start;
          const snapDist = Math.abs(snapLng - hoverLng) + Math.abs(snapLat - hoverLat);
          if (snapDist > 0.0005) {
            (map.getSource('route-snap-source') as mapboxgl.GeoJSONSource)?.setData(
              makeLineFC([[hoverLng, hoverLat], [snapLng, snapLat]]),
            );
          }

          // Update info panel with actual drive duration
          setRouteInfo({ station: capturedStation, driveMinutes: result.duration_minutes });
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

    return () => {
      map.off('mousemove', onMouseMove);
      map.off('mouseleave', 'isochrone-fill', onMouseLeave);
      clearRouteDisplay();
    };
  }, [showRouteInfo, mapLoaded, isochroneData, clearRouteDisplay]);

  const driveText = routeInfo
    ? routeInfo.driveMinutes !== null
      ? `~${routeInfo.driveMinutes} min`
      : `≤${routeInfo.station.drive_budget} min`
    : '';
  const totalMinutes = routeInfo
    ? routeInfo.driveMinutes !== null
      ? routeInfo.driveMinutes + routeInfo.station.journey_minutes
      : null
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
          <div style={{ color: '#16a34a' }}>🚗 Drive to {routeInfo.station.name}: {driveText}</div>
          <div style={{ color: '#2563eb' }}>🚆 Train to {routeInfo.station.terminus_name}: {routeInfo.station.journey_minutes} min</div>
          <div className="border-t border-gray-200 mt-1 pt-1 font-semibold" style={overBudget ? { color: '#dc2626' } : undefined}>
            Total: {totalText}{overBudget ? ` (exceeds ${timeBudget} min)` : ''}
          </div>
        </div>
      )}
    </div>
  );
}
