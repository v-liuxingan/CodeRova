import assert from 'node:assert/strict';
import {PathWindow} from './path-window.js';
import {layerPositions} from './graph-window.js';
import {readingState} from './reading-state.js';
const graph={root:'target',analysis:{provider:'rust-analyzer',direction:'incoming',pendingNodes:[],queriedNodes:['target']},
 nodes:['target','a','b','shared'].map(id=>({id,label:id})),
 edges:[['at','a','target'],['at2','a','target'],['bt','b','target'],['sa','shared','a'],['sb','shared','b'],['ts','target','shared']].map(([id,from,to])=>({id,from,to,file:'source.rs',line:2}))};
const original=JSON.stringify(graph), w=new PathWindow(graph);w.reset(1);
assert.equal(w.snapshot().nodes.length,4); // distinct call occurrences
assert(w.snapshot().edges.every(e=>e.to==='target'));
for(const direction of ['TB','LR']) {
 const positions=layerPositions(w.snapshot(),direction), axis=direction==='TB'?'y':'x';
 for(const node of w.snapshot().nodes.filter(n=>n.id!=='target')) assert(positions.get(node.id)[axis]<positions.get('target')[axis]);
}
w.expand('a',5);assert(w.snapshot().nodes.some(n=>n.pathCycle));
assert(w.snapshot().nodes.length<15);
const before=w.snapshot();w.update({...graph,nodes:graph.nodes.map(n=>({...n,description:'updated'}))});
assert.deepEqual(w.snapshot().edges,before.edges);
assert(w.snapshot().nodes.every(n=>n.description==='updated'));
w.collapse('target');assert.equal(w.hiddenChildren('target'),3);
w.reveal('shared');assert(w.snapshot().nodes.some(n=>n.sourceId==='shared'));
for(const edge of w.snapshot().edges) {
 const source=graph.edges.find(e=>e.id===edge.sourceId);
 assert.equal(w.nodes.get(edge.from).sourceId,source.from);
 assert.equal(w.nodes.get(edge.to).sourceId,source.to);
}
assert.equal(readingState({...graph,edges:[]},graph.nodes[0],[],[]).state,'callers');
assert.equal(JSON.stringify(graph),original);
console.log('Incoming traversal: real arrows, parallel calls, cycle boundary, update, search and both layouts PASS');
