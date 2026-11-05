import assert from 'node:assert/strict';
import {RenderWindow,viewportBounds,mountDelta} from './render-window.js';
import {edgeLanes,edgePorts} from './edge-lanes.js';
const nodes=[{id:'left',style:{x:-2000,y:0},data:{height:100}},{id:'right',style:{x:2000,y:0},data:{height:100}},{id:'far',style:{x:10000,y:10000},data:{height:100}}];
const edges=edgeLanes([{id:'forward',from:'left',to:'right'},{id:'back',from:'right',to:'left'},{id:'parallel',from:'left',to:'right'}]);
assert.equal(new Set(edges.map(e=>e.data.laneFraction)).size,2);
const w=new RenderWindow({nodes,edges});const slice=w.slice(viewportBounds([0,0],500,500,1,0));assert.equal(slice.edges.length,2);assert.equal(slice.nodes.length,2);assert(!slice.nodes.some(n=>n.id==='far'));
w.move('far',[0,0]);assert(w.slice(viewportBounds([0,0],500,500,1,0)).nodes.some(n=>n.id==='far'));
console.log('Render window: crossing edges, original endpoints, offscreen exclusion, movement, reciprocal and parallel lanes PASS');

const shared={id:'shared'}, leaving={id:'leaving'}, entering={id:'entering'};
const delta=mountDelta({nodes:[shared,leaving],edges:[{id:'old'}]}, {nodes:[shared,entering],edges:[{id:'new'}]});
assert.deepEqual(delta.remove,{nodes:['leaving'],edges:['old']});
assert.deepEqual(delta.add,{nodes:[entering],edges:[{id:'new'}]});
assert.deepEqual(mountDelta({nodes:[shared],edges:[]},{nodes:[{...shared}],edges:[]}),{add:{nodes:[],edges:[]},remove:{nodes:[],edges:[]}});

assert(edges.every(e=>e.type==='adaptive-vertical'));
assert.equal(edgePorts(edges).get('left')[0].placement[1],1);
const horizontal=edgeLanes([{id:'x',from:'a',to:'b'}],new Map(),'LR');
assert.equal(horizontal[0].type,'adaptive-horizontal');
assert.deepEqual(edgePorts(horizontal,'LR').get('a')[0].placement,[1,.5]);
assert.deepEqual(edgePorts(horizontal,'LR').get('b')[0].placement,[0,.5]);

assert.deepEqual(edges[0].data.memberIds,['forward','parallel']);
assert.equal(edges[0].style.labelText,'2 条关系');
const distinct=edgeLanes([{id:'call',from:'a',to:'b',kind:'call'},{id:'return',from:'a',to:'b',kind:'return'}]);
assert.equal(distinct.length,2);
assert.notEqual(distinct[0].data.laneFraction,distinct[1].data.laneFraction);
