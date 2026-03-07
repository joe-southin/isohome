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
}

interface IsoHomeMapProps {
  isochroneData: GeoJSON | undefined;
  stationsData: GeoJSON | undefined;
  railLinesData: GeoJSON | undefined;
  showStations: boolean;
  showRailLines: boolean;
  showRouteInfo: boolean;
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
      };
    }
  }

  return nearest;
}

export function IsoHomeMap({
  isochroneData,
  stationsData,
  railLinesData,
  showStations,
  showRailLines,
  showRouteInfo,
  isLoading,
}: IsoHomeMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const popupRef = useRef<mapboxgl.Popup | null>(null);
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
      popupRef.current?.remove();
      map.remove();
    };
  }, []);

  // Isochrone layer
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded || !isochroneData) return;

    // Filter to only polygon/multipolygon features for the fill layer
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

  // Stations layer
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

  // Rail lines layer
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

  // Route info hover interaction
  const clearRouteDisplay = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;

    popupRef.current?.remove();
    popupRef.current = null;

    const emptyGeoJSON: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };
    const driveSource = map.getSource('route-drive-source') as mapboxgl.GeoJSONSource | undefined;
    const trainSource = map.getSource('route-train-source') as mapboxgl.GeoJSONSource | undefined;
    if (driveSource) driveSource.setData(emptyGeoJSON);
    if (trainSource) trainSource.setData(emptyGeoJSON);
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded) return;

    // Ensure route line sources/layers exist
    if (!map.getSource('route-drive-source')) {
      map.addSource('route-drive-source', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      });
      map.addLayer({
        id: 'route-drive-layer',
        type: 'line',
        source: 'route-drive-source',
        paint: {
          'line-color': '#16a34a',
          'line-width': 3,
          'line-dasharray': [2, 2],
        },
      });
    }
    if (!map.getSource('route-train-source')) {
      map.addSource('route-train-source', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      });
      map.addLayer({
        id: 'route-train-layer',
        type: 'line',
        source: 'route-train-source',
        paint: {
          'line-color': '#2563eb',
          'line-width': 3,
        },
      });
    }

    if (!showRouteInfo) {
      clearRouteDisplay();
      map.getCanvas().style.cursor = '';
      return;
    }

    function onMouseMove(e: mapboxgl.MapMouseEvent) {
      if (!showRouteInfo || !map) return;

      // Check if cursor is inside the isochrone polygon
      const features = map.queryRenderedFeatures(e.point, { layers: ['isochrone-fill'] });
      if (features.length === 0) {
        clearRouteDisplay();
        map.getCanvas().style.cursor = '';
        return;
      }

      map.getCanvas().style.cursor = 'crosshair';

      const station = findNearestStation(e.lngLat.lng, e.lngLat.lat, isochroneData);
      if (!station) {
        clearRouteDisplay();
        return;
      }

      const totalTime = station.journey_minutes + station.drive_budget;

      // Update popup
      popupRef.current?.remove();
      popupRef.current = new mapboxgl.Popup({
        closeButton: false,
        closeOnClick: false,
        offset: 12,
        className: 'route-info-popup',
      })
        .setLngLat(e.lngLat)
        .setHTML(
          `<div style="font-size:13px;line-height:1.4">
            <div style="font-weight:600;margin-bottom:4px">
              Route via ${station.name}
            </div>
            <div style="color:#16a34a">
              🚗 Drive to ${station.name}: ≤${station.drive_budget} min
            </div>
            <div style="color:#2563eb">
              🚆 Train to ${station.terminus_name}: ${station.journey_minutes} min
            </div>
            <div style="border-top:1px solid #e5e7eb;margin-top:4px;padding-top:4px;font-weight:600">
              Total: ≤${totalTime} min
            </div>
          </div>`,
        )
        .addTo(map);

      // Draw drive leg (cursor → station)
      const driveGeoJSON: GeoJSON.FeatureCollection = {
        type: 'FeatureCollection',
        features: [
          {
            type: 'Feature',
            geometry: {
              type: 'LineString',
              coordinates: [
                [e.lngLat.lng, e.lngLat.lat],
                [station.station_lon, station.station_lat],
              ],
            },
            properties: {},
          },
        ],
      };

      // Draw train leg (station → terminus)
      const trainGeoJSON: GeoJSON.FeatureCollection = {
        type: 'FeatureCollection',
        features: [
          {
            type: 'Feature',
            geometry: {
              type: 'LineString',
              coordinates: [
                [station.station_lon, station.station_lat],
                [station.terminus_lon, station.terminus_lat],
              ],
            },
            properties: {},
          },
        ],
      };

      const driveSource = map.getSource('route-drive-source') as mapboxgl.GeoJSONSource;
      const trainSource = map.getSource('route-train-source') as mapboxgl.GeoJSONSource;
      driveSource?.setData(driveGeoJSON);
      trainSource?.setData(trainGeoJSON);
    }

    function onMouseLeave() {
      clearRouteDisplay();
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

  return (
    <div
      ref={containerRef}
      data-testid="map-container"
      className="w-full h-full"
      style={{ opacity: isLoading ? 0.5 : 1, transition: 'opacity 0.2s' }}
    />
  );
}
