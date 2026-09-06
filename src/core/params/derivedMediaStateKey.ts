export const DERIVED_MEDIA_STATE_PREFIX = '__henjiDerivedMediaAuthoring__'

/** 派生媒体编辑文档的应用保留键，不属于供应商请求。 */
export function derivedMediaStateKey(paramId: string): string {
  return `${DERIVED_MEDIA_STATE_PREFIX}${paramId}`
}
