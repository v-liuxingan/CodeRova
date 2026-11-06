import { CubicVertical, CubicHorizontal, ExtensionCategory, register } from '@antv/g6';
import { directionalPath } from './directional-path.js';
// Anchor labels to the exploration frontier: incoming graphs use the caller
// port so many callers do not stack their labels at the shared callee.
function entryLabel(edge, attributes, style, horizontal) {
  if (!style || edge.sourceNode === edge.targetNode) return style;
  const [source, target] = edge.getEndpoints(attributes);
  const atSource = attributes.callSiteAtSource;
  const anchor = atSource ? source : target;
  return { ...style, textAlign: atSource ? 'left' : 'right', textBaseline: 'middle',
    transform: [['translate', anchor[0] + (atSource ? 1 : -1) * (horizontal ? 14 : 10),
      anchor[1] + (atSource && !horizontal ? 18 : horizontal ? -12 : -18)]] };
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
