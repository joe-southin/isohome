import type { Expression } from 'mapbox-gl';
import type { Colormap } from './types';

export const COLORMAP_EXPRESSIONS: Record<Colormap, Expression> = {
  viridis: [
    'interpolate', ['linear'], ['heatmap-density'],
    0,    'rgba(68, 1, 84, 0)',
    0.15, 'rgba(68, 1, 84, 0.6)',
    0.35, 'rgba(59, 82, 139, 0.75)',
    0.55, 'rgba(33, 145, 140, 0.8)',
    0.75, 'rgba(94, 201, 97, 0.85)',
    1.0,  'rgba(253, 231, 37, 0.9)',
  ],
  jet: [
    'interpolate', ['linear'], ['heatmap-density'],
    0,    'rgba(0, 0, 143, 0)',
    0.15, 'rgba(0, 0, 255, 0.6)',
    0.35, 'rgba(0, 255, 255, 0.75)',
    0.5,  'rgba(0, 255, 0, 0.8)',
    0.65, 'rgba(255, 255, 0, 0.85)',
    0.85, 'rgba(255, 128, 0, 0.9)',
    1.0,  'rgba(255, 0, 0, 0.95)',
  ],
};
