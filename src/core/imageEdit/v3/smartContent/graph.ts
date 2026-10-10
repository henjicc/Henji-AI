import type { ImageEditDocumentV3 } from '../documentTypes';
import type { ImageEditLayerV3 } from '../layerTypes';
import type { ImageEditSmartLayerV3 } from './types';

export function listImageEditSmartInstancesV3(layers: readonly ImageEditLayerV3[]): ImageEditSmartLayerV3[] {
  const output: ImageEditSmartLayerV3[] = [];
  const pending = [...layers];
  while (pending.length) {
    const layer = pending.pop()!;
    if (layer.type === 'smart') output.push(layer);
    if (layer.type === 'group') pending.push(...layer.children);
  }
  return output;
}

/** Iterative preflight runs before recursive schemas/codecs, including non-JSON cyclic objects. */
export function assertImageEditSmartGraphV3(input: unknown): void {
  type Visit = { value: unknown; ancestors: ReadonlySet<string>; leave?: boolean };
  const pending: Visit[] = [{ value: input, ancestors: new Set() }];
  const active = new WeakSet<object>();
  while (pending.length) {
    const { value, ancestors, leave } = pending.pop()!;
    if (!value || typeof value !== 'object') continue;
    if (leave) { active.delete(value); continue; }
    if (active.has(value)) throw new Error('智能对象内容形成循环，请选择不包含当前文档的来源');
    active.add(value);
    pending.push({ value, ancestors, leave: true });
    if (Array.isArray(value)) {
      for (const child of value) pending.push({ value: child, ancestors });
      continue;
    }
    const record = value as Record<string, unknown>;
    let next = ancestors;
    if (Array.isArray(record.layers) && typeof record.id === 'string') {
      if (ancestors.has(record.id)) throw new Error('智能对象不能引用当前文档或它的上级内容');
      next = new Set([...ancestors, record.id]);
    }
    if (record.type === 'smart' && record.content && typeof record.content === 'object') {
      const content = record.content as Record<string, unknown>;
      const origin = content.origin as Record<string, unknown> | null;
      const originId = typeof origin?.id === 'string' ? decodeURIComponent(origin.id.replace(/^v3:|^image-edit-v3:/, '')) : null;
      if (origin?.kind === 'image_edit.document' && originId !== null && next.has(originId)) {
        throw new Error('智能对象来源不能指向当前文档或它的上级内容');
      }
    }
    for (const child of Object.values(record)) pending.push({ value: child, ancestors: next });
  }
}

export function assertImageEditSmartInstancesConsistentV3(document: ImageEditDocumentV3): void {
  const pending = [document];
  while (pending.length) {
    const current = pending.pop()!;
    const sources = new Map<string, string>();
    for (const layer of listImageEditSmartInstancesV3(current.layers)) {
      const signature = JSON.stringify([layer.content, layer.source, layer.tiles]);
      const previous = sources.get(layer.content.id);
      if (previous !== undefined && previous !== signature) throw new Error('同一智能对象来源的实例内容不一致');
      sources.set(layer.content.id, signature);
      pending.push(layer.content.document);
    }
  }
}
