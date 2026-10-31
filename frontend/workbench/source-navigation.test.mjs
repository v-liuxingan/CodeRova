import test from 'node:test';
import assert from 'node:assert/strict';
import { sourceNavigation } from './source-navigation.js';
class Control extends EventTarget {
  setAttribute(key,value) { this[key]=value; }
  click() { this.dispatchEvent(new Event('click')); }
}
const graph={nodes:[{id:'node',file:'main.rs',line:1}],edges:[{id:'exact',file:'main.rs',line:2},{id:'abstract',callSiteStatus:'omitted-nodes'}]};
const settle=()=>new Promise(resolve=>setImmediate(resolve));
test('manual and click navigation both use the selected IDEA editor', async()=>{
 const toggle=new Control(),button=new Control(),editor=new Control(),launches=[];
 const navigation=sourceNavigation({toggle,button,editor,notify(){},api:{async buildSourceLink(){return {uri:'vscode://test',path:'E:/Main.java',line:12,column:3};}},launch:u=>launches.push(u)});
 editor.value='idea';editor.dispatchEvent(new Event('change'));
 navigation.select(graph,'graph','node','node');button.click();await settle();
 toggle.click();navigation.select(graph,'graph','edge','exact',true);await settle();
 assert.deepEqual(launches,['idea://open?file=E%3A%2FMain.java&line=12&column=3','idea://open?file=E%3A%2FMain.java&line=12&column=3']);
});
test('external opening is opt-in and ignores non-exact relations',async()=>{
 const toggle=new Control(),button=new Control(),requests=[],launches=[];
 const navigation=sourceNavigation({toggle,button,notify(){},api:{async buildSourceLink(...args){requests.push(args);return {uri:'vscode://test'};}},launch:u=>launches.push(u)});
 navigation.select(graph,'graph','node','node',true);
 assert.equal(requests.length,0);
 button.click();await settle();assert.deepEqual(requests[0],['graph','node','node']);
 toggle.click();navigation.select(graph,'graph','edge','abstract',true);await settle();
 assert.equal(button.hidden,true);assert.equal(requests.length,1);
 navigation.select(graph,'graph','edge','exact',true);await settle();
 assert.deepEqual(requests[1],['graph','edge','exact']);assert.equal(launches.length,2);
});
test('late responses cannot launch after selection is cleared',async()=>{
 const toggle=new Control(),button=new Control(),launches=[];let resolve;
 const navigation=sourceNavigation({toggle,button,notify(){},api:{buildSourceLink(){return new Promise(r=>{resolve=r;});}},launch:u=>launches.push(u)});
 navigation.select(graph,'graph','node','node');button.click();navigation.clear();
 resolve({uri:'vscode://old'});await settle();assert.deepEqual(launches,[]);assert.equal(button.hidden,true);
});
