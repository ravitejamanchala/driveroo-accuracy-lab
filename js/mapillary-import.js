import { ll2xz, nearest } from './net.js';
import { roadClear } from './road-geometry.js';
export function importMapillary(collection) {
  if(collection?.type!=='FeatureCollection'||!Array.isArray(collection.features))throw Error('Expected a Mapillary GeoJSON FeatureCollection.');
  const result=[],seen=new Set();
  for(const f of collection.features){const p=f.properties||{},c=f.geometry?.coordinates;
    if(f.geometry?.type!=='Point'||!Array.isArray(c)||c.length<2||!c.slice(0,2).every(Number.isFinite)||Math.abs(c[0])>180||Math.abs(c[1])>90)continue;
    const id=String(p.id??''),value=p.value||p.object_value;if(!id||typeof value!=='string'||seen.has(id))continue;seen.add(id);
    result.push({id,value,lon:c[0],lat:c[1],firstSeen:Number(p.first_seen_at)||null,lastSeen:Number(p.last_seen_at)||null,source:'Mapillary',kind:value==='object--street-light'?'lamp':value.startsWith('marking--')?'marking':/^(regulatory|warning|information|complementary)--/.test(value)?'sign':'other'});
  }
  return result;
}
export function locateSuggestion(net,f){const p=ll2xz(net,f.lat,f.lon),n=nearest(net,p.x,p.z);return {...f,...p,road:n?.way.name||'No nearby road',distance:n?.d??Infinity,edge:n?.e,s:n?.s};}
export function acceptLampSuggestion(net,corrections,f){
  const p=locateSuggestion(net,f);if(f.kind!=='lamp')throw Error('Only street-light detections can be accepted as lamps.');
  if(p.distance>40)throw Error('Detection is outside the nearby road network.');
  if(!roadClear(net,p.x,p.z,.5))throw Error('Detection falls inside the carriageway. Verify the road width and position before accepting.');
  if(corrections.lamps.some(l=>Math.hypot(l.x-p.x,l.z-p.z)<1))throw Error('A manual lamp already exists here.');
  corrections.lamps.push({x:p.x,z:p.z,provenance:{source:'Mapillary',featureId:f.id,lastSeen:f.lastSeen,value:f.value}});
  corrections.review||={accepted:[],dismissed:[]};if(!corrections.review.accepted.includes(f.id))corrections.review.accepted.push(f.id);
}
