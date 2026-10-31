import assert from 'node:assert/strict';
import { directionalPath } from './directional-path.js';
for(const horizontal of [false,true]) {
 const source=[0,0],target=horizontal?[150,10000]:[10000,150];
 const path=directionalPath(source,target,horizontal);
 assert.deepEqual(path.map(p=>p[0]),['M','C']);
 assert.deepEqual(path.at(-1).slice(-2),target);
 for(const segment of path) for(const value of segment.slice(1)) assert(Number.isFinite(value));
 const normal=directionalPath(source,horizontal?[200,100]:[100,200],horizontal);
 assert.equal(normal[1][0],'C');
}
console.log('Directional curves: independent cubic at every span, both directions PASS');

for(const horizontal of [false,true]) for(const width of [80,350,10000]) {
 const source=horizontal?[40,70]:[70,40];
 const end=(sign)=>horizontal?[240,70+sign*width]:[70+sign*width,240];
 for(const fraction of [.2,.5,.8]) {
  const left=directionalPath(source,end(-1),horizontal,fraction);
  const right=directionalPath(source,end(1),horizontal,fraction);
  assert.equal(left.length,right.length);
  for(let i=0;i<left.length;i++) {
   assert.equal(left[i][0],right[i][0]);
   for(let j=1;j<left[i].length;j++) {
    const crossCoordinate=horizontal?j%2===0:j%2===1;
    assert.equal(crossCoordinate?2*70-left[i][j]:left[i][j],right[i][j]);
   }
  }
 }
 const ordinary=directionalPath(source,end(1),horizontal,.2);
 if(width<200*3) assert.deepEqual(ordinary,directionalPath(source,end(1),horizontal,.8));
}
console.log('Left/right and up/down mirror geometry, translated origins and normal fan-out independent of lane offsets PASS');

// Screenshot regression: distant siblings must not reuse an orthogonal spine.
for(const horizontal of [false,true]) {
 const point=(cross,along)=>horizontal?[along,cross]:[cross,along];
 const paths=[-10000,-2000,-200,0,200,2000,10000].map(cross=>
   directionalPath(point(0,0),point(cross,150),horizontal));
 assert.equal(new Set(paths.map(JSON.stringify)).size,paths.length);
 for(const path of paths) assert.deepEqual(path.map(s=>s[0]),['M','C']);
 // Halfway through the curves, every branch has its own cross coordinate.
 const centers=paths.map(p=> {
   const i=horizontal?2:1;
   return (p[0][i]+3*p[1][i]+3*p[1][i+2]+p[1][i+4])/8;
 });
 assert.equal(new Set(centers).size,paths.length);
}
console.log('Wide sibling fan-out has distinct midpoints and no shared straight spine PASS');
