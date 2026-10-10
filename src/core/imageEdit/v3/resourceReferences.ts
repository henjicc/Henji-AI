import { creativeIntentLiveResources, type CreativeIntents } from '../../creativeIntent/persistence';
import { IMAGE_EDIT_DOCUMENT_VERSION_V3 } from './documentTypes';

export const IMAGE_EDIT_RESOURCE_ID_PATTERN_V3 = /^sha256:[a-f0-9]{64}$/;

/** Identify the authoritative document field, never a same-named arbitrary effect parameter. */
export function isImageEditDocumentResourceContainerV3(value:unknown):boolean {
  return Boolean(value&&typeof value==='object'&&'version'in value&&value.version===IMAGE_EDIT_DOCUMENT_VERSION_V3
    &&'layers'in value&&Array.isArray(value.layers)&&'geometry'in value&&'color'in value);
}

/**
 * 枚举 JSON 权威状态里的内容寻址引用。效果参数也可能持有资源，所以不能只扫描
 * 当前已知图层字段；迭代遍历避免把文档层级和素材数量当成产品上限。
 */
export function collectImageEditJsonResourceIdsV3(
  value: unknown,
  additionalResourceIds: readonly string[] = [],
): string[] {
  const refs = new Set<string>();
  const visited = new WeakSet<object>();

  const add = (resourceId: string): void => {
    if (!IMAGE_EDIT_RESOURCE_ID_PATTERN_V3.test(resourceId)) {
      throw new Error(`图片编辑资源引用无效：${resourceId}`);
    }
    refs.add(resourceId);
  };
  const pending: unknown[] = [value];
  while (pending.length) {
    const entry = pending.pop();
    if (typeof entry === 'string') {
      if (IMAGE_EDIT_RESOURCE_ID_PATTERN_V3.test(entry)) refs.add(entry);
      continue;
    }
    if (!entry || typeof entry !== 'object' || visited.has(entry)) continue;
    visited.add(entry);
    if (Array.isArray(entry)) {
      for (const child of entry) pending.push(child);
      continue;
    }
    for (const [key, child] of Object.entries(entry)) {
      // Draft digests describe input, not files. Only its authoritative resource directory is a live root.
      if (key === 'creativeIntents' && isImageEditDocumentResourceContainerV3(entry) || key === 'intents' && 'type' in entry && entry.type === 'document.set-creative-intents') {
        for (const resource of creativeIntentLiveResources([child as CreativeIntents | undefined])) add(resource.resourceId);
      } else pending.push(child);
    }
  }
  additionalResourceIds.forEach(add);
  return [...refs].sort();
}
