import { describe, it, expect } from 'vitest';
import type { GeoJSON } from 'geojson';
import { isPointInRing, isPointInFC, findNearestStation } from '../IsoHomeMap';

// Realistic isochrone data with both polygon and station features,
// matching the enriched format from R2.
const enrichedIsochrone: GeoJSON = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      geometry: {
        type: 'Polygon',
        coordinates: [[[-1.0, 51.3], [0.5, 51.3], [0.5, 52.5], [-1.0, 52.5], [-1.0, 51.3]]],
      },
      properties: {
        terminus_crs: 'KGX',
        terminus_name: "King's Cross",
        time_budget_minutes: 60,
      },
    },
    {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [-0.261, 51.948] },
      properties: {
        feature_type: 'station',
        crs: 'HIT',
        name: 'Hitchin',
        journey_minutes: 27,
        drive_budget: 33,
        terminus_crs: 'KGX',
        terminus_name: "King's Cross",
        terminus_lon: -0.124,
        terminus_lat: 51.53,
        time_budget: 60,
        rail_route: [[-0.261, 51.948], [-0.124, 51.53]],
      },
    },
    {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [-0.48, 52.136] },
      properties: {
        feature_type: 'station',
        crs: 'BDM',
        name: 'Bedford',
        journey_minutes: 39,
        drive_budget: 21,
        terminus_crs: 'KGX',
        terminus_name: "King's Cross",
        terminus_lon: -0.124,
        terminus_lat: 51.53,
        time_budget: 60,
        rail_route: [[-0.48, 52.136], [-0.261, 51.948], [-0.124, 51.53]],
      },
    },
  ],
};

// Un-enriched isochrone data — polygon only, no station features.
// This is the broken state that caused the route hover regression.
const unenrichedIsochrone: GeoJSON = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      geometry: {
        type: 'Polygon',
        coordinates: [[[-1.0, 51.3], [0.5, 51.3], [0.5, 52.5], [-1.0, 52.5], [-1.0, 51.3]]],
      },
      properties: {
        terminus_crs: 'KGX',
        terminus_name: "King's Cross",
        time_budget_minutes: 60,
      },
    },
  ],
};

describe('isPointInRing', () => {
  const square = [[-1, 51], [1, 51], [1, 53], [-1, 53], [-1, 51]];

  it('returns true for a point inside the ring', () => {
    expect(isPointInRing(0, 52, square)).toBe(true);
  });

  it('returns false for a point outside the ring', () => {
    expect(isPointInRing(5, 52, square)).toBe(false);
  });

  it('returns false for a point clearly south of the ring', () => {
    expect(isPointInRing(0, 50, square)).toBe(false);
  });
});

describe('isPointInFC', () => {
  it('returns true for a point inside the isochrone polygon', () => {
    expect(isPointInFC(-0.3, 52.0, enrichedIsochrone)).toBe(true);
  });

  it('returns false for a point outside the isochrone polygon', () => {
    expect(isPointInFC(5, 55, enrichedIsochrone)).toBe(false);
  });

  it('returns false for undefined data', () => {
    expect(isPointInFC(-0.3, 52.0, undefined)).toBe(false);
  });

  it('ignores Point features (stations) — only checks polygons', () => {
    // A FeatureCollection with only station points, no polygons
    const stationsOnly: GeoJSON = {
      type: 'FeatureCollection',
      features: [{
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [0, 52] },
        properties: { feature_type: 'station' },
      }],
    };
    expect(isPointInFC(0, 52, stationsOnly)).toBe(false);
  });

  it('works with un-enriched isochrone data', () => {
    expect(isPointInFC(-0.3, 52.0, unenrichedIsochrone)).toBe(true);
  });
});

describe('findNearestStation', () => {
  it('finds the nearest station in enriched isochrone data', () => {
    // Point near Hitchin (-0.261, 51.948)
    const result = findNearestStation(-0.25, 51.95, enrichedIsochrone);
    expect(result).not.toBeNull();
    expect(result!.crs).toBe('HIT');
    expect(result!.name).toBe('Hitchin');
    expect(result!.journey_minutes).toBe(27);
    expect(result!.terminus_crs).toBe('KGX');
    expect(result!.terminus_lon).toBe(-0.124);
    expect(result!.terminus_lat).toBe(51.53);
    expect(result!.rail_route).toEqual([[-0.261, 51.948], [-0.124, 51.53]]);
  });

  it('returns null when isochrone data has no station features (regression)', () => {
    // This is the exact scenario that caused the route hover bug:
    // the isochrone polygon is present but station features are missing.
    const result = findNearestStation(-0.3, 52.0, unenrichedIsochrone);
    expect(result).toBeNull();
  });

  it('returns null for undefined data', () => {
    expect(findNearestStation(0, 52, undefined)).toBeNull();
  });

  it('selects station with lowest total commute cost, not nearest distance', () => {
    // Point equidistant between Hitchin and Bedford
    // Hitchin: journey=27min, Bedford: journey=39min
    // Hitchin should win because lower journey time offsets similar distance
    const midLng = (-0.261 + -0.48) / 2;
    const midLat = (51.948 + 52.136) / 2;
    const result = findNearestStation(midLng, midLat, enrichedIsochrone);
    expect(result).not.toBeNull();
    expect(result!.crs).toBe('HIT');
  });

  it('respects maxBudget filter', () => {
    // Bedford has drive_budget=21, Hitchin has drive_budget=33
    // With maxBudget=25, only Bedford qualifies
    const result = findNearestStation(-0.3, 52.0, enrichedIsochrone, 25);
    expect(result).not.toBeNull();
    expect(result!.crs).toBe('BDM');
  });

  it('returns null if all stations exceed maxBudget', () => {
    const result = findNearestStation(-0.3, 52.0, enrichedIsochrone, 5);
    expect(result).toBeNull();
  });

  it('handles missing rail_route gracefully', () => {
    const noRailRoute: GeoJSON = {
      type: 'FeatureCollection',
      features: [{
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [-0.261, 51.948] },
        properties: {
          feature_type: 'station',
          crs: 'HIT',
          name: 'Hitchin',
          journey_minutes: 27,
          drive_budget: 33,
          terminus_crs: 'KGX',
          terminus_name: "King's Cross",
          terminus_lon: -0.124,
          terminus_lat: 51.53,
          time_budget: 60,
        },
      }],
    };
    const result = findNearestStation(-0.25, 51.95, noRailRoute);
    expect(result).not.toBeNull();
    expect(result!.rail_route).toBeNull();
  });

  it('works with multi-terminus merged data', () => {
    // Simulate merged data from multiple termini
    const merged: GeoJSON = {
      type: 'FeatureCollection',
      features: [
        ...enrichedIsochrone.type === 'FeatureCollection' ? enrichedIsochrone.features : [],
        {
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [-0.972, 51.459] },
          properties: {
            feature_type: 'station',
            crs: 'RDG',
            name: 'Reading',
            journey_minutes: 25,
            drive_budget: 35,
            terminus_crs: 'PAD',
            terminus_name: 'Paddington',
            terminus_lon: -0.176,
            terminus_lat: 51.516,
            time_budget: 60,
          },
        },
      ],
    };
    // Point near Reading should find Reading (PAD terminus)
    const result = findNearestStation(-0.97, 51.46, merged);
    expect(result).not.toBeNull();
    expect(result!.crs).toBe('RDG');
    expect(result!.terminus_crs).toBe('PAD');
  });
});
