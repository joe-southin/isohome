import { useState } from 'react';
import { ChevronDown, Loader2 } from 'lucide-react';
import { LONDON_TERMINI, TIME_BUCKETS } from './config';
import { formatMinutes } from './utils/formatTime';
import type { LayerWeight, Colormap } from './types';

interface IsoHomeControlsProps {
  selectedTermini: string[];
  onTerminiChange: (crs: string, selected: boolean) => void;
  selectedMinutesIndex: number;
  onMinutesChange: (index: number) => void;
  showStations: boolean;
  onShowStationsChange: (show: boolean) => void;
  showRailLines: boolean;
  onShowRailLinesChange: (show: boolean) => void;
  showRouteInfo: boolean;
  onShowRouteInfoChange: (show: boolean) => void;
  isLoading: boolean;
  error: string | null;
  layerWeights: LayerWeight[];
  onLayerWeightsChange: (weights: LayerWeight[]) => void;
  colormap: Colormap;
  onColormapChange: (c: Colormap) => void;
}

export function IsoHomeControls({
  selectedTermini,
  onTerminiChange,
  selectedMinutesIndex,
  onMinutesChange,
  showStations,
  onShowStationsChange,
  showRailLines,
  onShowRailLinesChange,
  showRouteInfo,
  onShowRouteInfoChange,
  isLoading,
  error,
  layerWeights,
  onLayerWeightsChange,
  colormap,
  onColormapChange,
}: IsoHomeControlsProps) {
  const [layerPanelOpen, setLayerPanelOpen] = useState(false);

  const updateLayer = (id: string, update: Partial<LayerWeight>) => {
    onLayerWeightsChange(
      layerWeights.map((l) => (l.id === id ? { ...l, ...update } : l)),
    );
  };

  return (
    <div className="absolute top-4 left-4 z-10 bg-white rounded-lg shadow-lg p-4 w-72 space-y-4 max-h-[90vh] overflow-y-auto">
      <h2 className="text-lg font-semibold">IsoHome</h2>

      <fieldset className="space-y-1">
        <legend className="text-sm font-medium mb-1">London Termini</legend>
        <div className="grid grid-cols-2 gap-x-2 gap-y-0.5">
          {LONDON_TERMINI.map((t) => (
            <label key={t.crs} className="flex items-center gap-1.5 text-xs cursor-pointer">
              <input
                type="checkbox"
                checked={selectedTermini.includes(t.crs)}
                onChange={(e) => onTerminiChange(t.crs, e.target.checked)}
                aria-label={t.name}
              />
              {t.name}
            </label>
          ))}
        </div>
      </fieldset>

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
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={showRouteInfo}
            onChange={(e) => onShowRouteInfoChange(e.target.checked)}
            role="switch"
            aria-label="Show route on hover"
          />
          Show route on hover
        </label>
      </div>

      <div>
        <button
          onClick={() => setLayerPanelOpen((o) => !o)}
          className="flex items-center justify-between w-full text-sm font-medium py-1"
          aria-expanded={layerPanelOpen}
        >
          Desirability layers
          <ChevronDown
            className={`h-4 w-4 transition-transform ${layerPanelOpen ? 'rotate-180' : ''}`}
          />
        </button>

        {layerPanelOpen && (
          <div className="space-y-3 mt-2">
            {layerWeights.map((layer) => (
              <div key={layer.id} className="space-y-1">
                <div className="flex items-center justify-between text-xs">
                  <label className="flex items-center gap-1.5">
                    <input
                      type="checkbox"
                      checked={layer.enabled}
                      onChange={(e) =>
                        updateLayer(layer.id, { enabled: e.target.checked })
                      }
                    />
                    {layer.label}
                  </label>
                  <span className="text-gray-500 tabular-nums">{layer.weight}</span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={10}
                  step={1}
                  value={layer.weight}
                  disabled={!layer.enabled}
                  onChange={(e) =>
                    updateLayer(layer.id, { weight: Number(e.target.value) })
                  }
                  className="w-full"
                  aria-label={`${layer.label} weight`}
                />
              </div>
            ))}

            <div className="flex items-center gap-2 text-xs">
              <span className="text-gray-600">Colormap</span>
              <select
                value={colormap}
                onChange={(e) => onColormapChange(e.target.value as Colormap)}
                className="text-xs border rounded px-1 py-0.5"
              >
                <option value="viridis">Viridis</option>
                <option value="jet">Jet</option>
              </select>
            </div>
          </div>
        )}
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
