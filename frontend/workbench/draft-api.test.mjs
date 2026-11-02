import test from 'node:test';
import assert from 'node:assert/strict';
import { CallgraphApi, supportsCollection } from '../../public/js/api.js';

test('collection recognizes Rust and Java without accepting arbitrary providers',()=>{
  assert.equal(supportsCollection({analysis:{provider:'eclipse-jdtls / LSP callHierarchy'}}),true);
  assert.equal(supportsCollection({analysis:{provider:'rust-analyzer / LSP callHierarchy'}}),true);
  assert.equal(supportsCollection({analysis:{provider:'eclipse-jdtls-unknown'}}),false);
  assert.equal(supportsCollection({analysis:{provider:'CodeRova / Java AST'}}),false);
  assert.equal(supportsCollection({analysis:{provider:'CodeRova / Rust AST'}}),false);
  assert.equal(supportsCollection({analysis:{provider:'CodeRova / unknown'}}),false);
  assert.equal(supportsCollection({}),false);
});

test('draft queue releases graph responses, serializes mutations and survives a lost response', async () => {
  const original=globalThis.fetch, calls=[];let fail=true;
  globalThis.fetch=async (_,options)=>{
    const body=JSON.parse(options.body);calls.push(body.operation.action);
    if(body.operation.action==='entry' && fail){fail=false;throw new Error('response lost');}
    return Response.json({draftId:body.operation.action==='discard'?null:'session',dirty:false,graph:{nodes:Array(100).fill({id:'node'})},result:{},changes:{}});
  };
  try {
    const api=new CallgraphApi({drafts:true});
    await api.draftOperation('graph',{action:'read'});
    assert.equal(api.queues.size,0);assert.equal(api.drafts.get('graph').graph,undefined);
    await assert.rejects(api.createEntry('graph',{}),/response lost/);
    assert.equal(api.hasUnsaved('graph'),true);assert.equal(api.editBusy,0);
    await Promise.all([api.saveDraft('graph'),api.discardDraft('graph')]);
    assert.deepEqual(calls,['read','entry','save','discard']);
    assert.equal(api.queues.size,0);assert.equal(api.drafts.size,0);
  } finally {globalThis.fetch=original;}
});

test('cancelled queued source request creates no draft session', async()=>{
  const original=globalThis.fetch;let requests=0;
  globalThis.fetch=async()=>{requests++;return Response.json({});};
  try {
    const api=new CallgraphApi({drafts:true}),abort=new AbortController();abort.abort();
    await assert.rejects(api.draftOperation('graph',{action:'read'},abort.signal),{name:'AbortError'});
    assert.equal(requests,0);assert.equal(api.drafts.size,0);assert.equal(api.queues.size,0);
  }finally{globalThis.fetch=original;}
});
