import test from 'node:test';
import assert from 'node:assert/strict';
import { nodeLink } from './node-link.js';
import { PathWindow } from './path-window.js';

test('node link encodes identifiers and drops unrelated actions', () => {
  const url = new URL(nodeLink('http://localhost:4324/?collect=1&view=projects#old', '事务', 'a&b #c'));
  assert.equal(url.searchParams.get('graph'), '事务');
  assert.equal(url.searchParams.get('node'), 'a&b #c');
  assert.equal(url.searchParams.size, 2);
  assert.equal(url.hash, '');
});
for (const direction of ['outgoing', 'incoming']) test(`reveal opens a collapsed ${direction} path`, () => {
  const edges = [{id:'ab',from:'a',to:'b'},{id:'bc',from:'b',to:'c'},{id:'ca',from:'c',to:'a'}];
  const view = new PathWindow({root:'a',analysis:{direction},nodes:['a','b','c'].map(id=>({id,label:id})),edges});
  view.reset(1, 'nodes');
  const id = view.reveal(direction === 'incoming' ? 'b' : 'c');
  assert.equal(view.nodes.get(id).sourceId, direction === 'incoming' ? 'b' : 'c');
  assert.equal(view.visible.size, 3);
  assert.equal(view.reveal('absent'), null);
});
