import test from 'node:test';
import assert from 'node:assert/strict';
import { symbolPresentation, isImplementationCandidate } from '../../public/js/api.js';
import { edgeLanes } from './edge-lanes.js';
import { callMeaning, callReading } from './call-reading.js';

test('type facts are optional, language-neutral and do not replace state colors', () => {
  assert.equal(symbolPresentation({}).badge, '');
  for (const [ownerKind,badge] of [['class','C'],['interface','I'],['abstract-class','A'],['enum','E'],['record','R']]) {
    const facts=symbolPresentation({symbol:{ownerKind,ownerName:'Example',modifiers:['static'],tags:['Entity']}});
    assert.equal(facts.badge,badge);
    assert.equal(facts.owner,'Example');
    assert.equal(facts.detail,'static · Entity');
  }
});
test('candidate links are dashed, identified and never assigned a fake call line', () => {
  const edge={id:'a',from:'declaration',to:'implementation',kind:'trait-dispatch',callSiteStatus:'omitted-nodes',line:0};
  assert.equal(isImplementationCandidate(edge),true);
  assert.equal(isImplementationCandidate({...edge,callSiteStatus:'exact'}),false);
  const [rendered]=edgeLanes([edge]);
  assert.deepEqual(rendered.style.lineDash,[5,4]);
  assert.equal(rendered.style.labelText,'');
  const [exact]=edgeLanes([{...edge,callSiteStatus:'exact',file:'Example.java',line:12}]);
  assert.deepEqual(exact.style.lineDash,[5,4]);
  assert.equal(exact.style.labelText,'');
  assert.match(callMeaning(edge),/不代表运行时/);
  assert.match(callReading([edge]).note,/选择后/);
});

test('single implementation remains a static relationship, with automatic collection explained', () => {
  const edge={id:'single',from:'declaration',to:'implementation',kind:'trait-dispatch',callSiteStatus:'omitted-nodes',label:'单一实现'};
  assert.equal(edgeLanes([edge])[0].style.labelText,'');
  assert.match(callMeaning(edge),/按采集预算继续/);
  assert.match(callMeaning(edge),/不代表运行时/);
});
