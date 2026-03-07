import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import type { GeoJSON } from 'geojson';

let loadCallback: (() => void) | null = null;
const mockMapInstance = {
  on: vi.fn((event: string, cb: () => void) => {
    if (event === 'load') loadCallback = cb;
  }),
  off: vi.fn(),
  remove: vi.fn(),
  addSource: vi.fn(),
  addLayer: vi.fn(),
  getSource: vi.fn(() => undefined),
  getLayer: vi.fn(() => undefined),
  setLayoutProperty: vi.fn(),
  addControl: vi.fn(),
  queryRenderedFeatures: vi.fn(() => []),
  getCanvas: vi.fn(() => ({ style: {} })),
};

vi.mock('mapbox-gl', () => ({
  default: {
    Map: function (opts: Record<string, unknown>) {
      Object.assign(mockMapInstance, { _opts: opts });
      return mockMapInstance;
    },
    NavigationControl: function () {
      return {};
    },
    Popup: function () {
      return { setLngLat: vi.fn().mockReturnThis(), setHTML: vi.fn().mockReturnThis(), addTo: vi.fn().mockReturnThis(), remove: vi.fn() };
    },
  },
}));

import { IsoHomeMap } from '../IsoHomeMap';

const sampleIsochrone: GeoJSON = {
  type: 'FeatureCollection',
  features: [{
    type: 'Feature',
    geometry: { type: 'Polygon', coordinates: [[[-1, 51], [0, 51], [0, 52], [-1, 52], [-1, 51]]] },
    properties: {},
  }],
};

const sampleStations: GeoJSON = {
  type: 'FeatureCollection',
  features: [{
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [-0.48, 52.14] },
    properties: { crs: 'BDM', name: 'Bedford' },
  }],
};

const sampleRailLines: GeoJSON = {
  type: 'FeatureCollection',
  features: [{
    type: 'Feature',
    geometry: { type: 'LineString', coordinates: [[-0.13, 51.53], [-0.48, 52.14]] },
    properties: { name: 'Test Line' },
  }],
};

describe('IsoHomeMap', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    loadCallback = null;
    mockMapInstance.getSource.mockReturnValue(undefined);
    mockMapInstance.getLayer.mockReturnValue(undefined);
  });

  it('renders the map container', () => {
    render(
      <IsoHomeMap
        isochroneData={undefined}
        stationsData={undefined}
        railLinesData={undefined}
        showStations={false}
        showRailLines={false}
        showRouteInfo={false}
        isLoading={false}
      />,
    );
    expect(screen.getByTestId('map-container')).toBeInTheDocument();
  });

  it('creates a map with correct options', () => {
    render(
      <IsoHomeMap
        isochroneData={undefined}
        stationsData={undefined}
        railLinesData={undefined}
        showStations={false}
        showRailLines={false}
        showRouteInfo={false}
        isLoading={false}
      />,
    );
    expect((mockMapInstance as any)._opts.center).toEqual([-2.5, 54.0]);
    expect((mockMapInstance as any)._opts.zoom).toBe(5.5);
    expect((mockMapInstance as any)._opts.style).toBe('mapbox://styles/mapbox/light-v11');
  });

  it('sets opacity to 0.5 when loading', () => {
    render(
      <IsoHomeMap
        isochroneData={undefined}
        stationsData={undefined}
        railLinesData={undefined}
        showStations={false}
        showRailLines={false}
        showRouteInfo={false}
        isLoading={true}
      />,
    );
    expect(screen.getByTestId('map-container').style.opacity).toBe('0.5');
  });

  it('sets opacity to 1 when not loading', () => {
    render(
      <IsoHomeMap
        isochroneData={undefined}
        stationsData={undefined}
        railLinesData={undefined}
        showStations={false}
        showRailLines={false}
        showRouteInfo={false}
        isLoading={false}
      />,
    );
    expect(screen.getByTestId('map-container').style.opacity).toBe('1');
  });

  it('adds isochrone source and layers after map load', () => {
    render(
      <IsoHomeMap
        isochroneData={sampleIsochrone}
        stationsData={undefined}
        railLinesData={undefined}
        showStations={false}
        showRailLines={false}
        showRouteInfo={false}
        isLoading={false}
      />,
    );
    act(() => { loadCallback?.(); });
    expect(mockMapInstance.addSource).toHaveBeenCalledWith('isochrone-source', expect.objectContaining({ type: 'geojson' }));
    expect(mockMapInstance.addLayer).toHaveBeenCalledWith(expect.objectContaining({ id: 'isochrone-fill' }));
    expect(mockMapInstance.addLayer).toHaveBeenCalledWith(expect.objectContaining({ id: 'isochrone-outline' }));
  });

  it('adds stations source and layer when showStations is true', () => {
    render(
      <IsoHomeMap
        isochroneData={undefined}
        stationsData={sampleStations}
        railLinesData={undefined}
        showStations={true}
        showRailLines={false}
        showRouteInfo={false}
        isLoading={false}
      />,
    );
    act(() => { loadCallback?.(); });
    expect(mockMapInstance.addSource).toHaveBeenCalledWith('stations-source', expect.objectContaining({ type: 'geojson' }));
    expect(mockMapInstance.setLayoutProperty).toHaveBeenCalledWith('stations-layer', 'visibility', 'visible');
  });

  it('hides stations when showStations is false', () => {
    mockMapInstance.getSource.mockImplementation((name: string) =>
      name === 'stations-source' ? { setData: vi.fn() } : undefined
    );
    render(
      <IsoHomeMap
        isochroneData={undefined}
        stationsData={sampleStations}
        railLinesData={undefined}
        showStations={false}
        showRailLines={false}
        showRouteInfo={false}
        isLoading={false}
      />,
    );
    act(() => { loadCallback?.(); });
    expect(mockMapInstance.setLayoutProperty).toHaveBeenCalledWith('stations-layer', 'visibility', 'none');
  });

  it('adds rail lines source and layer when showRailLines is true', () => {
    render(
      <IsoHomeMap
        isochroneData={undefined}
        stationsData={undefined}
        railLinesData={sampleRailLines}
        showStations={false}
        showRailLines={true}
        showRouteInfo={false}
        isLoading={false}
      />,
    );
    act(() => { loadCallback?.(); });
    expect(mockMapInstance.addSource).toHaveBeenCalledWith('rail-lines-source', expect.objectContaining({ type: 'geojson' }));
    expect(mockMapInstance.setLayoutProperty).toHaveBeenCalledWith('rail-lines-layer', 'visibility', 'visible');
  });

  it('updates isochrone source data when source already exists', () => {
    const mockSetData = vi.fn();
    mockMapInstance.getSource.mockImplementation((name: string) =>
      name === 'isochrone-source' ? { setData: mockSetData } : undefined
    );
    render(
      <IsoHomeMap
        isochroneData={sampleIsochrone}
        stationsData={undefined}
        railLinesData={undefined}
        showStations={false}
        showRailLines={false}
        showRouteInfo={false}
        isLoading={false}
      />,
    );
    act(() => { loadCallback?.(); });
    expect(mockSetData).toHaveBeenCalledWith(sampleIsochrone);
  });

  it('calls map.remove on unmount', () => {
    const { unmount } = render(
      <IsoHomeMap
        isochroneData={undefined}
        stationsData={undefined}
        railLinesData={undefined}
        showStations={false}
        showRailLines={false}
        showRouteInfo={false}
        isLoading={false}
      />,
    );
    unmount();
    expect(mockMapInstance.remove).toHaveBeenCalled();
  });
});
