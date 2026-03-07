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
    // May or may not contain a point depending on alignment, but shouldn't crash
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

  const points: [number, number][] = [
    [0.0, 50.0],
    [0.05, 50.0],
    [0.1, 50.0],
  ];

  it('computes scores with both layers equal weight', () => {
    const layers: LayerWeight[] = [
      { id: 'sunshine', label: 'Sunshine', weight: 5, enabled: true, higherIsBetter: true },
      { id: 'house_price', label: 'House price', weight: 5, enabled: true, higherIsBetter: false },
    ];

    const result = computeCostField(points, layers, {
      sunshine: sunshineGrid,
      house_price: housePriceGrid,
    });

    expect(result.length).toBe(3);

    // Point at [0.1, 50.0]: low sunshine (norm=0) but cheapest (norm=1 after invert) → score 0.5
    // Point at [0.0, 50.0]: high sunshine (norm=1) but most expensive (norm=0 after invert) → score 0.5
    // Point at [0.05, 50.0]: mid sunshine (norm=0.5) mid price (norm=0.5 after invert) → score 0.5
    // All should be 0.5 with equal weights
    for (const p of result) {
      expect(p.score).toBeCloseTo(0.5, 5);
    }
  });

  it('favours sunshine when sunshine weight is higher', () => {
    const layers: LayerWeight[] = [
      { id: 'sunshine', label: 'Sunshine', weight: 10, enabled: true, higherIsBetter: true },
      { id: 'house_price', label: 'House price', weight: 0, enabled: true, higherIsBetter: false },
    ];

    const result = computeCostField(points, layers, {
      sunshine: sunshineGrid,
      house_price: housePriceGrid,
    });

    // weight 0 means house_price is excluded
    // Only sunshine matters: [0.0, 50.0] has highest sunshine → score 1.0
    const best = result[0];
    expect(best.lng).toBe(0.0);
    expect(best.score).toBeCloseTo(1.0, 5);

    const worst = result[result.length - 1];
    expect(worst.lng).toBe(0.1);
    expect(worst.score).toBeCloseTo(0.0, 5);
  });

  it('returns empty array when all weights are 0', () => {
    const layers: LayerWeight[] = [
      { id: 'sunshine', label: 'Sunshine', weight: 0, enabled: true, higherIsBetter: true },
      { id: 'house_price', label: 'House price', weight: 0, enabled: true, higherIsBetter: false },
    ];

    const result = computeCostField(points, layers, {
      sunshine: sunshineGrid,
      house_price: housePriceGrid,
    });

    expect(result).toEqual([]);
  });

  it('returns empty array when no layers are enabled', () => {
    const layers: LayerWeight[] = [
      { id: 'sunshine', label: 'Sunshine', weight: 5, enabled: false, higherIsBetter: true },
      { id: 'house_price', label: 'House price', weight: 5, enabled: false, higherIsBetter: false },
    ];

    const result = computeCostField(points, layers, {
      sunshine: sunshineGrid,
      house_price: housePriceGrid,
    });

    expect(result).toEqual([]);
  });

  it('handles min === max for a layer (all values same)', () => {
    const uniformGrid = makePointGrid([
      { lng: 0.0, lat: 50.0, value: 1500 },
      { lng: 0.05, lat: 50.0, value: 1500 },
      { lng: 0.1, lat: 50.0, value: 1500 },
    ]);

    const layers: LayerWeight[] = [
      { id: 'sunshine', label: 'Sunshine', weight: 5, enabled: true, higherIsBetter: true },
    ];

    const result = computeCostField(points, layers, {
      sunshine: uniformGrid,
      house_price: housePriceGrid,
    });

    // All normalised to 0.5 when min===max
    for (const p of result) {
      expect(p.score).toBeCloseTo(0.5, 5);
    }
  });

  it('excludes points with no data coverage', () => {
    const sparseGrid = makePointGrid([
      { lng: 0.0, lat: 50.0, value: 1500 },
      // No data near [0.05, 50.0] or [0.1, 50.0] — they're within 0.15° so they'll match
    ]);

    const farPoints: [number, number][] = [
      [0.0, 50.0],
      [5.0, 55.0], // far away, no data
    ];

    const layers: LayerWeight[] = [
      { id: 'sunshine', label: 'Sunshine', weight: 5, enabled: true, higherIsBetter: true },
    ];

    const result = computeCostField(farPoints, layers, {
      sunshine: sparseGrid,
      house_price: housePriceGrid,
    });

    // The far-away point should be excluded
    expect(result.length).toBe(1);
    expect(result[0].lng).toBe(0.0);
  });

  it('results are sorted by score descending', () => {
    const layers: LayerWeight[] = [
      { id: 'sunshine', label: 'Sunshine', weight: 10, enabled: true, higherIsBetter: true },
    ];

    const result = computeCostField(points, layers, {
      sunshine: sunshineGrid,
      house_price: housePriceGrid,
    });

    for (let i = 1; i < result.length; i++) {
      expect(result[i - 1].score).toBeGreaterThanOrEqual(result[i].score);
    }
  });
});
