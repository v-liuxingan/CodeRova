import test from 'node:test';
import assert from 'node:assert/strict';
import { editorLink } from './editor-link.js';

test('IDEA links preserve paths and positions without query injection', () => {
  for (const [path, expected] of [
    ['E:\\源码 a&b#c?\\Main.java', 'E:/源码 a&b#c?/Main.java'],
    ['\\\\?\\E:\\src\\Main.java', 'E:/src/Main.java'],
    ['\\\\?\\UNC\\host\\share\\Main.java', '//host/share/Main.java'],
    ['/home/me/src/Main.java', '/home/me/src/Main.java'],
  ]) {
    const uri = new URL(editorLink({path, line:42, column:9}, 'idea'));
    assert.equal(uri.protocol, 'idea:');
    assert.equal(uri.hostname, 'open');
    assert.deepEqual([...uri.searchParams], [['file', expected], ['line','42'], ['column','9']]);
  }
});
test('IDEA rejects missing positions; VS Code uses the original validated URI', () => {
  assert.throws(() => editorLink({path:'a.java', line:0, column:1}, 'idea'));
  assert.throws(() => editorLink({uri:'vscode://test'}, 'idea'));
  assert.equal(editorLink({uri:'vscode://test'}, 'vscode'), 'vscode://test');
});
