import { CubicVertical, CubicHorizontal, ExtensionCategory, register } from '@antv/g6';
import { directionalPath } from './directional-path.js';
// Anchor to the actual target port, not a percentage of the curve length:
// long fan-outs must keep their call-site label next to the destination too.
function entryLabel(edge, attributes, style, horizontal) {
  if (!style || edge.sourceNode === edge.targetNode) return style;
  const [, target] = edge.getEndpoints(attributes);
  return { ...style, textAlign: 'right', textBaseline: 'middle',
    transform: [['translate', target[0] - (horizontal ? 14 : 10), target[1] - (horizontal ? 12 : 18)]] };
}
class AdaptiveVertical extends CubicVertical {
  getLabelStyle(attributes) { return entryLabel(this, attributes, super.getLabelStyle(attributes), false); }
  getKeyPath(attributes) { return directionalPath(...this.getEndpoints(attributes), false, attributes.routeFraction); }
}
class AdaptiveHorizontal extends CubicHorizontal {
  getLabelStyle(attributes) { return entryLabel(this, attributes, super.getLabelStyle(attributes), true); }
  getKeyPath(attributes) { return directionalPath(...this.getEndpoints(attributes), true, attributes.routeFraction); }
}
register(ExtensionCategory.EDGE, 'adaptive-vertical', AdaptiveVertical);
register(ExtensionCategory.EDGE, 'adaptive-horizontal', AdaptiveHorizontal);
