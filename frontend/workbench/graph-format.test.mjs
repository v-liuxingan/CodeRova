import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeGraph, normalizeGraphResponse } from '../../public/js/graph-format.js';
const wire={schemaVersion:'0.5',nodes:[{id:'a',kind:'method',sourceFile:'A.java',line:1}],edges:[
 {id:'first',source:'a',target:'a',relation:'static-call',sourceFile:'A.java',line:2,confidenceScore:0.8},
 {id:'second',source:'a',target:'a',relation:'static-call',sourceFile:'A.java',line:3,confidenceScore:0.8},
]};
test('wire adaptation preserves each call site and leaves payload untouched',()=>{
 const result=normalizeGraph(wire);
 assert.deepEqual(result.edges.map(e=>[e.id,e.from,e.to,e.line]),[['first','a','a',2],['second','a','a',3]]);
 assert.equal(result.nodes[0].file,'A.java');assert.equal(result.edges[0].confidence,.8);
 assert.equal(result.edges[0].kind,'static-call');assert.ok(wire.edges[0].source);
 assert.deepEqual(normalizeGraph(result),result);
});
test('draft and entry-check envelopes share the adapter',()=>{
 const result=normalizeGraphResponse({draftId:'d',graph:wire,result:{node:wire.nodes[0]}});
 assert.equal(result.graph.edges[1].line,3);assert.equal(result.result.node.file,'A.java');
 assert.deepEqual(normalizeGraphResponse({file:'A.java',line:2}),{file:'A.java',line:2});
});
test('conflicting old and canonical fields fail instead of choosing silently',()=>{
 assert.throws(()=>normalizeGraph({...wire,nodes:[{...wire.nodes[0],file:'B.java'}]}),/字段冲突/);
});
