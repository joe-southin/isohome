export type LayerId = 'sunshine' | 'house_price';

export interface LayerWeight {
  id: LayerId;
  label: string;
  weight: number; // integer 0–10
  enabled: boolean;
  higherIsBetter: boolean; // sunshine=true, house_price=false
}

export interface CostPoint {
  lng: number;
  lat: number;
  score: number; // normalised 0–1
}

export type Colormap = 'viridis' | 'jet';
