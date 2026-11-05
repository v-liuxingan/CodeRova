import assert from 'node:assert/strict';
import {directionalNeighbor as next} from './directional-navigation.js';
const nodes=[{id:'center',x:0,y:0},{id:'left',x:-400,y:0},{id:'right',x:400,y:0},{id:'up',x:0,y:-180},{id:'down',x:0,y:180}];
for(const [key,id] of [['ArrowLeft','left'],['ArrowRight','right'],['ArrowUp','up'],['ArrowDown','down']]) {
  assert.equal(next(nodes,'center',key),id);
  assert.equal(next(nodes,id,key),null,'no wrap at a boundary');
}
assert.equal(next(nodes,'missing','ArrowRight'),null);
assert.equal(next(nodes,'center','Enter'),null);
assert.equal(next([{id:'a',x:0,y:0},{id:'b',x:0,y:0}],'a','ArrowRight'),null);
assert.equal(next([{id:'a',x:0,y:0},{id:'b',x:1,y:100}],'a','ArrowRight'),null,'nearly vertical is not right');
assert.equal(next([{id:'a',x:0,y:0},{id:'z',x:100,y:10},{id:'b',x:100,y:-10}],'a','ArrowRight'),'b','stable tie break');
assert.equal(next([{id:'path-1',x:0,y:0},{id:'path-2',x:400,y:0}],'path-1','ArrowRight'),'path-2','path IDs remain distinct');
const rotated=nodes.map(n=>({...n,x:-n.y,y:n.x}));
assert.equal(next(nodes.map(n=>({...n,x:n.x*.001,y:n.y*.001})),'center','ArrowDown'),'down','zoom cannot change the neighbor');
assert.equal(next(rotated,'center','ArrowDown'),'right','use actual screen direction');
assert.equal(next(nodes.filter(n=>n.id!=='right'),'center','ArrowRight'),null,'excluded nodes cannot become targets');
console.log('Directional navigation PASS: all directions, boundaries, overlaps, diagonal rejection, ties and path identity');
