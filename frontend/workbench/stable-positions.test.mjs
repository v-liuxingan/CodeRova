import assert from 'node:assert/strict';
import {stablePositions} from './stable-positions.js';
import {layerPositions} from './graph-window.js';
for(const direction of ['TB','LR']) {
 const graph={root:'a',nodes:['a','b','c',...Array.from({length:60},(_,i)=>`leaf${i}`)].map(id=>({id,sourceId:id})),edges:[{from:'a',to:'b'},{from:'a',to:'c'},...Array.from({length:60},(_,i)=>({from:'b',to:`leaf${i}`}))]};
 const oldGraph={...graph,nodes:graph.nodes.slice(0,3),edges:graph.edges.slice(0,2)};
 const old=layerPositions(oldGraph,direction);
 const placed=stablePositions(graph,layerPositions(graph,direction),old,direction);
 for(const [id,position] of old) assert.deepEqual(placed.get(id),position);
 const leaves=graph.nodes.slice(3).map(n=>placed.get(n.id));
 const cross=direction==='LR'?'y':'x',along=direction==='LR'?'x':'y';
 assert.equal(new Set(leaves.map(p=>p[along])).size,1);
 const sorted=leaves.map(p=>p[cross]).sort((a,b)=>a-b);
 for(let i=1;i<sorted.length;i++) assert(sorted[i]-sorted[i-1]>=(direction==='LR'?180:350));
 const collapsed=stablePositions(oldGraph,layerPositions(oldGraph,direction),placed,direction);
 for(const [id,position] of old) assert.deepEqual(collapsed.get(id),position);
 const moved=new Map(old);moved.set('c',{x:1234,y:5678});
 assert.deepEqual(stablePositions(graph,layerPositions(graph,direction),moved,direction).get('c'),moved.get('c'));
}
console.log('Stable layout: both directions, 60-child expansion, sibling preservation, free slots, collapse and manual positions PASS');

for (const direction of ['TB','LR']) {
 const node=id=>({id,sourceId:id});
 const base={root:'root',nodes:['root','a','b'].map(node),edges:[{from:'root',to:'a'},{from:'root',to:'b'}]};
 const expand=(g,parent)=>({...g,nodes:[...g.nodes,...[0,1,2,3].map(i=>node(parent+i))],edges:[...g.edges,...[0,1,2,3].map(i=>({from:parent,to:parent+i}))]});
 const first=expand(base,'a'), both=expand(first,'b');
 const compact=layerPositions(base,direction);
 const firstPositions=stablePositions(first,layerPositions(first,direction),compact,direction,'a');
 assert.deepEqual(firstPositions.get('b'),compact.get('b'));
 const result=stablePositions(both,layerPositions(both,direction),firstPositions,direction,'b');
 assert.deepEqual(result.get('b'),firstPositions.get('b'));
 assert.notDeepEqual(result.get('a'),firstPositions.get('a'));
 const along=direction==='LR'?'x':'y',cross=direction==='LR'?'y':'x',spacing=direction==='LR'?180:350;
 for(const [id,p] of result) for(const [other,q] of result) if(id!==other && p[along]===q[along]) assert(Math.abs(p[cross]-q[cross])>=spacing);
 const hidden=stablePositions(first,layerPositions(first,direction),result,direction,'b');
 assert.deepEqual(hidden.get('b'),result.get('b'));
 assert(Math.abs(hidden.get('a')[cross]-hidden.get('b')[cross]) < Math.abs(result.get('a')[cross]-result.get('b')[cross]));
 for(const [id,p] of hidden) for(const [other,q] of hidden) if(id!==other && p[along]===q[along]) assert(Math.abs(p[cross]-q[cross])>=spacing);
 const restored=stablePositions(both,layerPositions(both,direction),hidden,direction,'b');
 assert.deepEqual(restored.get('b'),hidden.get('b'));
 for(const [id,p] of restored) for(const [other,q] of restored) if(id!==other && p[along]===q[along]) assert(Math.abs(p[cross]-q[cross])>=spacing);
}
console.log('Concurrent branches: expansion, collapse compaction, re-expansion, no overlap and fixed anchor PASS');

for(const direction of ['TB','LR']) {
 const point=(cross,depth)=>direction==='LR'?{x:depth*400,y:cross}:{x:cross,y:depth*200};
 const graph={root:'r',nodes:['r','a','b','a1','a2','b1'].map(id=>({id,sourceId:id})),edges:[['r','a'],['r','b'],['a','a1'],['a','a2'],['b','b1']].map(([from,to])=>({from,to}))};
 const previous=new Map([['r',point(0,0)],['a',point(-175,1)],['b',point(175,1)],['a1',point(-1000,2)],['a2',point(1000,2)]]);
 const result=stablePositions(graph,layerPositions(graph,direction),previous,direction,'b');
 const cross=direction==='LR'?'y':'x';
 assert.deepEqual(result.get('b'),previous.get('b'));
 assert(Math.max(result.get('a1')[cross],result.get('a2')[cross])<result.get('b1')[cross]);
 assert.notDeepEqual(result.get('a'),previous.get('a'));
}
console.log('Interleaving branches without rectangle overlap now trigger subtree-width reflow PASS');
