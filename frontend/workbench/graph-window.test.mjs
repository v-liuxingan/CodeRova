import assert from 'node:assert/strict';
import {GraphWindow, layerPositions} from './graph-window.js';
import {indexGraph} from './graph-index.js';
const nodes=Array.from({length:130},(_,i)=>({id:String(i)}));
const edges=nodes.slice(1).map((n,i)=>({id:`e${i}`,from:'0',to:n.id}));
const graph={root:'0',nodes,edges};
const w=new GraphWindow(graph);w.reset();assert.equal(w.visible.size,50);assert.equal(w.hiddenChildren('0'),80);
assert.equal(w.expand('0'),50);assert.equal(w.visible.size,100);assert.equal(w.expand('0'),30);assert.equal(w.hiddenChildren('0'),0);
assert.equal(w.snapshot().edges.length,129);assert.equal(graph.nodes.length,130);
for(const direction of ['TB','LR']){const p=layerPositions(graph,direction);const axis=direction==='TB'?'y':'x';assert.equal(new Set(nodes.slice(1).map(n=>p.get(n.id)[axis])).size,1);}
const shared={root:'a',nodes:['a','b','c','d','x'].map(id=>({id})),edges:[{id:'ab',from:'a',to:'b'},{id:'ac',from:'a',to:'c'},{id:'bc',from:'b',to:'c'},{id:'cd',from:'c',to:'d'},{id:'da',from:'d',to:'a',flowKind:'loop-back'}]};
const v=new GraphWindow(shared);v.reset(1);assert.equal(v.visible.size,1);v.reveal('d');assert.deepEqual([...v.visible],['a','d','c']);assert.equal(v.snapshot().edges.length,3);
v.reveal('x');assert(v.visible.has('x'));v.reset(1,'layers');assert.deepEqual([...v.visible],['a','b','c']);
const p=layerPositions(shared);assert.equal(p.get('b').y,p.get('c').y);assert(p.get('d').y>p.get('c').y);
const ctx=indexGraph(shared).context('b');assert.deepEqual([...ctx.nodes].sort(),['a','b']);assert.deepEqual([...ctx.edges],['ab']);
const chain={root:'0',nodes,edges:nodes.slice(1).map((n,i)=>({id:`e${i}`,from:String(i),to:n.id}))};const c=new GraphWindow(chain);c.reset(50,'layers');assert.equal(c.visible.size,51);c.expand('50',50,'layers');assert.equal(c.visible.size,101);
console.log('Graph window: paging, layers, shared targets, loops, search and alignment passed');
