import test from 'node:test';
import assert from 'node:assert/strict';
import {nodeTone} from './node-tone.js';

test('owner types remain distinct at roots and pending collection boundaries', () => {
  const kinds=['class','interface','abstract-class','enum','record'];
  assert.equal(new Set(kinds.map(ownerKind=>nodeTone({id:'root',kind:'method',symbol:{ownerKind}},'root',true))).size,5);
  for(const ownerKind of kinds) assert.equal(nodeTone({id:'n',symbol:{ownerKind}},'root',false),ownerKind);
});
test('unknown owner types retain existing fallback without guessing from labels', () => {
  assert.equal(nodeTone({id:'n',kind:'method',label:'IService',symbol:{ownerKind:'unknown'}},'root',false),'method');
  assert.equal(nodeTone({id:'n',kind:'method'},'root',true),'pending');
  assert.equal(nodeTone({id:'root',kind:'function'},'root',false),'entry');
});
