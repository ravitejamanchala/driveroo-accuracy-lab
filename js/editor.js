import { importMapillary, locateSuggestion, acceptLampSuggestion } from './mapillary-import.js';
import { buildNet, laneInfo, nearest, laneCentre } from './net.js';
import { ribbonQuads, offsetPoint, roadClear, pointInPolygon } from './road-geometry.js';
import { lampPlacements } from './street-furniture.js';
import { DRAFT_KEY, validateCorrections } from './corrections.js';
import { autoMarkings, markingQuads, dividerPolygon } from './map-features.js';
import { createPreview } from './editor-preview.js';
import { createMapPackage, validateMapPackage, resolveMapURL } from './map-package.js';
const $=id=>document.getElementById(id),canvas=$('map'),ctx=canvas.getContext('2d');
let data,net,original,selected=0,view={x:0,z:0,scale:3},size={w:0,h:0},corrections;
let mode='select',baseline=false,polygon=[],drag=null,lamps=[],dirty=true,space=false;
let selection={type:'road'},preview,previewDirty=true,previewAt=0,playing=false,dir=1,last=0,distance=12;
const history=[],future=[];
let references=[],referenceId='',referenceRefresh=0,referenceCamera='';
const status=m=>{$('status').textContent=m;};
const world=(x,y)=>({x:(x-size.w/2)/view.scale+view.x,z:(y-size.h/2)/view.scale+view.z});
const screen=(x,z)=>({x:(x-view.x)*view.scale+size.w/2,y:(z-view.z)*view.scale+size.h/2});
const controls=()=>corrections.edges[net.edges[selected].key]?.points||Array.from(net.edges[selected].px,(x,i)=>[x,net.edges[selected].pz[i]]);
function beforeEdit(){history.push(structuredClone(corrections));if(history.length>60)history.shift();future.length=0;}
function normalise(c){c.review||={accepted:[],dismissed:[]};c.markings||=[];c.hiddenLamps||=[];return c;}
function rebuild(){validateCorrections(corrections);net=buildNet(data,corrections);dirty=true;previewDirty=true;}
function save(){try{rebuild();refreshReferences();localStorage.setItem(DRAFT_KEY,JSON.stringify(corrections));refreshForm();status(`Saved locally · ${Object.keys(corrections.edges).length} road edits · ${corrections.markings.length} markings · ${corrections.islands.length} dividers / islands`);}catch(e){status(e.message);throw e;}}
function commit(fn){const old=structuredClone(corrections);try{fn();validateCorrections(corrections);buildNet(data,corrections);history.push(old);if(history.length>60)history.shift();future.length=0;save();}catch(e){corrections=old;rebuild();status(e.message);}}
function refreshForm(){const e=net.edges[selected];if(!e)return;const f=laneInfo(e,1),b=laneInfo(e,-1),c=corrections.edges[e.key]||{};
  $('width').value=e.way.w;$('forward').value=f.n;$('backward').value=e.way.oneway?0:b.n;$('backward').disabled=!!e.way.oneway;
  $('procedural').checked=corrections.proceduralLamps!==false;$('road').value=String(selected);$('smooth').checked=!!c.smooth;$('centreStyle').value=c.centreStyle||'dashed';$('laneStyle').value=c.laneStyle||'dashed';
  const mid=offsetPoint(e,e.len/2,0);$('mapillary').href=`https://www.mapillary.com/app/?lat=${net.origin[0]-mid.z/net.kz}&lng=${net.origin[1]+mid.x/net.kx}&z=17`;
  $('roadMeta').textContent=`${Math.round(e.len)} m · ${e.way.oneway?'One way':'Two way'} · Width ${e.way.meta.widthSource||'inferred'}`;
  $('selection').textContent=selection.type==='road'?e.way.name||'Unnamed road':`${selection.type}${Number.isInteger(selection.index)?' '+(selection.index+1):''}`;
  $('distance').max=e.len;distance=Math.min(distance,e.len);$('distance').value=distance;$('reverse').disabled=!!e.way.oneway;if(e.way.oneway)dir=1;
}
function chooseObject(s){selection=s;if(s.type==='marking'){const m=corrections.markings[s.index];$('markType').value=m.type;$('markLength').value=m.length;$('markWidth').value=m.width;}if(s.type==='island')$('dividerHeight').value=corrections.islands[s.index].height||.15;refreshForm();}
function roadOptions(){const q=$('search').value.toLowerCase(),matches=net.edges.filter(e=>e.way.name.toLowerCase().includes(q));$('road').replaceChildren(...matches.slice(0,400).map(e=>new Option(`${e.way.name||'Unnamed road'} · ${e.id}`,e.id)));if(matches.length&&!matches.some(e=>e.id===selected))selected=matches[0].id;previewDirty=true;refreshForm();}
function selectRoad(id){selected=id;selection={type:'road'};$('search').value=net.edges[id].way.name;roadOptions();previewDirty=true;}
function centre(){const e=net.edges[selected],xs=[...e.px],zs=[...e.pz];view.x=(Math.min(...xs)+Math.max(...xs))/2;view.z=(Math.min(...zs)+Math.max(...zs))/2;view.scale=Math.max(.1,Math.min(8,Math.min(size.w/(Math.max(...xs)-Math.min(...xs)+75),size.h/(Math.max(...zs)-Math.min(...zs)+75))));dirty=true;}
function rebuildLamps(){lamps=[];const C=net.chunkSize,x0=Math.floor((view.x-size.w/view.scale/2)/C),x1=Math.floor((view.x+size.w/view.scale/2)/C),z0=Math.floor((view.z-size.h/view.scale/2)/C),z1=Math.floor((view.z+size.h/view.scale/2)/C);for(let x=x0;x<=x1;x++)for(let z=z0;z<=z1;z++)lamps.push(...lampPlacements(net,net.chunks.get(net.ck(x,z))||[],{cx:x,cz:z,size:C}));dirty=false;}
function trace(points,fill,stroke,closed=true){ctx.beginPath();points.forEach((p,i)=>{const s=screen(p.x,p.z);i?ctx.lineTo(s.x,s.y):ctx.moveTo(s.x,s.y);});if(closed)ctx.closePath();if(fill){ctx.fillStyle=fill;ctx.fill();}if(stroke){ctx.strokeStyle=stroke;ctx.lineWidth=1.5;ctx.stroke();}}
function strip(e,a,b,colour){for(const q of ribbonQuads(e,a,b))trace(q,colour);}
function dot(x,z,r,colour){const p=screen(x,z);ctx.beginPath();ctx.arc(p.x,p.y,r,0,Math.PI*2);ctx.fillStyle=colour;ctx.fill();}
function visible(e){return Array.from(e.px).some((x,i)=>Math.abs(x-view.x)<size.w/view.scale/2+200&&Math.abs(e.pz[i]-view.z)<size.h/view.scale/2+200);}
function activeReferences(){const kind=$('referenceKind').value;return references.filter(f=>(kind==='all'||f.kind===kind)&&!corrections.review.dismissed.includes(f.id)&&!corrections.review.accepted.includes(f.id));}
function currentReference(){return references.find(f=>f.id===referenceId);}
function refreshReferences(){if(!net)return;const candidates=activeReferences().map(f=>({...f,dist:(f.x-view.x)**2+(f.z-view.z)**2})).sort((a,b)=>a.dist-b.dist).slice(0,150);if(!candidates.some(f=>f.id===referenceId))referenceId=candidates[0]?.id||'';$('referenceList').replaceChildren(...candidates.map(f=>new Option(`${f.value.replaceAll('--',' / ')} · ${Math.round(Math.sqrt(f.dist))} m`,f.id)));$('referenceList').value=referenceId;referenceInfo();}
function referenceInfo(){const f=currentReference();if(!f){$('referenceInfo').textContent=`${references.length.toLocaleString()} detections loaded · no pending matches.`;$('acceptReference').disabled=$('markReference').disabled=true;return;}const p=locateSuggestion(net,f);$('referenceInfo').textContent=`${references.length.toLocaleString()} loaded · ID ${f.id} · last seen ${f.lastSeen?new Date(f.lastSeen).toISOString().slice(0,10):'unknown'} · ${Number.isFinite(p.distance)?Math.round(p.distance)+' m from '+p.road:'outside map'}`;$('acceptReference').disabled=f.kind!=='lamp';$('markReference').disabled=f.kind!=='marking';$('mapillary').href=`https://www.mapillary.com/app/?lat=${f.lat}&lng=${f.lon}&z=18`;}
function loadReferences(features){const seen=new Map(references.map(f=>[f.id,f]));for(const f of features){const p=locateSuggestion(net,f);seen.set(f.id,{...f,x:p.x,z:p.z});}references=[...seen.values()];data.referenceFeatures=references.map(({x,z,...f})=>f);refreshReferences();}
function draw(now){requestAnimationFrame(draw);if(!net)return;const dt=Math.min(.05,(now-last)/1000||0);last=now;
  if(playing){distance+=dir*dt*6;if(distance<=0||distance>=net.edges[selected].len){distance=Math.max(0,Math.min(net.edges[selected].len,distance));playing=false;$('play').textContent='▶ Travel';}$('distance').value=distance;}
  ctx.setTransform(devicePixelRatio,0,0,devicePixelRatio,0,0);ctx.fillStyle='#152631';ctx.fillRect(0,0,size.w,size.h);
  const shown=baseline?original:net,edges=shown.edges.filter(visible);
  for(const e of edges)strip(e,-e.way.w/2-2.6,e.way.w/2+2.6,'#41505a');
  for(const e of edges){strip(e,-e.way.w/2,e.way.w/2,e.id===selected?'#315c60':'#263944');if($('layerMarks').checked)for(const m of autoMarkings(e))for(const q of markingQuads(e,m))trace(q,'#cfdbd9');}
  if(!baseline){
    if($('layerMarks').checked)for(const [i,m] of net.markings.entries())for(const q of markingQuads(m.e,m))trace(q,selection.type==='marking'&&selection.index===i?'#ffd173':'#f4f0df');
    if($('layerIslands').checked)for(const [i,island] of net.islands.entries()){trace(island.points.map(([x,z])=>({x,z})),selection.type==='island'&&selection.index===i?'#a8b989':'#819081','#dce7d7');if(selection.type==='island'&&selection.index===i)for(const [x,z]of island.points)dot(x,z,4,'#ffd173');}
    if(dirty)rebuildLamps();if($('layerLamps').checked)for(const p of lamps)dot(p.x,p.z,p.source==='inferred'?3:4.5,p.source==='inferred'?'#f8ce70':'#d9f5ff');
    if(selection.type==='lamp')dot(selection.lamp.x,selection.lamp.z,7,'#ff9c63');
  }
  if(!baseline){const ps=controls();trace(ps.map(([x,z])=>({x,z})),null,'#51dfc5',false);ps.forEach(([x,z],i)=>dot(x,z,selection.type==='point'&&selection.index===i?6:4,i===0||i===ps.length-1?'#879aa5':'#51dfc5'));}
  if(!baseline&&$('layerReferences').checked){for(const f of activeReferences())if(Math.abs(f.x-view.x)<size.w/view.scale/2&&Math.abs(f.z-view.z)<size.h/view.scale/2)dot(f.x,f.z,f.id===referenceId?7:3.5,f.kind==='sign'?'#f18ca3':f.kind==='marking'?'#ae9ff5':'#5bc9f7');}
  const refKey=`${Math.round(view.x/30)}:${Math.round(view.z/30)}`;if(refKey!==referenceCamera&&now-referenceRefresh>800){referenceCamera=refKey;referenceRefresh=now;refreshReferences();}
  if(polygon.length)trace(polygon.map(([x,z])=>({x,z})),mode==='island'?'#a6bb8c44':null,'#ffd173',mode==='island');
  const edge=shown.edges[selected],car=offsetPoint(edge,Math.min(distance,edge.len),laneCentre(edge,dir,0)*dir),p=screen(car.x,car.z);
  ctx.save();ctx.translate(p.x,p.y);ctx.rotate(Math.atan2(car.tz*dir,car.tx*dir));ctx.fillStyle='#ffbd59';ctx.beginPath();ctx.moveTo(10,0);ctx.lineTo(-7,-5);ctx.lineTo(-7,5);ctx.closePath();ctx.fill();ctx.restore();
  if(preview&&$('cameraView').value!=='off'){if(previewDirty&&now-previewAt>150){try{preview.rebuild(shown,edge);previewDirty=false;previewAt=now;$('previewStatus').textContent=baseline?'Original geometry':'Live edits · 6 m/s travel · selected road section';}catch(e){$('previewStatus').textContent=e.message;previewDirty=false;}}preview.render(edge,distance,dir,$('cameraView').value==='chase');}
  $('distanceLabel').textContent=`${Math.round(distance)} / ${Math.round(edge.len)} m`;
  const metres=view.scale>1?20:100;ctx.fillStyle='#d4e8eb';ctx.fillRect(20,size.h-86,metres*view.scale,2);ctx.font='11px system-ui';ctx.fillText(`${metres} m`,20,size.h-92);
}
function setMode(next){mode=next;polygon=[];$('finishIsland').style.display=['island','divider'].includes(next)?'block':'none';$('finishIsland').textContent=next==='divider'?'Finish divider':'Finish island';document.querySelectorAll('[data-mode]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.mode===next)));$('hint').textContent={select:'Select objects, drag lamps / markings / islands. Drag teal road points; double-click to add a point. Delete removes a selected interior point.',pan:'Drag the map. Space or middle button pans from any tool. Scroll to zoom at the pointer.',lamp:'Click pavement to add a lamp. Select any lamp to move or delete it, including generated lamps.',marking:'Click a road to place the chosen marking. Select and drag it along or across the road.',island:'Click polygon corners. Enter finishes. Select an island to drag it or reshape its yellow corners.',divider:'Click a centre path for a raised divider. Width and height come from object properties. Enter finishes.',camera:'Click a road to place the driver camera there. Use Travel to inspect the selected section.'}[next];canvas.style.cursor=next==='pan'?'grab':'crosshair';}
function eventPoint(ev){const r=canvas.getBoundingClientRect();return{x:ev.clientX-r.left,y:ev.clientY-r.top};}
function snap(p){return $('snap').checked?{x:Math.round(p.x*2)/2,z:Math.round(p.z*2)/2}:p;}
function markingPosition(m){const e=net.edges.find(e=>e.key===m.edgeKey);return e&&offsetPoint(e,Math.min(e.len,m.s+m.length/2),m.offset);}
function hitObject(p){
  if($('layerLamps').checked){const lamp=lamps.find(l=>Math.hypot(l.x-p.x,l.z-p.z)*view.scale<10);if(lamp)return{type:'lamp',lamp};}
  if($('layerIslands').checked&&selection.type==='island'){const island=corrections.islands[selection.index];if(island)for(let i=0;i<island.points.length;i++){const q=island.points[i];if(Math.hypot(q[0]-p.x,q[1]-p.z)*view.scale<10)return{type:'islandPoint',index:selection.index,vertex:i};}}
  if($('layerMarks').checked)for(let i=corrections.markings.length-1;i>=0;i--){const m=net.markings.find(m=>m.edgeKey===corrections.markings[i].edgeKey&&m.s===corrections.markings[i].s);if(m&&markingQuads(m.e,m).some(q=>pointInPolygon(p.x,p.z,q.map(v=>[v.x,v.z]))))return{type:'marking',index:i};const q=markingPosition(corrections.markings[i]);if(q&&Math.hypot(q.x-p.x,q.z-p.z)*view.scale<9)return{type:'marking',index:i};}
  if($('layerIslands').checked)for(let i=corrections.islands.length-1;i>=0;i--)if(pointInPolygon(p.x,p.z,corrections.islands[i].points))return{type:'island',index:i};return null;
}
document.querySelectorAll('[draggable="true"]').forEach(b=>b.addEventListener('dragstart',ev=>{ev.dataTransfer.setData('text/plain',b.dataset.mode);}));
canvas.addEventListener('dragover',ev=>ev.preventDefault());
canvas.addEventListener('drop',ev=>{ev.preventDefault();if(!net||baseline)return;const type=ev.dataTransfer.getData('text/plain'),m=eventPoint(ev),p=snap(world(m.x,m.y));
 if(type==='lamp'){if(!roadClear(net,p.x,p.z,.5)){status('Drop the lamp on clear pavement.');return;}commit(()=>corrections.lamps.push(p));}
 if(type==='marking'){const n=nearest(net,p.x,p.z);if(!n||n.d>20)return;const f=offsetPoint(n.e,n.s,0);commit(()=>corrections.markings.push({edgeKey:n.e.key,s:n.s,offset:(p.x-f.x)*f.tz-(p.z-f.z)*f.tx,type:$('markType').value,length:Number($('markLength').value),width:Number($('markWidth').value)}));}
 if(type==='divider'){setMode('divider');polygon=[[p.x,p.z]];status('Divider started. Click more path points, then Enter.');}
});
canvas.addEventListener('contextmenu',e=>e.preventDefault());
canvas.addEventListener('pointerdown',ev=>{if(!net)return;const mouse=eventPoint(ev),p=snap(world(mouse.x,mouse.y));canvas.setPointerCapture(ev.pointerId);
  if(mode==='pan'||space||ev.button===1||ev.button===2||ev.shiftKey){drag={type:'pan',mouse,x:view.x,z:view.z};return;}
  if(baseline){status('Return to edited geometry before editing.');return;}
  if(['island','divider'].includes(mode)){polygon.push([p.x,p.z]);return;}
  if(mode==='camera'){const n=nearest(net,p.x,p.z);if(n){selectRoad(n.e.id);distance=n.s;refreshForm();}return;}
  if(mode==='select'&&$('layerReferences').checked){const f=activeReferences().find(f=>Math.hypot(f.x-p.x,f.z-p.z)*view.scale<8);if(f){referenceId=f.id;refreshReferences();status('Mapillary suggestion selected. Review it in the inspector.');return;}}
  const hit=hitObject(p);
  if(hit&&(mode==='select'||mode==='lamp'&&hit.type==='lamp')){chooseObject(hit.type==='islandPoint'?{type:'island',index:hit.index}:hit);beforeEdit();drag={...hit,start:p,original:structuredClone(corrections)};return;}
  if(mode==='lamp'){if(!roadClear(net,p.x,p.z,.5)){status('Place the lamp outside the carriageway.');return;}commit(()=>corrections.lamps.push({x:p.x,z:p.z}));return;}
  if(mode==='marking'){const n=nearest(net,p.x,p.z);if(!n||n.d>20){status('Place a marking on a road.');return;}const frame=offsetPoint(n.e,n.s,0),offset=(p.x-frame.x)*frame.tz-(p.z-frame.z)*frame.tx;commit(()=>corrections.markings.push({edgeKey:n.e.key,s:n.s,offset,type:$('markType').value,length:Number($('markLength').value),width:Number($('markWidth').value)}));chooseObject({type:'marking',index:corrections.markings.length-1});return;}
  const ps=controls();for(let i=1;i<ps.length-1;i++)if(Math.hypot(ps[i][0]-p.x,ps[i][1]-p.z)*view.scale<10){chooseObject({type:'point',index:i});beforeEdit();drag={type:'point',index:i,original:structuredClone(corrections)};return;}
  const n=nearest(net,p.x,p.z);if(n&&n.d<Math.max(10,15/view.scale))selectRoad(n.e.id);
});
canvas.addEventListener('pointermove',ev=>{if(!drag)return;const mouse=eventPoint(ev),p=snap(world(mouse.x,mouse.y));
  if(drag.type==='pan'){view.x=drag.x-(mouse.x-drag.mouse.x)/view.scale;view.z=drag.z-(mouse.y-drag.mouse.y)/view.scale;dirty=true;return;}
  const previous=structuredClone(corrections);
  if(drag.type==='point'){const e=net.edges[selected],c=corrections.edges[e.key]||={};c.points||=controls().map(p=>[...p]);c.points[drag.index]=[p.x,p.z];}
  if(drag.type==='lamp'){if(!roadClear(net,p.x,p.z,.5))return;corrections=structuredClone(drag.original);const l=drag.lamp;if(l.source==='manual'){const i=corrections.lamps.findIndex(q=>Math.hypot(q.x-l.x,q.z-l.z)<.1);if(i>=0)corrections.lamps[i]={x:p.x,z:p.z};}else{corrections.hiddenLamps.push({x:l.x,z:l.z});corrections.lamps.push({x:p.x,z:p.z});}selection={type:'lamp',lamp:{...p,source:'manual'}};}
  if(drag.type==='marking'){const m=corrections.markings[drag.index],n=nearest(net,p.x,p.z);if(n&&n.d<30){const f=offsetPoint(n.e,n.s,0);m.edgeKey=n.e.key;m.s=Math.max(0,n.s-m.length/2);m.offset=(p.x-f.x)*f.tz-(p.z-f.z)*f.tx;}}
  if(drag.type==='island'){corrections.islands[drag.index].points=drag.original.islands[drag.index].points.map(([x,z])=>[x+p.x-drag.start.x,z+p.z-drag.start.z]);}
  if(drag.type==='islandPoint')corrections.islands[drag.index].points[drag.vertex]=[p.x,p.z];
  try{rebuild();}catch(e){corrections=previous;status(e.message);}
});
function endDrag(){if(drag&&drag.type!=='pan')save();drag=null;}
canvas.addEventListener('pointerup',endDrag);canvas.addEventListener('pointercancel',()=>{if(drag?.original){corrections=drag.original;save();}drag=null;});
canvas.addEventListener('dblclick',ev=>{if(mode!=='select'||baseline)return;const m=eventPoint(ev),p=world(m.x,m.y),ps=controls();let best=null;
 for(let i=0;i<ps.length-1;i++){const a=ps[i],b=ps[i+1],dx=b[0]-a[0],dz=b[1]-a[1],t=Math.max(.01,Math.min(.99,((p.x-a[0])*dx+(p.z-a[1])*dz)/(dx*dx+dz*dz||1))),x=a[0]+dx*t,z=a[1]+dz*t,d=Math.hypot(x-p.x,z-p.z);if(!best||d<best.d)best={i,x,z,d};}
 if(best&&best.d*view.scale<20)commit(()=>{const c=corrections.edges[net.edges[selected].key]||={};c.points=ps.map(p=>[...p]);c.points.splice(best.i+1,0,[best.x,best.z]);});
});
canvas.addEventListener('wheel',ev=>{ev.preventDefault();const m=eventPoint(ev),p=world(m.x,m.y);view.scale=Math.min(25,Math.max(.1,view.scale*Math.exp(-ev.deltaY*.001)));const q=world(m.x,m.y);view.x+=p.x-q.x;view.z+=p.z-q.z;dirty=true;},{passive:false});
function removeSelection(){if(baseline)return;const s=selection;commit(()=>{if(s.type==='lamp'){if(s.lamp.source==='manual')corrections.lamps=corrections.lamps.filter(p=>Math.hypot(p.x-s.lamp.x,p.z-s.lamp.z)>.1);else corrections.hiddenLamps.push({x:s.lamp.x,z:s.lamp.z});}else if(s.type==='island')corrections.islands.splice(s.index,1);else if(s.type==='marking')corrections.markings.splice(s.index,1);else if(s.type==='point'){const ps=controls();if(s.index===0||s.index===ps.length-1)throw Error('Junction endpoints are fixed.');const c=corrections.edges[net.edges[selected].key]||={};c.points=ps.filter((_,i)=>i!==s.index);}else throw Error('Select a lamp, marking, divider or interior control point to delete.');});selection={type:'road'};refreshForm();}
$('referenceKind').onchange=refreshReferences;$('referenceList').onchange=()=>{referenceId=$('referenceList').value;referenceInfo();};
$('locateReference').onclick=()=>{const f=currentReference();if(!f)return;const p=locateSuggestion(net,f);if(p.edge&&p.distance<100){selectRoad(p.edge.id);distance=p.s;}view.x=f.x;view.z=f.z;view.scale=5;dirty=true;referenceInfo();};
$('dismissReference').onclick=()=>{const f=currentReference();if(f)commit(()=>corrections.review.dismissed.push(f.id));};
$('acceptReference').onclick=()=>{const f=currentReference();if(f)commit(()=>acceptLampSuggestion(net,corrections,f));};
$('markReference').onclick=()=>{const f=currentReference();if(!f||f.kind!=='marking')return;const p=locateSuggestion(net,f);if(!p.edge||p.distance>15){status('Detection is too far from the road.');return;}const frame=offsetPoint(p.edge,p.s,0),type=f.value.includes('zebra')?'zebra':f.value.includes('stop-line')?'stop':null;if(!type){status('This detection needs a manually chosen marking type and dimensions. Select Place marking to trace it.');return;}commit(()=>{corrections.markings.push({edgeKey:p.edge.key,s:p.s,offset:(p.x-frame.x)*frame.tz-(p.z-frame.z)*frame.tx,type,length:type==='zebra'?3:1,width:type==='stop'?.35:.14,provenance:{source:'Mapillary',featureId:f.id,lastSeen:f.lastSeen}});corrections.review.accepted.push(f.id);});status('Marking placed with provisional dimensions. Select it to adjust against imagery.');};
$('importReference').onclick=()=>$('referenceFile').click();$('referenceFile').onchange=async()=>{try{const f=$('referenceFile').files[0];if(f){loadReferences(importMapillary(JSON.parse(await f.text())));status('Mapillary detections imported as suggestions. Export a map package to retain imported references.');}}catch(e){status(e.message);}$('referenceFile').value='';};
$('deleteObject').onclick=removeSelection;
$('applyObject').onclick=()=>commit(()=>{if(selection.type==='marking')Object.assign(corrections.markings[selection.index],{type:$('markType').value,length:Number($('markLength').value),width:Number($('markWidth').value)});else if(selection.type==='island')corrections.islands[selection.index].height=Number($('dividerHeight').value);else status('Properties will be used for the next object.');});
$('search').oninput=roadOptions;$('road').onchange=()=>{selectRoad(Number($('road').value));centre();};$('fit').onclick=centre;
$('zoomIn').onclick=()=>{view.scale=Math.min(25,view.scale*1.4);dirty=true;};$('zoomOut').onclick=()=>{view.scale=Math.max(.1,view.scale/1.4);dirty=true;};
$('baseline').onclick=()=>{baseline=!baseline;previewDirty=true;$('baseline').textContent=baseline?'Return to edited geometry':'Show original geometry';$('baseline').setAttribute('aria-pressed',String(baseline));};
document.querySelectorAll('[data-mode]').forEach(b=>b.onclick=()=>setMode(b.dataset.mode));
$('apply').onclick=()=>commit(()=>{const e=net.edges[selected];corrections.edges[e.key]={...corrections.edges[e.key],width:Number($('width').value),lanesForward:Number($('forward').value),lanesBackward:Number($('backward').value)};});
$('applyStyle').onclick=()=>commit(()=>{const e=net.edges[selected],c=corrections.edges[e.key]||={};c.points||=controls().map(p=>[...p]);c.smooth=$('smooth').checked;c.centreStyle=$('centreStyle').value;c.laneStyle=$('laneStyle').value;});
$('procedural').onchange=()=>commit(()=>{corrections.proceduralLamps=$('procedural').checked;});
function undo(redo=false){const from=redo?future:history,to=redo?history:future;if(!from.length){status('No more edits to '+(redo?'redo':'undo'));return;}to.push(structuredClone(corrections));corrections=from.pop();selection={type:'road'};polygon=[];save();}
$('undo').onclick=()=>undo();$('redo').onclick=()=>undo(true);$('resetRoad').onclick=()=>commit(()=>{delete corrections.edges[net.edges[selected].key];});
$('finishIsland').onclick=()=>{if(polygon.length<(mode==='divider'?2:3)){status('Add more points before finishing.');return;}const ps=polygon.map(p=>[...p]),width=Number($('dividerWidth').value);if(mode==='divider'&&(!Number.isFinite(width)||width<.3||width>10)){status('Divider width must be 0.3–10 m.');return;}const count=corrections.islands.length;commit(()=>corrections.islands.push({points:mode==='divider'?dividerPolygon(ps,width):ps,height:Number($('dividerHeight').value)}));if(corrections.islands.length>count){polygon=[];setMode('select');chooseObject({type:'island',index:count});}};
function download(value,name){const url=URL.createObjectURL(new Blob([JSON.stringify(value,null,2)],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
$('testMap').onclick=()=>{try{const value=$('mapUrl').value.trim();if(!value)throw Error('Paste a published map URL first.');const source=resolveMapURL(value,location.href),u=new URL('index.html',location.href);u.searchParams.set('map',source);window.open(u.href,'_blank','noopener');}catch(e){status(e.message);}};
$('export').onclick=()=>download(corrections,'corrections.json');$('exportMap').onclick=()=>download(createMapPackage(data,corrections),'cambridge-map.json');
$('import').onclick=()=>$('file').click();$('file').onchange=async()=>{try{const f=$('file').files[0];if(!f)return;const v=JSON.parse(await f.text());if(v.format==='driveroo-map'){validateMapPackage(v);buildNet(v.data,v.corrections);data=v.data;original=buildNet(data);corrections=normalise(v.corrections);references=[];loadReferences(v.data.referenceFeatures||[]);history.length=future.length=0;selected=0;save();roadOptions();centre();}else{validateCorrections(v);commit(()=>{corrections=normalise(v);});}}catch(e){status('Import rejected: '+e.message);}$('file').value='';};
$('cameraView').onchange=()=>document.querySelector('.stage').classList.toggle('previewHidden',$('cameraView').value==='off');
$('play').onclick=()=>{playing=!playing;if(playing&&(distance>=net.edges[selected].len||distance<=0))distance=dir===1?0:net.edges[selected].len;$('play').textContent=playing?'Ⅱ Pause':'▶ Travel';};
$('reverse').onclick=()=>{dir*=-1;};$('distance').oninput=()=>{distance=Number($('distance').value);};
window.addEventListener('keydown',e=>{if(/INPUT|SELECT|TEXTAREA/.test(e.target.tagName))return;if(e.code==='Space'){space=true;e.preventDefault();}if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='z'){e.preventDefault();undo(e.shiftKey);return;}if(e.ctrlKey||e.metaKey)return;const keys={v:'select',h:'pan',l:'lamp',m:'marking',d:'divider',i:'island',c:'camera'};if(keys[e.key.toLowerCase()])setMode(keys[e.key.toLowerCase()]);if(e.key==='Delete'||e.key==='Backspace'){e.preventDefault();removeSelection();}if(e.key==='Escape'){polygon=[];if(drag?.original){corrections=drag.original;save();}drag=null;setMode('select');}if(e.key==='Enter'&&polygon.length)$('finishIsland').click();if(e.key.toLowerCase()==='f')centre();if(e.key==='+'||e.key==='=')$('zoomIn').click();if(e.key==='-')$('zoomOut').click();});window.addEventListener('keyup',e=>{if(e.code==='Space')space=false;});window.addEventListener('blur',()=>{space=false;endDrag();});
new ResizeObserver(()=>{const r=canvas.getBoundingClientRect();size={w:r.width,h:r.height};canvas.width=r.width*devicePixelRatio;canvas.height=r.height*devicePixelRatio;dirty=true;}).observe(canvas);
try{const rs=await Promise.all([fetch('data/cambridge.json'),fetch('data/corrections.json')]);if(rs.some(r=>!r.ok))throw Error('Map data could not load.');[data,corrections]=await Promise.all(rs.map(r=>r.json()));const draft=localStorage.getItem(DRAFT_KEY);if(draft)try{corrections=validateCorrections(JSON.parse(draft));}catch(e){status('Saved draft invalid; using published map.');}corrections=normalise(corrections);original=buildNet(data);rebuild();selected=Math.max(0,net.edges.findIndex(e=>e.way.name==='Milton Road'&&e.len>100));$('search').value=net.edges[selected].way.name;roadOptions();centre();try{preview=createPreview($('perspective'));}catch(e){$('previewStatus').textContent=e.message;}try{const referenceResponse=await fetch('data/reference/mapillary.json');if(referenceResponse.ok)loadReferences(importMapillary(await referenceResponse.json()));}catch(e){$('referenceInfo').textContent='Reference data unavailable: '+e.message;}setMode('select');requestAnimationFrame(draw);status('Ready · edits update the driver preview automatically.');}catch(e){status('Unable to load editor: '+e.message);}
