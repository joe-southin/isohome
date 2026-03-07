export interface Env {
  ISOHOME_BUCKET: R2Bucket;
}

const VALID_CRS = ['KGX', 'PAD', 'WAT', 'VIC', 'LST', 'BFR', 'CST', 'CHX', 'EUS', 'MYB', 'STP'];
const VALID_BUCKETS = ['30', '45', '60', '75', '90', '120'];

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

    return jsonResponse({ error: 'Not found' }, 404);
  },
};
