import { validateCorrections } from './corrections.js';
import { buildNet } from './net.js';
export function validateMapPackage(p) {
  if (!p || p.format !== 'driveroo-map' || p.version !== 1) throw Error('Unsupported map package. Expected driveroo-map version 1.');
  const d = p.data;
  if (!d || !['nodes','ways','edges','names','classes','stops','giveways','zebras','minis','rbs'].every(k=>Array.isArray(d[k])) || d.nodes.length%2 || !d.nodes.every(Number.isFinite) || !Array.isArray(d.origin) || d.origin.length!==2 || !d.origin.every(Number.isFinite)) throw Error('Invalid map network.');
  if (![d.kx,d.kz].every(v=>Number.isFinite(v)&&v>0)) throw Error('Invalid map coordinate scale.');
  if (d.edges.length>100000 || d.nodes.length>400000) throw Error('Map package exceeds this engine’s supported size.');
  for (const e of d.edges) if (!Array.isArray(e) || e.length<4 || !e.slice(0,3).every(Number.isInteger) || e[0]<0 || e[1]<0 || e[0]>=d.nodes.length/2 || e[1]>=d.nodes.length/2 || !d.ways[e[2]] || !Array.isArray(e[3]) || e[3].length<4 || e[3].length%2 || !e[3].every(Number.isFinite)) throw Error('Invalid map edge.');
  validateCorrections(p.corrections);buildNet(d,p.corrections);return p;
}
export function createMapPackage(data, corrections) {
  return validateMapPackage({format:'driveroo-map',version:1,createdAt:new Date().toISOString(),name:'Cambridge accuracy map',attribution:'© OpenStreetMap contributors, ODbL 1.0',data:structuredClone(data),corrections:structuredClone(corrections)});
}
export function resolveMapURL(value, base) {
  const u=new URL(value,base);if(u.protocol!=='https:'&&!(u.protocol==='http:'&&['localhost','127.0.0.1'].includes(u.hostname)))throw Error('Use an HTTPS map URL.');if(u.username||u.password)throw Error('Map URLs must not contain credentials.');return u.href;
}
export async function loadMapPackage(url, fetcher=fetch) {
  const r=await fetcher(url,{credentials:'omit',signal:AbortSignal.timeout(20000)});if(!r.ok)throw Error(`Map package failed to load (${r.status}).`);
  if(Number(r.headers?.get('content-length'))>50*1024*1024)throw Error('Map package is too large.');const text=await r.text();if(text.length>50*1024*1024)throw Error('Map package is too large.');return validateMapPackage(JSON.parse(text));
}
