export const IMAGE_EDIT_RESOURCE_ID_PATTERN_V3 = /^sha256:[a-f0-9]{64}$/;

const MAX_RESOURCE_SCAN_DEPTH_V3 = 80;
const MAX_RESOURCE_SCAN_VALUES_V3 = 1_000_000;

/**
 * 枚举 JSON 权威状态里的内容寻址引用。效果参数也可能持有资源，所以不能只扫描
 * 当前已知图层字段；同时用深度和节点数上限约束来自 IPC/包文件的恶意输入。
 */
export function collectImageEditJsonResourceIdsV3(
  value: unknown,
  additionalResourceIds: readonly string[] = [],
): string[] {
  const refs = new Set<string>();
  const visited = new WeakSet<object>();
  let visitedValues = 0;

  const add = (resourceId: string): void => {
    if (!IMAGE_EDIT_RESOURCE_ID_PATTERN_V3.test(resourceId)) {
      throw new Error(`图片编辑资源引用无效：${resourceId}`);
    }
    refs.add(resourceId);
  };
  const visit = (entry: unknown, depth: number): void => {
    visitedValues += 1;
    if (visitedValues > MAX_RESOURCE_SCAN_VALUES_V3 || depth > MAX_RESOURCE_SCAN_DEPTH_V3) {
      throw new Error('图片编辑资源引用扫描超限');
    }
    if (typeof entry === 'string') {
      if (IMAGE_EDIT_RESOURCE_ID_PATTERN_V3.test(entry)) refs.add(entry);
      return;
    }
    if (!entry || typeof entry !== 'object' || visited.has(entry)) return;
    visited.add(entry);
    if (Array.isArray(entry)) {
      for (const child of entry) visit(child, depth + 1);
      return;
    }
    for (const child of Object.values(entry)) visit(child, depth + 1);
  };

  visit(value, 0);
  additionalResourceIds.forEach(add);
  return [...refs].sort();
}
