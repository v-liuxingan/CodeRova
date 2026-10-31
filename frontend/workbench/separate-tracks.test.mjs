import assert from 'node:assert/strict';
import {separateTracks} from './separate-tracks.js';
for(const direction of ['TB','LR']) {
 const horizontal=direction==='LR';
 const node=(id,cross,axis,height)=>({id,style:horizontal?{x:axis,y:cross}:{x:cross,y:axis},data:{height}});
 const data={nodes:[node('a',0,0,100),node('b',5000,500,100),node('c',400,20,140),node('d',5500,520,100)],edges:[{id:'one',source:'a',target:'b',style:{routeFraction:.5}},{id:'two',source:'c',target:'d',style:{routeFraction:.5}}]};
 // Start with exactly coincident world-coordinate tracks despite distinct layer bands.
 const axis=horizontal?'x':'y',nodes=new Map(data.nodes.map(n=>[n.id,n]));
 const bounds=e=>{const a=nodes.get(e.source),b=nodes.get(e.target);return [a.style[axis]+(horizontal?152:a.data.height/2),b.style[axis]-(horizontal?152:b.data.height/2)];};
 for(const e of data.edges) {const [start,end]=bounds(e);e.style.routeFraction=(250-start)/(end-start);}
 separateTracks(data,direction);
 const tracks=data.edges.map(e=>{const [start,end]=bounds(e);return start+(end-start)*e.style.routeFraction;});
 assert(Math.abs(tracks[0]-tracks[1])>=10);
}
console.log('Final tracks: mixed card heights and different bands no longer share a segment, both directions PASS');

for(const direction of ['TB','LR']) {
 const horizontal=direction==='LR';
 const node=(id,cross,axis)=>({id,style:horizontal?{x:axis,y:cross}:{x:cross,y:axis},data:{height:100}});
 const data={nodes:[node('root',0,0),node('left',-5000,500),node('right',5000,500)],edges:[{id:'left',source:'root',target:'left',style:{routeFraction:.5}},{id:'right',source:'root',target:'right',style:{routeFraction:.5}}]};
 separateTracks(data,direction);
 assert.equal(data.edges[0].style.routeFraction,data.edges[1].style.routeFraction);
}
console.log('Same caller symmetric fan-out shares one turning track in both directions PASS');
