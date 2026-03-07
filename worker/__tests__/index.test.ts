import { describe, it, expect, vi } from 'vitest';
import worker from '../index';
import type { Env } from '../index';

function mockEnv(getResult: unknown = null): Env {
  return {
    ISOHOME_BUCKET: {
      get: vi.fn().mockResolvedValue(getResult),
    } as unknown as R2Bucket,
  };
}

function mockR2Object(body: string) {
  return {
    body: new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(body));
        controller.close();
      },
    }),
  };
}

function makeRequest(path: string, method = 'GET') {
  return new Request(`http://localhost${path}`, { method });
}

describe('Worker API', () => {
  describe('GET /api/isochrone/:crs/:minutes', () => {
    it('returns 200 with GeoJSON for valid params', async () => {
      const geojson = JSON.stringify({ type: 'FeatureCollection', features: [] });
      const env = mockEnv(mockR2Object(geojson));

      const res = await worker.fetch(makeRequest('/api/isochrone/KGX/60'), env);
      expect(res.status).toBe(200);
      expect(res.headers.get('Content-Type')).toBe('application/geo+json');
      expect(res.headers.get('Cache-Control')).toBe('public, max-age=86400');
    });

    it('returns 400 for invalid CRS', async () => {
      const env = mockEnv();
      const res = await worker.fetch(makeRequest('/api/isochrone/ZZZ/60'), env);
      expect(res.status).toBe(400);
      const body = await res.json() as { code: string };
      expect(body.code).toBe('INVALID_PARAMS');
    });

    it('returns 400 for invalid time bucket', async () => {
      const env = mockEnv();
      const res = await worker.fetch(makeRequest('/api/isochrone/KGX/42'), env);
      expect(res.status).toBe(400);
    });

    it('returns 404 when R2 object not found', async () => {
      const env = mockEnv(null);
      const res = await worker.fetch(makeRequest('/api/isochrone/KGX/60'), env);
      expect(res.status).toBe(404);
      const body = await res.json() as { code: string };
      expect(body.code).toBe('NOT_FOUND');
    });

    it('validates all 10 valid CRS codes', async () => {
      const validCodes = ['KGX', 'PAD', 'WAT', 'VIC', 'LST', 'BFR', 'CST', 'CHX', 'EUS', 'MYB'];
      for (const crs of validCodes) {
        const env = mockEnv(mockR2Object('{}'));
        const res = await worker.fetch(makeRequest(`/api/isochrone/${crs}/60`), env);
        expect(res.status).toBe(200);
      }
    });

    it('validates all 6 valid time buckets', async () => {
      const validBuckets = ['30', '45', '60', '75', '90', '120'];
      for (const minutes of validBuckets) {
        const env = mockEnv(mockR2Object('{}'));
        const res = await worker.fetch(makeRequest(`/api/isochrone/KGX/${minutes}`), env);
        expect(res.status).toBe(200);
      }
    });

    it('reads correct R2 key', async () => {
      const env = mockEnv(mockR2Object('{}'));
      await worker.fetch(makeRequest('/api/isochrone/KGX/60'), env);
      expect(env.ISOHOME_BUCKET.get).toHaveBeenCalledWith('isochrones/KGX/60.geojson');
    });
  });

  describe('GET /api/static/stations', () => {
    it('returns 200 with GeoJSON', async () => {
      const env = mockEnv(mockR2Object('{"type":"FeatureCollection"}'));
      const res = await worker.fetch(makeRequest('/api/static/stations'), env);
      expect(res.status).toBe(200);
      expect(res.headers.get('Content-Type')).toBe('application/geo+json');
    });

    it('reads correct R2 key', async () => {
      const env = mockEnv(mockR2Object('{}'));
      await worker.fetch(makeRequest('/api/static/stations'), env);
      expect(env.ISOHOME_BUCKET.get).toHaveBeenCalledWith('static/stations.geojson');
    });

    it('returns 404 when not found', async () => {
      const env = mockEnv(null);
      const res = await worker.fetch(makeRequest('/api/static/stations'), env);
      expect(res.status).toBe(404);
    });
  });

  describe('GET /api/static/rail-lines', () => {
    it('returns 200 with GeoJSON', async () => {
      const env = mockEnv(mockR2Object('{"type":"FeatureCollection"}'));
      const res = await worker.fetch(makeRequest('/api/static/rail-lines'), env);
      expect(res.status).toBe(200);
      expect(res.headers.get('Content-Type')).toBe('application/geo+json');
    });

    it('reads correct R2 key', async () => {
      const env = mockEnv(mockR2Object('{}'));
      await worker.fetch(makeRequest('/api/static/rail-lines'), env);
      expect(env.ISOHOME_BUCKET.get).toHaveBeenCalledWith('static/rail-lines.geojson');
    });
  });

  describe('OPTIONS (CORS)', () => {
    it('returns CORS headers', async () => {
      const env = mockEnv();
      const res = await worker.fetch(makeRequest('/api/isochrone/KGX/60', 'OPTIONS'), env);
      expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
    });
  });

  describe('Unknown routes', () => {
    it('returns 404 for unknown paths', async () => {
      const env = mockEnv();
      const res = await worker.fetch(makeRequest('/api/unknown'), env);
      expect(res.status).toBe(404);
    });
  });
});
