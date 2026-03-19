import { useMemo, useState } from 'react';
import { useQueries, useQuery } from '@tanstack/react-query';
import { IsoHomeControls } from './IsoHomeControls';
import { IsoHomeMap } from './IsoHomeMap';
import { LONDON_TERMINI, TIME_BUCKETS } from './config';
import { generateSampleGrid, computeCostField } from './utils/costField';
import type { FeatureCollection, Polygon, MultiPolygon } from 'geojson';
import type { LayerWeight, CostPoint, Colormap, TransportMode, TransportModeId } from './types';

async function fetchIsochrone(crs: string, minutes: number): Promise<FeatureCollection> {
  const res = await fetch(`/api/isochrone/${crs}/${minutes}`);
  if (!res.ok) {
    if (res.status === 404) throw new Error(`Data not yet available for ${crs}.`);
    throw new Error(`Failed to load isochrone for ${crs}.`);
  }
  return res.json();
}

const DEFAULT_TRANSPORT_MODES: TransportMode[] = [
  { id: 'train', label: 'Train', icon: '🚆', enabled: true, available: true },
  { id: 'car', label: 'Car', icon: '🚗', enabled: true, available: true },
  { id: 'walk', label: 'Walk', icon: '🚶', enabled: false, available: true },
  { id: 'tube', label: 'Tube', icon: '🚇', enabled: false, available: false },
];

const DEFAULT_WALK_CAP = 15; // minutes

export function IsoHomePage() {
  const [selectedTermini, setSelectedTermini] = useState<string[]>(['KGX']);
  const [selectedMinutesIndex, setSelectedMinutesIndex] = useState(2); // 60 min
  const [showStations, setShowStations] = useState(false);
  const [showRailLines, setShowRailLines] = useState(false);
  const [showRouteInfo, setShowRouteInfo] = useState(true);
  const [transportModes, setTransportModes] = useState<TransportMode[]>(DEFAULT_TRANSPORT_MODES);
  const [walkCap, setWalkCap] = useState<number>(DEFAULT_WALK_CAP);
  const [layerWeights, setLayerWeights] = useState<LayerWeight[]>([
    { id: 'sunshine', label: 'Sunshine', weight: 5, enabled: true, higherIsBetter: true, stats: { mean: 1660.8, stddev: 146.5 } },
    { id: 'house_price', label: 'House price', weight: 5, enabled: true, higherIsBetter: false, stats: { mean: 192049, stddev: 76572 } },
    { id: 'crime', label: 'Crime rate', weight: 5, enabled: true, higherIsBetter: false, stats: { mean: 51.8, stddev: 13.5 } },
  ]);
  const [colormap, setColormap] = useState<Colormap>('jet');

  const selectedMinutes = TIME_BUCKETS[selectedMinutesIndex];
  const carEnabled = transportModes.find((m) => m.id === 'car')?.enabled ?? true;
  const walkEnabled = transportModes.find((m) => m.id === 'walk')?.enabled ?? false;

  const isochroneQueries = useQueries({
    queries: selectedTermini.map((crs) => ({
      queryKey: ['isochrone', crs, selectedMinutes],
      queryFn: () => fetchIsochrone(crs, selectedMinutes),
      staleTime: 1000 * 60 * 60,
    })),
  });

  const isoLoading = isochroneQueries.some((q) => q.isLoading);
  const isoError = isochroneQueries.find((q) => q.error)?.error;

  const walkIsochroneQueries = useQueries({
    queries: walkEnabled
      ? selectedTermini.map((crs) => ({
          queryKey: ['isochrone-walk', crs, selectedMinutes],
          queryFn: async () => {
            const res = await fetch(`/api/isochrone/walk/${crs}/${selectedMinutes}`);
            if (!res.ok) return null; // 404 = not yet computed; silently skip
            return res.json() as Promise<FeatureCollection>;
          },
          staleTime: 1000 * 60 * 60,
        }))
      : [],
  });

  const mergedWalkIsochrone = useMemo<FeatureCollection | undefined>(() => {
    if (!walkEnabled) return undefined;
    const allFeatures = walkIsochroneQueries
      .filter((q) => q.data)
      .flatMap((q) => q.data!.features);
    if (allFeatures.length === 0) return undefined;
    return { type: 'FeatureCollection', features: allFeatures };
  }, [walkIsochroneQueries, walkEnabled]);

  const mergedIsochrone = useMemo<FeatureCollection | undefined>(() => {
    const allFeatures = isochroneQueries
      .filter((q) => q.data)
      .flatMap((q) => q.data!.features);
    if (allFeatures.length === 0) return undefined;
    return { type: 'FeatureCollection', features: allFeatures };
  }, [isochroneQueries]);

  const { data: stationsData } = useQuery({
    queryKey: ['static', 'stations'],
    queryFn: () => fetch('/api/static/stations').then((r) => r.json()),
    staleTime: Infinity,
  });

  const { data: railLinesData } = useQuery({
    queryKey: ['static', 'rail-lines'],
    queryFn: () => fetch('/api/static/rail-lines').then((r) => r.json()),
    staleTime: Infinity,
  });

  const { data: sunshineData } = useQuery({
    queryKey: ['static', 'sunshine'],
    queryFn: () => fetch('/api/static/sunshine').then((r) => r.json()),
    staleTime: Infinity,
  });

  const { data: housePriceData } = useQuery({
    queryKey: ['static', 'house-prices'],
    queryFn: () => fetch('/api/static/house-prices').then((r) => r.json()),
    staleTime: Infinity,
  });

  const { data: crimeData } = useQuery({
    queryKey: ['static', 'crime'],
    queryFn: () => fetch('/api/static/crime').then((r) => r.json()),
    staleTime: Infinity,
  });

  const costScores = useMemo<CostPoint[]>(() => {
    if (!mergedIsochrone || !sunshineData || !housePriceData || !crimeData) return [];
    const activeWeights = layerWeights.filter((l) => l.enabled && l.weight > 0);
    if (activeWeights.length === 0) return [];
    try {
      const points = generateSampleGrid(
        mergedIsochrone as FeatureCollection<Polygon | MultiPolygon>,
      );
      return computeCostField(points, activeWeights, {
        sunshine: sunshineData,
        house_price: housePriceData,
        crime: crimeData,
      });
    } catch (e) {
      console.error('computeCostField failed:', e);
      return [];
    }
  }, [mergedIsochrone, sunshineData, housePriceData, crimeData, layerWeights]);

  const handleTerminiChange = (crs: string, selected: boolean) => {
    setSelectedTermini((prev) => {
      if (selected) return [...prev, crs];
      return prev.filter((c) => c !== crs);
    });
  };

  const handleSelectAll = () => {
    setSelectedTermini(LONDON_TERMINI.map((t) => t.crs));
  };

  const handleDeselectAll = () => {
    setSelectedTermini([]);
  };

  const handleTransportModeChange = (id: TransportModeId, enabled: boolean) => {
    setTransportModes((prev) =>
      prev.map((m) => (m.id === id ? { ...m, enabled } : m)),
    );
  };

  return (
    <div className="relative w-screen h-screen">
      <IsoHomeControls
        selectedTermini={selectedTermini}
        onTerminiChange={handleTerminiChange}
        onSelectAll={handleSelectAll}
        onDeselectAll={handleDeselectAll}
        selectedMinutesIndex={selectedMinutesIndex}
        onMinutesChange={setSelectedMinutesIndex}
        showStations={showStations}
        onShowStationsChange={setShowStations}
        showRailLines={showRailLines}
        onShowRailLinesChange={setShowRailLines}
        showRouteInfo={showRouteInfo}
        onShowRouteInfoChange={setShowRouteInfo}
        transportModes={transportModes}
        onTransportModeChange={handleTransportModeChange}
        walkCap={walkCap}
        onWalkCapChange={setWalkCap}
        isLoading={isoLoading}
        error={isoError?.message ?? null}
        layerWeights={layerWeights}
        onLayerWeightsChange={setLayerWeights}
        colormap={colormap}
        onColormapChange={setColormap}
      />
      <IsoHomeMap
        isochroneData={mergedIsochrone}
        stationsData={stationsData}
        railLinesData={railLinesData}
        showStations={showStations}
        showRailLines={showRailLines}
        showRouteInfo={showRouteInfo}
        timeBudget={selectedMinutes}
        isLoading={isoLoading}
        costScores={costScores}
        colormap={colormap}
        carEnabled={carEnabled}
        walkIsochroneData={mergedWalkIsochrone}
        walkCap={walkCap}
      />
    </div>
  );
}
