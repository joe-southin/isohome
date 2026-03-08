import { useMemo, useState } from 'react';
import { useQueries, useQuery } from '@tanstack/react-query';
import { IsoHomeControls } from './IsoHomeControls';
import { IsoHomeMap } from './IsoHomeMap';
import { TIME_BUCKETS } from './config';
import { generateSampleGrid, computeCostField } from './utils/costField';
import type { FeatureCollection, Polygon, MultiPolygon } from 'geojson';
import type { LayerWeight, CostPoint, Colormap } from './types';

async function fetchIsochrone(crs: string, minutes: number): Promise<FeatureCollection> {
  const res = await fetch(`/api/isochrone/${crs}/${minutes}`);
  if (!res.ok) {
    if (res.status === 404) throw new Error(`Data not yet available for ${crs}.`);
    throw new Error(`Failed to load isochrone for ${crs}.`);
  }
  return res.json();
}

export function IsoHomePage() {
  const [selectedTermini, setSelectedTermini] = useState<string[]>(['KGX']);
  const [selectedMinutesIndex, setSelectedMinutesIndex] = useState(2); // 60 min
  const [showStations, setShowStations] = useState(false);
  const [showRailLines, setShowRailLines] = useState(false);
  const [showRouteInfo, setShowRouteInfo] = useState(true);
  const [layerWeights, setLayerWeights] = useState<LayerWeight[]>([
    { id: 'sunshine', label: 'Sunshine', weight: 5, enabled: true, higherIsBetter: true, stats: { mean: 1414.8, stddev: 287.3 } },
    { id: 'house_price', label: 'House price', weight: 5, enabled: true, higherIsBetter: false, stats: { mean: 192049, stddev: 76572 } },
  ]);
  const [colormap, setColormap] = useState<Colormap>('viridis');

  const selectedMinutes = TIME_BUCKETS[selectedMinutesIndex];

  const isochroneQueries = useQueries({
    queries: selectedTermini.map((crs) => ({
      queryKey: ['isochrone', crs, selectedMinutes],
      queryFn: () => fetchIsochrone(crs, selectedMinutes),
      staleTime: 1000 * 60 * 60,
    })),
  });

  const isoLoading = isochroneQueries.some((q) => q.isLoading);
  const isoError = isochroneQueries.find((q) => q.error)?.error;

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

  const costScores = useMemo<CostPoint[]>(() => {
    if (!mergedIsochrone || !sunshineData || !housePriceData) return [];
    const activeWeights = layerWeights.filter((l) => l.enabled && l.weight > 0);
    if (activeWeights.length === 0) return [];
    try {
      const points = generateSampleGrid(
        mergedIsochrone as FeatureCollection<Polygon | MultiPolygon>,
      );
      return computeCostField(points, activeWeights, {
        sunshine: sunshineData,
        house_price: housePriceData,
      });
    } catch (e) {
      console.error('computeCostField failed:', e);
      return [];
    }
  }, [mergedIsochrone, sunshineData, housePriceData, layerWeights]);

  const handleTerminiChange = (crs: string, selected: boolean) => {
    setSelectedTermini((prev) => {
      if (selected) return [...prev, crs];
      const next = prev.filter((c) => c !== crs);
      return next.length > 0 ? next : prev; // prevent empty selection
    });
  };

  return (
    <div className="relative w-screen h-screen">
      <IsoHomeControls
        selectedTermini={selectedTermini}
        onTerminiChange={handleTerminiChange}
        selectedMinutesIndex={selectedMinutesIndex}
        onMinutesChange={setSelectedMinutesIndex}
        showStations={showStations}
        onShowStationsChange={setShowStations}
        showRailLines={showRailLines}
        onShowRailLinesChange={setShowRailLines}
        showRouteInfo={showRouteInfo}
        onShowRouteInfoChange={setShowRouteInfo}
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
      />
    </div>
  );
}
