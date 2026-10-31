export function directionalPath(source, target, horizontal = false, routeFraction = .5) {
  const [a,b] = horizontal ? [1,0] : [0,1];
  const cross = target[a]-source[a], along = target[b]-source[b];
  const point=(x,y)=>horizontal?[y,x]:[x,y];
  // A separate cubic per destination is essential: rounded orthogonal routes
  // share a long straight spine when a caller has several distant children.
  // Keep ordinary bends symmetric; wide curves can use caller routing channels.
  const fraction=along>0 && Math.abs(cross)>=along*3 ? routeFraction : .5;
  const mid=source[b]+along*fraction;
  return [['M',...source],['C',...point(source[a],mid),...point(target[a],mid),...target]];
}
