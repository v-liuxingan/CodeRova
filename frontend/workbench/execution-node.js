import { symbolPresentation } from '../../public/js/api.js';
import { nodeTone } from './node-tone.js';
import { ExtensionCategory, Label, Rect, register } from '@antv/g6';

// Canvas shapes share G6's hit testing and drag behavior; no per-node DOM overlays.
class ExecutionNode extends Rect {
  render(attributes = this.parsedAttributes, container = this) {
    super.render(attributes, container);
    const text = (key, value, y, options = {}) => this.upsert(key, Label, {
      x: -134, y, text: value, fill: attributes.cardText,
      fontFamily: 'Segoe UI, Microsoft YaHei, sans-serif', fontSize: 12,
      textAlign: 'left', textBaseline: 'top', wordWrap: true,
      wordWrapWidth: 268, maxLines: 1, textOverflow: 'ellipsis',
      background: false, opacity: attributes.opacity ?? 1, fillOpacity: attributes.cardMuted ? 0.5 : 1, ...options,
    }, container);
    const top = -attributes.size[1] / 2 + 14;
    this.upsert('type-badge', Label, attributes.cardBadge ? {
      x: -126, y: top + 7, text: attributes.cardBadge,
      fontFamily: 'Segoe UI, sans-serif', fontSize: 10, fontWeight: 700,
      textAlign: 'center', textBaseline: 'middle', fill: attributes.cardAccent,
      background: true, backgroundWidth: 17, backgroundHeight: 17,
      backgroundRadius: 4, backgroundFill: attributes.cardControlFill,
      backgroundStroke: attributes.stroke, backgroundLineWidth: 1,
      opacity: attributes.opacity ?? 1, fillOpacity: attributes.cardMuted ? 0.5 : 1,
    } : false, container);
    text('category', attributes.cardCategory, top, { x: attributes.cardBadge ? -110 : -134, wordWrapWidth: attributes.cardBadge ? 244 : 268,
      fill: attributes.cardAccent, fontWeight: 600, fontSize: 11,
    });
    const methodY = top + 24 + (attributes.cardClass ? 20 : 0);
    if (attributes.cardClass) text('class', attributes.cardClass, top + 24, { fontSize: 12 });
    else this.upsert('class', Label, false, container);
    text('title', attributes.cardTitle, methodY, {
      fill: attributes.cardMuted ? attributes.cardText : attributes.cardTitleColor, fontFamily: 'Consolas, Microsoft YaHei, monospace',
      fontWeight: 600, fontSize: 15,
    });
    if (attributes.cardPurpose) text('purpose', attributes.cardPurpose, methodY + 28);
    else this.upsert('purpose', Label, false, container);
    if (attributes.cardMore) text('more', attributes.cardMore, attributes.size[1] / 2 - 25, { fill: attributes.cardAccent, fontSize: 11 });
    else this.upsert('more', Label, false, container);
    const both = attributes.cardExpand && attributes.cardCollapse;
    for (const [action, enabled, title, offset] of [
      ['expand', attributes.cardExpand, '+', both ? -16 : 0],
      ['collapse', attributes.cardCollapse, '−', both ? 16 : 0],
    ]) {
      const horizontal = attributes.cardDirection === 'LR';
      const shape = this.upsert(`action-${action}`, Label, enabled ? {
        x: horizontal ? 166 : offset,
        y: horizontal ? offset : attributes.size[1] / 2 + 14,
        text: title, fontSize: 18, fontFamily: 'Segoe UI, sans-serif',
        textAlign: 'center', textBaseline: 'middle', wordWrap: false,
        fill: attributes.cardText, cursor: 'pointer', padding: 0,
        background: true, backgroundWidth: 26, backgroundHeight: 26,
        backgroundFill: attributes.cardControlFill, backgroundOpacity: 1,
        backgroundStroke: attributes.stroke, backgroundLineWidth: 1,
        backgroundRadius: 13, opacity: attributes.opacity ?? 1,
      } : false, container);
      if (shape) shape.branchAction = action;
    }


  }
}
register(ExtensionCategory.NODE, 'execution-card', ExecutionNode);

const kinds = { function: '函数', method: '方法', closure: '闭包', trait: '接口', struct: '结构体', module: '模块', process: '进程', 'remote-service': '远程服务' };
export function executionCards(graph) {
  const pending = new Set(graph.analysis?.pendingNodes || []);
  return graph.nodes.map(n => {
    // Only method-qualified names identify an owner. Module paths of free
    // functions must not be presented as classes.
    const provisional = (n.sourceId || n.id).startsWith('entry-position-');
    const filename = n.file?.split(/[\\/]/).pop() || '源码入口';
    const qualified = n.kind === 'method' ? n.label.match(/^(.+)::([^:]+)$/) : null;
    const semantic = symbolPresentation(n);
    const className = semantic.owner || qualified?.[1] || '';
    const description = provisional ? `第 ${n.line} 行 · 采集时确认函数` : graph.analysis ? '' : (n.role || '').trim();
    return { id: n.id, data: {
      label: provisional ? filename : qualified?.[2] || n.label, className, badge: semantic.badge,
      sourceId: n.sourceId || n.id, pathReference: Boolean(n.pathReference), pathCycle: Boolean(n.pathCycle),
      height: 82 + (className ? 20 : 0) + (description ? 24 : 0),
      pending: pending.has(n.sourceId || n.id),
      tone: nodeTone(n, graph.root, pending.has(n.sourceId || n.id)),
      category: provisional ? '源码入口' : n.role?.startsWith('人工采集入口') ? '人工入口 · 已确认符号' : [semantic.type, semantic.type && ['struct','trait'].includes(n.kind) ? '' : kinds[n.kind] || n.kind || '符号', semantic.detail].filter(Boolean).join(' · '),
      purpose: description,
    } };
  });
}

export function branchAction(event) {
  for (let shape = event.originalTarget; shape && shape !== event.target; shape = shape.parentNode) {
    if (shape.branchAction) return shape.branchAction;
  }
  return null;
}
