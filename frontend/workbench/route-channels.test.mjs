import assert from 'node:assert/strict';
import {edgeLanes,edgePorts} from './edge-lanes.js';
import {routeChannels} from './route-channels.js';
import {directionalPath} from './directional-path.js';
for(const direction of ['TB','LR']) {
 const point=(cross,axis)=>direction==='LR'?{x:axis,y:cross}:{x:cross,y:axis};
 const positions=new Map([['a',point(0,0)],['b',point(400,0)],['c',point(5000,200)],['d',point(5500,200)],['e',point(10000,0)],['f',point(11000,200)]]);
 const edges=edgeLanes([{id:'ac',from:'a',to:'c'},{id:'bc',from:'b',to:'c'},{id:'bd',from:'b',to:'d'},{id:'ef',from:'e',to:'f'}],new Map(),direction);
 routeChannels(edges,positions,direction);edgePorts(edges,direction,positions);
 const [ac,bc,bd,ef]=edges;
 assert.notEqual(ac.style.routeFraction,bc.style.routeFraction);
 assert.equal(bc.style.routeFraction,bd.style.routeFraction);
 assert.equal(ac.style.routeFraction,ef.style.routeFraction);
 assert.notEqual(ac.data.targetFraction,bc.data.targetFraction);
 assert.equal(bc.data.sourceFraction,.5);
 assert.equal(bd.data.sourceFraction,.5);
 const horizontal=direction==='LR';
 const axis=horizontal?'x':'y';
 const lines=edges.slice(0,3).map(e=>{
   const a=positions.get(e.source),b=positions.get(e.target);
   const p=directionalPath([a.x,a.y],[b.x,b.y],horizontal,e.style.routeFraction);
   const segment=p[1];assert.equal(segment[0],'C');return segment[horizontal?1:2];
 });
 assert.equal(new Set(lines).size,2);
 assert(edges.every(e=>e.data.memberIds.length===1));
}
console.log('Caller routing: distinct overlapping channels, disjoint reuse, source/target ports, both orientations PASS');

const densePositions=new Map(),dense=[];
for(let i=0;i<30;i++) {
 densePositions.set('s'+i,{x:i*350,y:0});densePositions.set('t'+i,{x:20000+i*350,y:200});
 dense.push({id:'edge'+i,from:'s'+i,to:'t'+i});
}
const routed=edgeLanes(dense);routeChannels(routed,densePositions,'TB',true,'s0');
const tracks=routed.map(e=>106/2+(densePositions.get(e.target).y-106)*e.style.routeFraction).sort((a,b)=>a-b);
for(let i=1;i<tracks.length;i++) assert(tracks[i]-tracks[i-1]>=10);
assert.equal(densePositions.get('s0').y,0);
console.log('Dense routing: 30 overlapping callers retain channel spacing and anchor PASS');
