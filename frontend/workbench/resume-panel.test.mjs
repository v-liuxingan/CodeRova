import test from 'node:test';
import assert from 'node:assert/strict';
import {resumePanel} from './resume-panel.js';

test('status retries are read-only and stale responses cannot overwrite another graph or task', async()=>{
  const original={document:globalThis.document,localStorage:globalThis.localStorage,setTimeout:globalThis.setTimeout,clearTimeout:globalThis.clearTimeout};
  const elements=new Map(), timers=new Map(), requests=[];let serial=0;
  const element=id=>{
    if(!elements.has(id))elements.set(id,{dataset:{},hidden:false,textContent:'',setAttribute(){},focus(){},querySelector(){return {focus(){}};}});
    return elements.get(id);
  };
  globalThis.document={getElementById:element};globalThis.localStorage={};
  globalThis.setTimeout=(fn,delay)=>{const id=++serial;timers.set(id,{fn,delay});return id;};
  globalThis.clearTimeout=id=>timers.delete(id);
  const api={analysisTask:(slug,method='GET')=>new Promise((resolve,reject)=>requests.push({slug,method,resolve,reject}))};
  const flush=()=>new Promise(resolve=>setImmediate(resolve));
  try {
    const panel=resumePanel(api,async()=>{}), graph={analysis:{provider:'rust-analyzer',pendingNodes:[]}};
    panel.setGraph('first',graph);
    requests[0].reject(new Error('offline'));await flush();
    assert.match(element('resume-status').textContent,/正在重试/);assert.equal(timers.size,1);
    const timer=[...timers.values()][0];timers.clear();timer.fn();
    assert.equal(requests[1].method,'GET');
    panel.setGraph('second',graph);
    requests[1].resolve({status:'finished',addedNodes:99});await flush();
    assert.notEqual(element('active-collection').dataset.state,'finished');
    requests[2].resolve({status:'running',addedNodes:1});await flush();
    panel.watch();const older=requests.at(-1);
    panel.started({status:'running',addedNodes:0});const newer=requests.at(-1);
    older.resolve({status:'finished',addedNodes:99});await flush();
    assert.equal(element('active-collection').dataset.state,'running');
    newer.resolve({status:'running',addedNodes:2});await flush();
    const stopping=element('resume-stop').onclick();const stop=requests.at(-1);
    assert.equal(stop.method,'DELETE');
    stop.reject(new Error('response lost'));await stopping;
    const recovery=requests.at(-1);assert.equal(recovery.method,'GET');
    recovery.resolve({status:'stopped',addedNodes:2});await flush();
    assert.equal(element('active-collection').dataset.state,'stopped');
    assert.equal(element('resume-stop').hidden,true);
    assert.equal(timers.size,0);
    assert.equal(requests.filter(r=>r.method==='DELETE').length,1);
  } finally {Object.assign(globalThis,original);}
});
