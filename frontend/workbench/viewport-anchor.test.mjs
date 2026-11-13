import assert from 'node:assert/strict';
import {viewportAnchor} from './viewport-anchor.js';
let rect={left:320,top:200,width:800,height:600};
const container={getBoundingClientRect:()=>({...rect})};
function camera(){return {point:[400,300],size:[800,600],resizes:0,
 getViewportByCanvas(){return [...this.point];},
 resize(){this.resizes++;this.point=this.point.map((v,i)=>v+([rect.width,rect.height][i]-this.size[i])/2);this.size=[rect.width,rect.height];},
 translateBy(delta){this.point=this.point.map((v,i)=>v+delta[i]);}};}
const anchor=viewportAnchor(container),view=camera();anchor.reset(view);
const screen=()=>view.point.map((v,i)=>v+[rect.left,rect.top][i]);
const original=screen();
rect={left:420,top:220,width:700,height:580};anchor.update(view,false);
assert.deepEqual(screen(),original);assert.equal(view.resizes,0);
anchor.update(view);assert.deepEqual(screen(),original);
view.translateBy([40,-30]);const panned=screen();
rect={left:0,top:150,width:1200,height:650};anchor.update(view);
assert.deepEqual(screen(),panned);
const fresh=camera();anchor.reset(fresh);anchor.update(fresh,false);
assert.deepEqual(fresh.point,[400,300]);
console.log('Viewport anchor: drag, resize center shift, vertical layout, explicit pan and new renderer PASS');
