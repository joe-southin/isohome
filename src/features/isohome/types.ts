export type LayerId = 'sunshine' | 'house_price' | 'crime';

export interface LayerStats {
  mean: number;
  stddev: number;
}

export interface LayerWeight {
  id: LayerId;
  label: string;
  weight: number; // integer 0–10
  enabled: boolean;
  higherIsBetter: boolean; // sunshine=true, house_price=false
  stats: LayerStats; // population mean/stddev for standard scaling
}

export interface CostPoint {
  lng: number;
  lat: number;
  score: number; // normalised 0–1
}

export type Colormap = 'viridis' | 'jet';
