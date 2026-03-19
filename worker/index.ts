export interface Env {
  ISOHOME_BUCKET: R2Bucket;
  ASSETS: { fetch: (request: Request) => Promise<Response> };
}

const VALID_CRS = ['KGX', 'PAD', 'WAT', 'VIC', 'LST', 'BFR', 'CST', 'CHX', 'EUS', 'MYB', 'STP'];
const VALID_BUCKETS = ['30', '45', '60', '75', '90', '120'];
const VALID_WALK_BUCKETS = VALID_BUCKETS; // same time buckets, walk profile

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};

function jsonResponse(data: unknown, status = 200, extraHeaders: Record<string, string> = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...CORS_HEADERS,
      ...extraHeaders,
    },
  });
}

function geoJsonResponse(body: ReadableStream | ArrayBuffer | string | null, extraHeaders: Record<string, string> = {}) {
  return new Response(body, {
    headers: {
      'Content-Type': 'application/geo+json',
      'Cache-Control': 'public, max-age=86400',
      ...CORS_HEADERS,
      ...extraHeaders,
    },
  });
}

async function handleIsochrone(crs: string, minutes: string, env: Env): Promise<Response> {
  if (!VALID_CRS.includes(crs) || !VALID_BUCKETS.includes(minutes)) {
    return jsonResponse(
      { error: 'Invalid terminus or time bucket', code: 'INVALID_PARAMS' },
      400,
    );
  }

  const obj = await env.ISOHOME_BUCKET.get(`isochrones/${crs}/${minutes}.geojson`);
  if (!obj) {
    return jsonResponse(
      { error: 'Isochrone not available for this combination', code: 'NOT_FOUND' },
      404,
    );
  }

  return geoJsonResponse(obj.body);
}

async function handleStatic(key: string, env: Env): Promise<Response> {
  const obj = await env.ISOHOME_BUCKET.get(`static/${key}.geojson`);
  if (!obj) {
    return jsonResponse({ error: 'Resource not found', code: 'NOT_FOUND' }, 404);
  }
  return geoJsonResponse(obj.body);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS_HEADERS });
    }

    // GET /api/isochrone/walk/:crs/:minutes  (must be matched before the generic route)
    const walkIsoMatch = url.pathname.match(/^\/api\/isochrone\/walk\/([A-Z]+)\/(\d+)$/);
    if (walkIsoMatch) {
      const [, crs, minutes] = walkIsoMatch;
      if (!VALID_CRS.includes(crs) || !VALID_WALK_BUCKETS.includes(minutes)) {
        return jsonResponse({ error: 'Invalid terminus or time bucket', code: 'INVALID_PARAMS' }, 400);
      }
      const obj = await env.ISOHOME_BUCKET.get(`isochrones/walk/${crs}/${minutes}.geojson`);
      if (!obj) return jsonResponse({ error: 'Walk isochrone not yet available', code: 'NOT_FOUND' }, 404);
      return geoJsonResponse(obj.body);
    }

    // GET /api/isochrone/:crs/:minutes
    const isoMatch = url.pathname.match(/^\/api\/isochrone\/([A-Z]+)\/(\d+)$/);
    if (isoMatch) {
      return handleIsochrone(isoMatch[1], isoMatch[2], env);
    }

    // GET /api/static/stations
    if (url.pathname === '/api/static/stations') {
      return handleStatic('stations', env);
    }

    // GET /api/static/rail-lines
    if (url.pathname === '/api/static/rail-lines') {
      return handleStatic('rail-lines', env);
    }

    // GET /api/static/sunshine
    if (url.pathname === '/api/static/sunshine') {
      return handleStatic('sunshine', env);
    }

    // GET /api/static/house-prices
    if (url.pathname === '/api/static/house-prices') {
      return handleStatic('house-prices', env);
    }

    // GET /api/static/crime
    if (url.pathname === '/api/static/crime') {
      return handleStatic('crime', env);
    }

    // Non-API routes: let the assets binding handle it (serves index.html for SPA)
    return env.ASSETS.fetch(request);
  },
};
