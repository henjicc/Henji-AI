/*
 * 生成记录参数里的 `__resultUrl`：供应商结果地址，按输出顺序存成字符串数组（3.6 起不再用 `|||` 拼接）。
 * 本地副本缺失时用它回退。不是字符串数组（含旧版拼接串）一律当没有。
 */

export const STORED_RESULT_URLS_KEY = '__resultUrl'

export function readStoredResultUrls(params: Readonly<Record<string, unknown>> | null | undefined): string[] {
  const value = params?.[STORED_RESULT_URLS_KEY]
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string').map((item) => item.trim()).filter(Boolean)
}
