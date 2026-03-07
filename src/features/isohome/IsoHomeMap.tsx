import { useEffect, useRef, useState } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import type { GeoJSON } from 'geojson';

interface IsoHomeMapProps {
  isochroneData: GeoJSON | undefined;
  stationsData: GeoJSON | undefined;
  railLinesData: GeoJSON | undefined;
  showStations: boolean;
  showRailLines: boolean;
  isLoading: boolean;
}

export function IsoHomeMap({
  isochroneData,
  stationsData,
  railLinesData,
  showStations,
  showRailLines,
  isLoading,
}: IsoHomeMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const [mapLoaded, setMapLoaded] = useState(false);

  useEffect(() => {
    if (!containerRef.current) return;

    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: 'mapbox://styles/mapbox/light-v11',
      center: [-2.5, 54.0],
      zoom: 5.5,
      accessToken: import.meta.env.VITE_MAPBOX_TOKEN,
    });

    map.on('load', () => {
      setMapLoaded(true);
    });

    map.addControl(new mapboxgl.NavigationControl(), 'top-right');

    mapRef.current = map;

    return () => {
      setMapLoaded(false);
      map.remove();
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded || !isochroneData) return;

    const source = map.getSource('isochrone-source') as mapboxgl.GeoJSONSource | undefined;
    if (source) {
      source.setData(isochroneData as GeoJSON.FeatureCollection);
    } else {
      map.addSource('isochrone-source', { type: 'geojson', data: isochroneData as GeoJSON.FeatureCollection });
      map.addLayer({
        id: 'isochrone-fill',
        type: 'fill',
        source: 'isochrone-source',
        paint: { 'fill-color': '#ef4444', 'fill-opacity': 0.25 },
      });
      map.addLayer({
        id: 'isochrone-outline',
        type: 'line',
        source: 'isochrone-source',
        paint: { 'line-color': '#dc2626', 'line-width': 1.5 },
      });
    }
  }, [isochroneData, mapLoaded]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded || !stationsData) return;

    if (!map.getSource('stations-source')) {
      map.addSource('stations-source', { type: 'geojson', data: stationsData as GeoJSON.FeatureCollection });
      map.addLayer({
        id: 'stations-layer',
        type: 'circle',
        source: 'stations-source',
        paint: { 'circle-radius': 4, 'circle-color': '#1d4ed8', 'circle-opacity': 0.8 },
      });
    }

    map.setLayoutProperty('stations-layer', 'visibility', showStations ? 'visible' : 'none');
  }, [stationsData, showStations, mapLoaded]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded || !railLinesData) return;

    if (!map.getSource('rail-lines-source')) {
      map.addSource('rail-lines-source', { type: 'geojson', data: railLinesData as GeoJSON.FeatureCollection });
      map.addLayer({
        id: 'rail-lines-layer',
        type: 'line',
        source: 'rail-lines-source',
        paint: { 'line-color': '#1d4ed8', 'line-width': 1, 'line-opacity': 0.6 },
      });
    }

    map.setLayoutProperty('rail-lines-layer', 'visibility', showRailLines ? 'visible' : 'none');
  }, [railLinesData, showRailLines, mapLoaded]);

  return (
    <div
      ref={containerRef}
      data-testid="map-container"
      className="w-full h-full"
      style={{ opacity: isLoading ? 0.5 : 1, transition: 'opacity 0.2s' }}
    />
  );
}
