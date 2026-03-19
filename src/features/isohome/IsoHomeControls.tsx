import { useState, useEffect } from 'react';
import { ChevronDown, Loader2, HelpCircle } from 'lucide-react';
import { LONDON_TERMINI, TIME_BUCKETS } from './config';
import { formatMinutes } from './utils/formatTime';
import { Tooltip } from './Tooltip';
import { HelpModal } from './HelpModal';
import type { LayerWeight, Colormap, TransportMode, TransportModeId } from './types';

interface IsoHomeControlsProps {
  selectedTermini: string[];
  onTerminiChange: (crs: string, selected: boolean) => void;
  onSelectAll: () => void;
  onDeselectAll: () => void;
  selectedMinutesIndex: number;
  onMinutesChange: (index: number) => void;
  showStations: boolean;
  onShowStationsChange: (show: boolean) => void;
  showRailLines: boolean;
  onShowRailLinesChange: (show: boolean) => void;
  showRouteInfo: boolean;
  onShowRouteInfoChange: (show: boolean) => void;
  transportModes: TransportMode[];
  onTransportModeChange: (id: TransportModeId, enabled: boolean) => void;
  walkCap: number;
  onWalkCapChange: (cap: number) => void;
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
  onSelectAll,
  onDeselectAll,
  selectedMinutesIndex,
  onMinutesChange,
  showStations,
  onShowStationsChange,
  showRailLines,
  onShowRailLinesChange,
  showRouteInfo,
  onShowRouteInfoChange,
  transportModes,
  onTransportModeChange,
  walkCap,
  onWalkCapChange,
  isLoading,
  error,
  layerWeights,
  onLayerWeightsChange,
  colormap,
  onColormapChange,
}: IsoHomeControlsProps) {
  const [layerPanelOpen, setLayerPanelOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [walkCapRaw, setWalkCapRaw] = useState(String(walkCap));

  useEffect(() => { setWalkCapRaw(String(walkCap)); }, [walkCap]);

  const updateLayer = (id: string, update: Partial<LayerWeight>) => {
    onLayerWeightsChange(
      layerWeights.map((l) => (l.id === id ? { ...l, ...update } : l)),
    );
  };

  const allSelected = selectedTermini.length === LONDON_TERMINI.length;
  const noneSelected = selectedTermini.length === 0;

  return (
    <>
      <div className="absolute top-4 left-4 z-10 bg-white rounded-lg shadow-lg p-4 w-72 space-y-4 max-h-[90vh] overflow-y-auto">
        <h2 className="text-lg font-semibold">IsoHome</h2>

        {/* Termini */}
        <fieldset className="space-y-1">
          <div className="flex items-center justify-between mb-1">
            <div className="flex items-center gap-1">
              <legend className="text-sm font-medium">London Termini</legend>
              <Tooltip content="Choose which London stations to include. Each adds its own commute zone. Select multiple to merge them." />
            </div>
            <div className="flex gap-2 text-xs">
              <button
                type="button"
                onClick={onSelectAll}
                disabled={allSelected}
                className="text-blue-600 hover:underline disabled:text-gray-300 disabled:no-underline"
                aria-label="Select all termini"
              >
                All
              </button>
              <button
                type="button"
                onClick={onDeselectAll}
                disabled={noneSelected}
                className="text-blue-600 hover:underline disabled:text-gray-300 disabled:no-underline"
                aria-label="Deselect all termini"
              >
                None
              </button>
            </div>
          </div>
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

        {/* Time slider */}
        <div className="space-y-2">
          <div className="flex items-center gap-1">
            <label htmlFor="time-slider" className="text-sm font-medium">
              Max commute: {formatMinutes(TIME_BUCKETS[selectedMinutesIndex])}
            </label>
            <Tooltip content="Total journey time: drive (or walk) to your local station, plus the train to London." />
          </div>
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

        {/* Transport modes */}
        <div className="space-y-1.5">
          <div className="flex items-center text-sm font-medium">
            Transport modes
            <Tooltip content="Toggle how you travel to the station. Disable Car to see only areas walkable to a station. Walk and Tube coming soon." />
          </div>
          {/* 2×2 grid: Train | Car / Tube | Walk — with walk cap inline */}
          <div className="grid grid-cols-2 gap-x-2 gap-y-1">
            {(['train', 'car', 'tube', 'walk'] as const).map((modeId) => {
              const mode = transportModes.find((m) => m.id === modeId);
              if (!mode) return null;
              const isWalk = mode.id === 'walk';
              return (
                <div key={mode.id} className="flex items-center gap-1">
                  <label
                    className={`flex items-center gap-1.5 text-xs ${mode.available ? 'cursor-pointer' : 'cursor-not-allowed text-gray-400'}`}
                  >
                    <input
                      type="checkbox"
                      checked={mode.enabled}
                      disabled={!mode.available || mode.id === 'train'}
                      onChange={(e) => onTransportModeChange(mode.id, e.target.checked)}
                      aria-label={`${mode.label} mode`}
                    />
                    {mode.label}
                  </label>
                  {isWalk && mode.enabled && (
                    <div className="flex items-center gap-0.5 ml-1">
                      <input
                        type="number"
                        min={1}
                        max={60}
                        value={walkCapRaw}
                        onChange={(e) => {
                          setWalkCapRaw(e.target.value);
                          const v = parseInt(e.target.value, 10);
                          if (!isNaN(v) && v >= 1 && v <= 60) onWalkCapChange(v);
                        }}
                        onBlur={() => {
                          const v = parseInt(walkCapRaw, 10);
                          if (isNaN(v) || v < 1) { setWalkCapRaw('1'); onWalkCapChange(1); }
                          else if (v > 60) { setWalkCapRaw('60'); onWalkCapChange(60); }
                        }}
                        className="w-10 text-xs border rounded px-1 py-0.5 text-center"
                        aria-label="Max walk minutes"
                      />
                      <span className="text-[10px] text-gray-500">min</span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Map layers */}
        <div className="space-y-2">
          <div className="text-sm font-medium flex items-center">
            Map layers
            <Tooltip content="Toggle additional map overlays. Hover over the commute zone to see drive and train routes." />
          </div>
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

        {/* Desirability layers */}
        <div>
          <button
            onClick={() => setLayerPanelOpen((o) => !o)}
            className="flex items-center justify-between w-full text-sm font-medium py-1"
            aria-expanded={layerPanelOpen}
          >
            <span className="flex items-center">
              Desirability layers
              <Tooltip content="Score locations by sunshine, house price and crime, weighted by your preferences. Shown as a heatmap within the commute zone." />
            </span>
            <ChevronDown
              className={`h-4 w-4 transition-transform ${layerPanelOpen ? 'rotate-180' : ''}`}
            />
          </button>

          {layerPanelOpen && (
            <div className="space-y-1.5 mt-2">
              {layerWeights.map((layer) => (
                <div key={layer.id} className="flex items-center gap-1.5 text-xs">
                  <input
                    type="checkbox"
                    checked={layer.enabled}
                    onChange={(e) =>
                      updateLayer(layer.id, { enabled: e.target.checked })
                    }
                    aria-label={`Enable ${layer.label}`}
                    className="shrink-0"
                  />
                  <span className="w-20 shrink-0 truncate">{layer.label}</span>
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
                    className="flex-1 min-w-0"
                    aria-label={`${layer.label} weight`}
                  />
                  <span className="w-4 text-right text-gray-500 tabular-nums shrink-0">
                    {layer.weight}
                  </span>
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

        {/* Status */}
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

        {/* How it works */}
        <button
          type="button"
          onClick={() => setHelpOpen(true)}
          className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-700 w-full pt-1 border-t border-gray-100"
        >
          <HelpCircle className="h-3.5 w-3.5" />
          How it works
        </button>
      </div>

      {helpOpen && <HelpModal onClose={() => setHelpOpen(false)} />}
    </>
  );
}
