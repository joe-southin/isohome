import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { IsoHomeControls } from './IsoHomeControls';
import { IsoHomeMap } from './IsoHomeMap';
import { TIME_BUCKETS } from './config';

export function IsoHomePage() {
  const [selectedTerminus, setSelectedTerminus] = useState('KGX');
  const [selectedMinutesIndex, setSelectedMinutesIndex] = useState(2); // 60 min
  const [showStations, setShowStations] = useState(false);
  const [showRailLines, setShowRailLines] = useState(false);

  const selectedMinutes = TIME_BUCKETS[selectedMinutesIndex];

  const {
    data: isochroneData,
    isLoading: isoLoading,
    error: isoError,
  } = useQuery({
    queryKey: ['isochrone', selectedTerminus, selectedMinutes],
    queryFn: async () => {
      const res = await fetch(`/api/isochrone/${selectedTerminus}/${selectedMinutes}`);
      if (!res.ok) {
        if (res.status === 404) throw new Error('Data not yet available for this combination. Try again later.');
        throw new Error('Failed to load isochrone data.');
      }
      return res.json();
    },
    staleTime: 1000 * 60 * 60,
  });

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

  return (
    <div className="relative w-screen h-screen">
      <IsoHomeControls
        selectedTerminus={selectedTerminus}
        onTerminusChange={setSelectedTerminus}
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
        isochroneData={isochroneData}
        stationsData={stationsData}
        railLinesData={railLinesData}
        showStations={showStations}
        showRailLines={showRailLines}
        isLoading={isoLoading}
      />
    </div>
  );
}
