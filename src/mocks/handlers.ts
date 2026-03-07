import { http, HttpResponse } from 'msw';
import kgx60 from './fixtures/KGX-60.json';
import stations from './fixtures/stations.json';
import railLines from './fixtures/rail-lines.json';
import sunshine from './fixtures/sunshine.json';
import housePrices from './fixtures/house-prices.json';

const VALID_CRS = ['KGX', 'PAD', 'WAT', 'VIC', 'LST', 'BFR', 'CST', 'CHX', 'EUS', 'MYB'];
const VALID_BUCKETS = ['30', '45', '60', '75', '90', '120'];

export const handlers = [
  http.get('/api/isochrone/:crs/:minutes', ({ params }) => {
    const { crs, minutes } = params as { crs: string; minutes: string };
    if (!VALID_CRS.includes(crs) || !VALID_BUCKETS.includes(minutes)) {
      return HttpResponse.json(
        { error: 'Invalid terminus or time bucket', code: 'INVALID_PARAMS' },
        { status: 400 },
      );
    }
    return HttpResponse.json(kgx60);
  }),
  http.get('/api/static/stations', () => HttpResponse.json(stations)),
  http.get('/api/static/rail-lines', () => HttpResponse.json(railLines)),
  http.get('/api/static/sunshine', () => HttpResponse.json(sunshine)),
  http.get('/api/static/house-prices', () => HttpResponse.json(housePrices)),
];
