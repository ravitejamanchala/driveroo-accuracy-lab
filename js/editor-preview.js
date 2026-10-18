import { ribbonQuads, offsetPoint } from './road-geometry.js';
import { laneCentre } from './net.js';
import { autoMarkings, markingQuads } from './map-features.js';
import { lampPlacements } from './street-furniture.js';

export function createPreview(canvas) {
  const T = window.THREE;
  if (!T) throw Error('3D library could not load. The overhead editor remains available.');
  const renderer = new T.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  const scene = new T.Scene(); scene.background = new T.Color('#bdced7'); scene.fog = new T.Fog('#bdced7', 160, 420);
  scene.add(new T.HemisphereLight(0xffffff, 0x667755, 1));
  const sun = new T.DirectionalLight(0xffffff,.7); sun.position.set(30,80,20); scene.add(sun);
  const camera = new T.PerspectiveCamera(68, 1, .1, 600);
  let group = new T.Group(); scene.add(group);
  function rebuild(net, edge) {
    scene.remove(group); group.traverse(o => { o.geometry?.dispose(); if (o.material) o.material.dispose(); }); group = new T.Group(); scene.add(group);
    const anchor = offsetPoint(edge, edge.len / 2, 0), radius = Math.max(300, edge.len / 2 + 120);
    const nearby = net.edges.filter(e => Array.from(e.px).some((x,i) => Math.hypot(x-anchor.x,e.pz[i]-anchor.z)<radius));
    const buckets = new Map();
    function quads(qs, y, colour) { const a = buckets.get(colour) || []; for (const q of qs) for (const i of [0,1,2,0,2,3]) a.push(q[i].x,y,q[i].z); buckets.set(colour,a); }
    quads([[{x:anchor.x-radius*2,z:anchor.z-radius*2},{x:anchor.x+radius*2,z:anchor.z-radius*2},{x:anchor.x+radius*2,z:anchor.z+radius*2},{x:anchor.x-radius*2,z:anchor.z+radius*2}]],-.01,'#70826b');
    for (const e of nearby) {
      quads(ribbonQuads(e,-e.way.w/2-2.6,e.way.w/2+2.6),.02,'#9a9e9c');
      quads(ribbonQuads(e,-e.way.w/2,e.way.w/2),.04,'#374047');
      for (const m of autoMarkings(e)) quads(markingQuads(e,m),.07,'#f4f0df');
    }
    for (const m of net.markings) if (nearby.includes(m.e)) quads(markingQuads(m.e,m),.075,'#f4f0df');
    for (const [colour, positions] of buckets) { const g = new T.BufferGeometry(); g.setAttribute('position',new T.Float32BufferAttribute(positions,3)); g.computeVertexNormals(); group.add(new T.Mesh(g,new T.MeshLambertMaterial({color:colour,side:T.DoubleSide}))); }
    for (const island of net.islands) {
      const shape = new T.Shape(island.points.map(([x,z])=>new T.Vector2(x,-z))), g = new T.ExtrudeGeometry(shape,{depth:island.height||.15,bevelEnabled:false}); g.rotateX(-Math.PI/2);
      group.add(new T.Mesh(g,new T.MeshLambertMaterial({color:'#c1bca9'})));
    }
    const C=net.chunkSize, seen=new Set();
    for (const e of nearby) for (let i=0;i<e.n;i++) {
      const cx=Math.floor(e.px[i]/C),cz=Math.floor(e.pz[i]/C),key=net.ck(cx,cz); if(seen.has(key))continue;seen.add(key);
      for(const p of lampPlacements(net,net.chunks.get(key)||[],{cx,cz,size:C})) {
        const pole=new T.Mesh(new T.CylinderGeometry(.07,.11,7,5),new T.MeshLambertMaterial({color:'#3e4649'}));pole.position.set(p.x,3.5,p.z);group.add(pole);
        const head=new T.Mesh(new T.BoxGeometry(.4,.18,1.5),new T.MeshLambertMaterial({color:'#fff0bc'}));head.position.set(p.x+p.dx*.65,7,p.z+p.dz*.65);head.rotation.y=Math.atan2(p.dx,p.dz);group.add(head);
      }
    }
  }
  function render(edge, distance, dir, chase=false) {
    const p=offsetPoint(edge,distance,laneCentre(edge,dir,0)*dir), look=offsetPoint(edge,Math.max(0,Math.min(edge.len,distance+dir*12)),laneCentre(edge,dir,0)*dir);
    const w=canvas.clientWidth,h=canvas.clientHeight;if(!w||!h)return p;
    if(canvas.width!==Math.round(w*renderer.getPixelRatio())||canvas.height!==Math.round(h*renderer.getPixelRatio()))renderer.setSize(w,h,false);
    camera.aspect=w/h;camera.updateProjectionMatrix();camera.position.set(p.x-(chase?p.tx*dir*7:0),chase?4:1.25,p.z-(chase?p.tz*dir*7:0));
    if(Math.hypot(look.x-p.x,look.z-p.z)<1)camera.lookAt(p.x+p.tx*dir*15,1.1,p.z+p.tz*dir*15);else camera.lookAt(look.x,1.1,look.z);
    renderer.render(scene,camera);return p;
  }
  return {rebuild,render};
}
