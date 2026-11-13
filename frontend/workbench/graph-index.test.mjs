import assert from 'node:assert/strict';
import {indexGraph} from './graph-index.js';
import {PathWindow} from './path-window.js';

for (const direction of ['outgoing', 'incoming']) {
  const graph = {
    root:'root', analysis:{direction},
    nodes:['root','a','b','leaf','sibling','orphan'].map(id=>({id,label:id})),
    edges:[['ra','root','a'],['ab','a','b'],['bl','b','leaf'],['rs','root','sibling'],['ob','orphan','b'],['loop','leaf','root']]
      .map(([id,from,to])=>({id,from:direction==='incoming'?to:from,to:direction==='incoming'?from:to,...(id==='loop'?{flowKind:'loop-back'}:{})})),
  };
  const original = JSON.stringify(graph);
  const index = indexGraph(graph);
  function check(id, nodes, edges) {
    const context = index.context(id);
    assert.deepEqual([...context.nodes].sort(),nodes.sort(),`${direction}: ${id} nodes`);
    assert.deepEqual([...context.edges].sort(),edges.sort(),`${direction}: ${id} edges`);
  }
  check('b',['root','a','b'],['ra','ab']);
  check('root',['root'],[]);
  check('leaf',['root','a','b','leaf'],['ra','ab','bl']);
  check('sibling',['root','sibling'],['rs']);
  check('orphan',['orphan'],[]);
  check('a',['root','a'],['ra']); // Previous selection must not accumulate.

  // Shared source methods have independent display occurrences and paths.
  graph.edges.push({id:'sb',from:direction==='incoming'?'b':'sibling',to:direction==='incoming'?'sibling':'b'});
  const window = new PathWindow(graph); window.reset(20,'layers');
  const snapshot = window.snapshot(), display = indexGraph(snapshot);
  const occurrences = snapshot.nodes.filter(n=>n.sourceId==='b');
  assert.equal(occurrences.length,2);
  for (const occurrence of occurrences) {
    const context = display.context(occurrence.id);
    assert.equal(context.nodes.size,3);
    assert.equal(context.edges.size,2);
    assert(context.nodes.has('root'));
    assert(!context.nodes.has('leaf'));
    assert(!context.nodes.has(occurrences.find(n=>n.id!==occurrence.id).id));
  }
  for (const cycle of snapshot.nodes.filter(n=>n.pathCycle)) {
    const context = display.context(cycle.id);
    assert(context.nodes.has('root'), 'Terminal cycle references retain their root path');
    assert(context.edges.size > 0);
  }
  graph.edges.pop();
  assert.equal(JSON.stringify(graph),original);
}
console.log('Root-to-selection highlighting: both directions, branches, loops, disconnected nodes and shared occurrences PASS');
