import { Loader2 } from 'lucide-react';
import { LONDON_TERMINI, TIME_BUCKETS } from './config';
import { formatMinutes } from './utils/formatTime';

interface IsoHomeControlsProps {
  selectedTerminus: string;
  onTerminusChange: (crs: string) => void;
  selectedMinutesIndex: number;
  onMinutesChange: (index: number) => void;
  showStations: boolean;
  onShowStationsChange: (show: boolean) => void;
  showRailLines: boolean;
  onShowRailLinesChange: (show: boolean) => void;
  isLoading: boolean;
  error: string | null;
}

export function IsoHomeControls({
  selectedTerminus,
  onTerminusChange,
  selectedMinutesIndex,
  onMinutesChange,
  showStations,
  onShowStationsChange,
  showRailLines,
  onShowRailLinesChange,
  isLoading,
  error,
}: IsoHomeControlsProps) {
  return (
    <div className="absolute top-4 left-4 z-10 bg-white rounded-lg shadow-lg p-4 w-72 space-y-4">
      <h2 className="text-lg font-semibold">IsoHome</h2>

      <div className="space-y-2">
        <label htmlFor="terminus-select" className="text-sm font-medium">
          London Terminus
        </label>
        <select
          id="terminus-select"
          value={selectedTerminus}
          onChange={(e) => onTerminusChange(e.target.value)}
          className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
        >
          {LONDON_TERMINI.map((t) => (
            <option key={t.crs} value={t.crs}>
              {t.name}
            </option>
          ))}
        </select>
      </div>

      <div className="space-y-2">
        <label htmlFor="time-slider" className="text-sm font-medium">
          Max commute: {formatMinutes(TIME_BUCKETS[selectedMinutesIndex])}
        </label>
        <input
          id="time-slider"
          type="range"
          min={0}
          max={TIME_BUCKETS.length - 1}
          step={1}
          value={selectedMinutesIndex}
          onChange={(e) => onMinutesChange(Number(e.target.value))}
          className="w-full"
        />
        <div className="flex justify-between text-xs text-gray-500">
          <span>30m</span>
          <span>2h</span>
        </div>
      </div>

      <div className="space-y-2">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={showStations}
            onChange={(e) => onShowStationsChange(e.target.checked)}
            role="switch"
            aria-label="Show stations"
          />
          Show stations
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={showRailLines}
            onChange={(e) => onShowRailLinesChange(e.target.checked)}
            role="switch"
            aria-label="Show rail lines"
          />
          Show rail lines
        </label>
      </div>

      {isLoading && (
        <div className="flex items-center gap-2 text-sm text-gray-500" data-testid="loading-indicator">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading isochrone...
        </div>
      )}

      {error && (
        <div role="alert" className="rounded-md bg-red-50 border border-red-200 p-3 text-sm text-red-700">
          {error}
        </div>
      )}
    </div>
  );
}
