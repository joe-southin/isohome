import { useMemo, useState } from 'react';
import { useQueries, useQuery } from '@tanstack/react-query';
import { IsoHomeControls } from './IsoHomeControls';
import { IsoHomeMap } from './IsoHomeMap';
import { TIME_BUCKETS } from './config';
import type { FeatureCollection } from 'geojson';

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
        isLoading={isoLoading}
        error={isoError?.message ?? null}
      />
      <IsoHomeMap
        isochroneData={mergedIsochrone}
        stationsData={stationsData}
        railLinesData={railLinesData}
        showStations={showStations}
        showRailLines={showRailLines}
        isLoading={isoLoading}
      />
    </div>
  );
}
