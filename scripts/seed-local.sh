#!/bin/bash
wrangler r2 object put isohome/isochrones/KGX/60.geojson --file src/mocks/fixtures/KGX-60.json --local
wrangler r2 object put isohome/static/stations.geojson --file src/mocks/fixtures/stations.json --local
wrangler r2 object put isohome/static/rail-lines.geojson --file src/mocks/fixtures/rail-lines.json --local
