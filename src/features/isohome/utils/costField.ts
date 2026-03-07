import booleanPointInPolygon from '@turf/boolean-point-in-polygon';
import bbox from '@turf/bbox';
import { point } from '@turf/helpers';
import type { FeatureCollection, Polygon, MultiPolygon } from 'geojson';
import type { LayerWeight, LayerId, CostPoint } from '../types';

/**
 * Returns [lng, lat] pairs on a 0.05° grid clipped to the isochrone polygon.
 * 0.05° ≈ 5 km at UK latitudes.
 */
export function generateSampleGrid(
  isochrone: FeatureCollection<Polygon | MultiPolygon>,
  spacingDeg = 0.05,
): [number, number][] {
  const [minLng, minLat, maxLng, maxLat] = bbox(isochrone);
  const points: [number, number][] = [];

  for (let lng = minLng; lng <= maxLng; lng += spacingDeg) {
    for (let lat = minLat; lat <= maxLat; lat += spacingDeg) {
      const pt = point([lng, lat]);
      for (const feature of isochrone.features) {
        if (booleanPointInPolygon(pt, feature)) {
          points.push([lng, lat]);
          break;
        }
      }
    }
  }

  return points;
}

/**
 * Returns the value of the nearest point feature in `grid` to [lng, lat].
 * Uses squared Euclidean distance (fast, good enough at 5 km resolution).
 * Returns null if grid is empty or nearest point > 0.15° away.
 */
export function lookupNearest(
  lng: number,
  lat: number,
  grid: FeatureCollection,
): number | null {
  let bestVal: number | null = null;
  let bestDist = Infinity;
  const maxDist = 0.15 * 0.15; // squared threshold

  for (const feature of grid.features) {
    if (feature.geometry.type !== 'Point') continue;
    const [fLng, fLat] = feature.geometry.coordinates;
    const dx = lng - fLng;
    const dy = lat - fLat;
    const dist = dx * dx + dy * dy;
    if (dist < bestDist) {
      bestDist = dist;
      bestVal = (feature.properties as { value: number }).value;
    }
  }

  if (bestDist > maxDist) return null;
  return bestVal;
}

/**
 * Given sample points inside the isochrone, layer data, and weights,
 * returns a CostPoint[] with normalised scores (0–1).
 * Points where any enabled layer has no data are excluded.
 */
export function computeCostField(
  points: [number, number][],
  layers: LayerWeight[],
  dataByLayer: Record<LayerId, FeatureCollection>,
): CostPoint[] {
  const activeLayers = layers.filter(l => l.enabled && l.weight > 0);
  if (activeLayers.length === 0) return [];

  // Look up raw values for each layer at each point
  const rawValues: Map<string, Map<LayerId, number>> = new Map();
  const layerValues: Map<LayerId, number[]> = new Map();

  for (const layer of activeLayers) {
    layerValues.set(layer.id, []);
  }

  for (const [lng, lat] of points) {
    const key = `${lng},${lat}`;
    const vals = new Map<LayerId, number>();
    let valid = true;

    for (const layer of activeLayers) {
      const val = lookupNearest(lng, lat, dataByLayer[layer.id]);
      if (val === null) { valid = false; break; }
      vals.set(layer.id, val);
    }

    if (valid) {
      rawValues.set(key, vals);
      for (const layer of activeLayers) {
        layerValues.get(layer.id)!.push(vals.get(layer.id)!);
      }
    }
  }

  // Compute min/max per layer
  const layerMinMax = new Map<LayerId, { min: number; max: number }>();
  for (const layer of activeLayers) {
    const values = layerValues.get(layer.id)!;
    if (values.length === 0) return [];
    const min = Math.min(...values);
    const max = Math.max(...values);
    layerMinMax.set(layer.id, { min, max });
  }

  // Compute scores
  const totalWeight = activeLayers.reduce((sum, l) => sum + l.weight, 0);
  const results: CostPoint[] = [];

  for (const [lng, lat] of points) {
    const key = `${lng},${lat}`;
    const vals = rawValues.get(key);
    if (!vals) continue;

    let score = 0;
    for (const layer of activeLayers) {
      const { min, max } = layerMinMax.get(layer.id)!;
      const raw = vals.get(layer.id)!;
      let norm = min === max ? 0.5 : (raw - min) / (max - min);
      if (!layer.higherIsBetter) norm = 1 - norm;
      score += norm * layer.weight;
    }
    score /= totalWeight;

    results.push({ lng, lat, score });
  }

  results.sort((a, b) => b.score - a.score);
  return results;
}
