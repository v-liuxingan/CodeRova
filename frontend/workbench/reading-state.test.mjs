import test from 'node:test';
import assert from 'node:assert/strict';
import {readingState} from './reading-state.js';
const nodes=['root','pending','leaf','candidate'].map(id=>({id}));
const graph={root:'root',nodes,analysis:{provider:'rust-analyzer',queriedNodes:['root','leaf'],pendingNodes:['pending','candidate'],issues:['pending: timeout','leaf: old timeout','pending-other: not this node','global message']}};
test('reading state uses source facts, not visible children or old errors',()=>{
  const root=readingState(graph,nodes[0],[{id:'call'}]);
  assert.equal(root.state,'queried');
  const pending=readingState(graph,{id:'view-ref-1',sourceId:'pending'});
  assert.equal(pending.state,'pending');assert.deepEqual(pending.issues,['timeout']);
  const leaf=readingState(graph,nodes[2]);
  assert.equal(leaf.state,'leaf');assert.deepEqual(leaf.issues,['old timeout']);
  assert.match(leaf.hint,/不等于业务流程结束/);
  const candidate={kind:'trait-dispatch',callSiteStatus:'omitted-nodes'};
  assert.equal(readingState(graph,nodes[3],[],[candidate]).state,'candidate');
  assert.equal(readingState(graph,nodes[3],[],[candidate,{kind:'static-call'}]).state,'pending');
});
test('missing analysis, imported graphs and provisional positions stay explicit',()=>{
  assert.equal(readingState({nodes},nodes[0]).state,'unknown');
  assert.equal(readingState({...graph,analysis:{provider:'import'}},nodes[0]).state,'imported');
  assert.equal(readingState(graph,{id:'entry-position-a'}).state,'provisional');
  const refreshed={...graph,analysis:{...graph.analysis,pendingNodes:[],queriedNodes:['pending']}};
  assert.equal(readingState(refreshed,nodes[1]).state,'leaf');
  assert.equal(readingState(graph,nodes[1]).state,'pending');
});
