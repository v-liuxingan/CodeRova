import assert from 'node:assert/strict';
import {PathWindow} from './path-window.js';
import {layerPositions} from './graph-window.js';
const graph={root:'a',nodes:['a','b','c','d','x'].map(id=>({id,label:id})),edges:[['ab','a','b'],['ac','a','c'],['bd','b','d'],['cd','c','d'],['db','d','b'],['cd2','c','d']].map(([id,from,to])=>({id,from,to,file:'source.rs',line:2}))};
const original=JSON.stringify(graph);const w=new PathWindow(graph);w.reset(50,'layers');let s=w.snapshot();
const ds=s.nodes.filter(n=>n.sourceId==='d');assert.equal(ds.length,3);assert.notEqual(ds[0].id,ds[1].id);
for(const n of s.nodes) assert(new Set(s.edges.filter(e=>e.to===n.id).map(e=>e.from)).size<=1);
assert(s.nodes.some(n=>n.pathCycle));assert.equal(w.hiddenChildren(s.nodes.find(n=>n.pathCycle).id),0);
const reference=ds.find(n=>n.pathReference);assert(w.hiddenChildren(reference.id)>0);w.expand(reference.id,50,'layers');s=w.snapshot();assert(s.nodes.length<20);
assert(s.edges.every(e=>graph.edges.some(original=>original.id===e.sourceId)));
const p=layerPositions(s);assert.equal(p.get('b').y,p.get('c').y);
const lr=layerPositions(s,'LR');assert.equal(lr.get('b').x,lr.get('c').x);
assert.equal(w.reveal('x'),'x');assert.equal(JSON.stringify(graph),original);
w.reset(1,'layers');assert.equal(w.visible.size,3);w.reset(2,'nodes');assert.equal(w.visible.size,2);
const chain={root:'0',nodes:Array.from({length:125},(_,i)=>({id:String(i)})),edges:Array.from({length:124},(_,i)=>({id:`e${i}`,from:String(i),to:String(i+1)}))};const c=new PathWindow(chain);c.reset(50,'layers');assert.equal(c.visible.size,51);c.expand('50',50,'layers');assert.equal(c.visible.size,101);
console.log('Path references: distinct parents, parallel call evidence, cycle termination, explicit expansion, unchanged source, layout and depth PASS');

const sequential={root:'a',nodes:['a','b','c'].map(id=>({id})),edges:[
 {id:'last',from:'a',to:'b',order:3},
 {id:'first',from:'a',to:'b',order:1},
 {id:'middle',from:'a',to:'c',order:2},
]};
const calls=new PathWindow(sequential);calls.reset(1);
assert.deepEqual(calls.snapshot().edges.map(e=>e.sourceId),['first','middle','last']);
assert.equal(calls.snapshot().nodes.filter(n=>n.sourceId==='b').length,2);
assert.equal(calls.hiddenChildren('a'),0);
calls.collapse('a');assert.equal(calls.hiddenChildren('a'),3);
calls.reveal('c');assert.equal(calls.snapshot().edges[0].sourceId,'middle');
const textual=new PathWindow({...sequential,edges:sequential.edges.map((e,i)=>({...e,order:undefined,file:'a.rs',line:[30,10,20][i]}))});
textual.reset(1);assert.deepEqual(textual.snapshot().edges.map(e=>e.line),[10,20,30]);
assert(textual.snapshot().edges.every(e=>e.order===undefined));
console.log('Repeated callee occurrences retain known order; source position never fabricates execution order PASS');
