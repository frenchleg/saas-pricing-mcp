// Regenerates src/geo.json (globe land dots + country centres) from Natural Earth data via world-atlas.
// One-off: npm i --no-save world-atlas@2 topojson-client@3 d3-geo@3 i18n-iso-countries@7 && node scripts/build-geo.mjs
// (then re-apply the hand-corrected centres for US, FR, NO, RU, CA, NL, DK, GB, AU, NZ).
import { readFileSync, writeFileSync } from "node:fs";
import { feature } from "topojson-client";
import { geoContains, geoCentroid } from "d3-geo";
import countries from "i18n-iso-countries";
const topo = JSON.parse(readFileSync("node_modules/world-atlas/countries-110m.json", "utf8"));
const land = feature(topo, topo.objects.land);
const cs = feature(topo, topo.objects.countries);
// Land dots on an even-area grid (~2.2 degrees), like Cloudflare's dotted globe.
const step = 2.2, dots = [];
for (let lat = -58; lat <= 84; lat += step) {
  const lonStep = step / Math.max(0.25, Math.cos((lat * Math.PI) / 180));
  for (let lon = -180; lon < 180; lon += lonStep) if (geoContains(land, [lon, lat])) dots.push([Math.round(lat * 10) / 10, Math.round(lon * 10) / 10]);
}
// Country centres keyed by ISO alpha-2 (Cloudflare and request logs use alpha-2).
const centres = {};
for (const f of cs.features) {
  const a2 = countries.numericToAlpha2(String(f.id).padStart(3, "0"));
  if (!a2) continue;
  const [lon, lat] = geoCentroid(f);
  centres[a2] = [Math.round(lat * 10) / 10, Math.round(lon * 10) / 10];
}
// Small territories missing from the 110m map, so traffic from them still shows.
Object.assign(centres, { SG: [1.35, 103.8], HK: [22.3, 114.2], MT: [35.9, 14.4], LU: [49.8, 6.1], BH: [26.0, 50.6], MU: [-20.3, 57.6] }, centres);
writeFileSync("src/geo.json", JSON.stringify({ dots, centres }));
console.log("dots", dots.length, "countries", Object.keys(centres).length, "bytes", JSON.stringify({ dots, centres }).length, "GB", centres.GB, "US", centres.US, "FI", centres.FI);
