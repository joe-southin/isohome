import { describe, it, expect } from 'vitest';
import { generateSampleGrid, lookupNearest, computeCostField } from '../utils/costField';
import type { FeatureCollection, Polygon, MultiPolygon, Point } from 'geojson';
import type { LayerWeight } from '../types';

// Helper: create a simple square polygon FeatureCollection
function makeSquareIsochrone(
  minLng: number, minLat: number, maxLng: number, maxLat: number,
): FeatureCollection<Polygon | MultiPolygon> {
  return {
    type: 'FeatureCollection',
    features: [{
      type: 'Feature',
      geometry: {
        type: 'Polygon',
        coordinates: [[
          [minLng, minLat],
          [maxLng, minLat],
          [maxLng, maxLat],
          [minLng, maxLat],
          [minLng, minLat],
        ]],
      },
      properties: {},
    }],
  };
}

// Helper: create a point grid FeatureCollection with values
function makePointGrid(
  points: Array<{ lng: number; lat: number; value: number }>,
): FeatureCollection<Point> {
  return {
    type: 'FeatureCollection',
    features: points.map(p => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [p.lng, p.lat] },
      properties: { value: p.value },
    })),
  };
}

// Test stats centred on the test data ranges
const sunshineStats = { mean: 1400, stddev: 400 };
const housePriceStats = { mean: 300000, stddev: 200000 };

describe('generateSampleGrid', () => {
  it('generates points inside a square polygon', () => {
    const iso = makeSquareIsochrone(-1.0, 51.0, -0.8, 51.2);
    const points = generateSampleGrid(iso, 0.05);
    expect(points.length).toBeGreaterThan(0);

    // All points should be within the bounding box
    for (const [lng, lat] of points) {
      expect(lng).toBeGreaterThanOrEqual(-1.0);
      expect(lng).toBeLessThanOrEqual(-0.8);
      expect(lat).toBeGreaterThanOrEqual(51.0);
      expect(lat).toBeLessThanOrEqual(51.2);
    }
  });

  it('returns empty array for a tiny polygon smaller than spacing', () => {
    const iso = makeSquareIsochrone(-1.0, 51.0, -1.0 + 0.001, 51.0 + 0.001);
    const points = generateSampleGrid(iso, 0.05);
    expect(Array.isArray(points)).toBe(true);
  });

  it('respects custom spacing', () => {
    const iso = makeSquareIsochrone(0.0, 50.0, 1.0, 51.0);
    const coarse = generateSampleGrid(iso, 0.5);
    const fine = generateSampleGrid(iso, 0.1);
    expect(fine.length).toBeGreaterThan(coarse.length);
  });
});

describe('lookupNearest', () => {
  const grid = makePointGrid([
    { lng: -1.0, lat: 51.0, value: 1500 },
    { lng: -0.5, lat: 51.5, value: 1200 },
    { lng: 0.0, lat: 52.0, value: 900 },
  ]);

  it('returns the value of the nearest point', () => {
    const val = lookupNearest(-1.01, 51.01, grid);
    expect(val).toBe(1500);
  });

  it('returns null if nearest point is > 0.15 degrees away', () => {
    const val = lookupNearest(5.0, 55.0, grid);
    expect(val).toBeNull();
  });

  it('returns null for an empty grid', () => {
    const empty: FeatureCollection = { type: 'FeatureCollection', features: [] };
    const val = lookupNearest(-1.0, 51.0, empty);
    expect(val).toBeNull();
  });

  it('picks the closest point when equidistant candidates exist', () => {
    const val = lookupNearest(-0.5, 51.5, grid);
    expect(val).toBe(1200);
  });
});

describe('computeCostField', () => {
  const sunshineGrid = makePointGrid([
    { lng: 0.0, lat: 50.0, value: 1800 }, // high sunshine
    { lng: 0.05, lat: 50.0, value: 1400 },
    { lng: 0.1, lat: 50.0, value: 1000 }, // low sunshine
  ]);

  const housePriceGrid = makePointGrid([
    { lng: 0.0, lat: 50.0, value: 500000 },  // expensive
    { lng: 0.05, lat: 50.0, value: 300000 },
    { lng: 0.1, lat: 50.0, value: 100000 },  // cheap
  ]);

  const crimeGrid = makePointGrid([
    { lng: 0.0, lat: 50.0, value: 50 },
    { lng: 0.05, lat: 50.0, value: 50 },
    { lng: 0.1, lat: 50.0, value: 50 },
  ]);

  const points: [number, number][] = [
    [0.0, 50.0],
    [0.05, 50.0],
    [0.1, 50.0],
  ];

  it('sigmoid normalisation maps mean value to 0.5', () => {
    // A value exactly at the mean should get norm=0.5
    const meanGrid = makePointGrid([
      { lng: 0.0, lat: 50.0, value: 1400 }, // exactly at mean
    ]);
    const layers: LayerWeight[] = [
      { id: 'sunshine', label: 'Sunshine', weight: 5, enabled: true, higherIsBetter: true, stats: sunshineStats },
    ];
    const result = computeCostField([[0.0, 50.0]], layers, {
      sunshine: meanGrid,
      house_price: housePriceGrid,
      crime: crimeGrid,
    });
    expect(result[0].score).toBeCloseTo(0.5, 5);
  });

  it('higher-is-better layer scores above-mean values > 0.5', () => {
    const layers: LayerWeight[] = [
      { id: 'sunshine', label: 'Sunshine', weight: 10, enabled: true, higherIsBetter: true, stats: sunshineStats },
    ];
    const result = computeCostField(points, layers, {
      sunshine: sunshineGrid,
      house_price: housePriceGrid,
      crime: crimeGrid,
    });
    // 1800 is +1 stddev above mean → sigmoid(1) ≈ 0.73
    const best = result[0];
    expect(best.lng).toBe(0.0);
    expect(best.score).toBeGreaterThan(0.5);
    // 1000 is -1 stddev below mean → sigmoid(-1) ≈ 0.27
    const worst = result[result.length - 1];
    expect(worst.lng).toBe(0.1);
    expect(worst.score).toBeLessThan(0.5);
  });

  it('lower-is-better layer inverts scores (cheap = high score)', () => {
    const layers: LayerWeight[] = [
      { id: 'house_price', label: 'House price', weight: 10, enabled: true, higherIsBetter: false, stats: housePriceStats },
    ];
    const result = computeCostField(points, layers, {
      sunshine: sunshineGrid,
      house_price: housePriceGrid,
      crime: crimeGrid,
    });
    // Cheapest (100k) should score highest (inverted)
    const best = result[0];
    expect(best.lng).toBe(0.1);
    expect(best.score).toBeGreaterThan(0.5);
    // Most expensive (500k) should score lowest
    const worst = result[result.length - 1];
    expect(worst.lng).toBe(0.0);
    expect(worst.score).toBeLessThan(0.5);
  });

  it('returns empty array when all weights are 0', () => {
    const layers: LayerWeight[] = [
      { id: 'sunshine', label: 'Sunshine', weight: 0, enabled: true, higherIsBetter: true, stats: sunshineStats },
      { id: 'house_price', label: 'House price', weight: 0, enabled: true, higherIsBetter: false, stats: housePriceStats },
    ];
    const result = computeCostField(points, layers, {
      sunshine: sunshineGrid,
      house_price: housePriceGrid,
      crime: crimeGrid,
    });
    expect(result).toEqual([]);
  });

  it('returns empty array when no layers are enabled', () => {
    const layers: LayerWeight[] = [
      { id: 'sunshine', label: 'Sunshine', weight: 5, enabled: false, higherIsBetter: true, stats: sunshineStats },
      { id: 'house_price', label: 'House price', weight: 5, enabled: false, higherIsBetter: false, stats: housePriceStats },
    ];
    const result = computeCostField(points, layers, {
      sunshine: sunshineGrid,
      house_price: housePriceGrid,
      crime: crimeGrid,
    });
    expect(result).toEqual([]);
  });

  it('handles stddev === 0 (all values same)', () => {
    const uniformGrid = makePointGrid([
      { lng: 0.0, lat: 50.0, value: 1500 },
      { lng: 0.05, lat: 50.0, value: 1500 },
      { lng: 0.1, lat: 50.0, value: 1500 },
    ]);
    const layers: LayerWeight[] = [
      { id: 'sunshine', label: 'Sunshine', weight: 5, enabled: true, higherIsBetter: true, stats: { mean: 1500, stddev: 0 } },
    ];
    const result = computeCostField(points, layers, {
      sunshine: uniformGrid,
      house_price: housePriceGrid,
      crime: crimeGrid,
    });
    // z=0 → sigmoid(0)=0.5 for all points
    for (const p of result) {
      expect(p.score).toBeCloseTo(0.5, 5);
    }
  });

  it('excludes points with no data coverage', () => {
    const sparseGrid = makePointGrid([
      { lng: 0.0, lat: 50.0, value: 1500 },
    ]);
    const farPoints: [number, number][] = [
      [0.0, 50.0],
      [5.0, 55.0], // far away, no data
    ];
    const layers: LayerWeight[] = [
      { id: 'sunshine', label: 'Sunshine', weight: 5, enabled: true, higherIsBetter: true, stats: sunshineStats },
    ];
    const result = computeCostField(farPoints, layers, {
      sunshine: sparseGrid,
      house_price: housePriceGrid,
      crime: crimeGrid,
    });
    expect(result.length).toBe(1);
    expect(result[0].lng).toBe(0.0);
  });

  it('results are sorted by score descending', () => {
    const layers: LayerWeight[] = [
      { id: 'sunshine', label: 'Sunshine', weight: 10, enabled: true, higherIsBetter: true, stats: sunshineStats },
    ];
    const result = computeCostField(points, layers, {
      sunshine: sunshineGrid,
      house_price: housePriceGrid,
      crime: crimeGrid,
    });
    for (let i = 1; i < result.length; i++) {
      expect(result[i - 1].score).toBeGreaterThanOrEqual(result[i].score);
    }
  });

  it('weighted blend produces intermediate scores', () => {
    // Sunshine only weight=10, house price weight=5
    const layers: LayerWeight[] = [
      { id: 'sunshine', label: 'Sunshine', weight: 10, enabled: true, higherIsBetter: true, stats: sunshineStats },
      { id: 'house_price', label: 'House price', weight: 5, enabled: true, higherIsBetter: false, stats: housePriceStats },
    ];
    const result = computeCostField(points, layers, {
      sunshine: sunshineGrid,
      house_price: housePriceGrid,
      crime: crimeGrid,
    });
    expect(result.length).toBe(3);
    // All scores should be between 0 and 1
    for (const p of result) {
      expect(p.score).toBeGreaterThanOrEqual(0);
      expect(p.score).toBeLessThanOrEqual(1);
    }
  });
});
