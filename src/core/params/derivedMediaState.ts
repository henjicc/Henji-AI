import type { ParamDef } from '@/core/types'

const DERIVED_MEDIA_STATE_PREFIX = '__henjiDerivedMediaAuthoring__'

function firstNonEmptyString(value: DynamicValue): string | null {
  if (!Array.isArray(value)) return null
  const source = value.find((item) => typeof item === 'string' && item.trim().length > 0)
  return typeof source === 'string' ? source : null
}
function readSourceRef(value: DynamicValue): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const sourceRef = (value as DynamicValueMap).sourceRef
  return typeof sourceRef === 'string' && sourceRef.length > 0 ? sourceRef : null
}

/** 派生媒体编辑文档在参数状态中的保留键；不会进入供应商请求。 */
export function derivedMediaStateKey(paramId: string): string {
  return `${DERIVED_MEDIA_STATE_PREFIX}${paramId}`
}

/**
 * 解析派生媒体声明引用的前置素材。
 *
 * 生成页实时图片位于 uploadedImages，画布节点位于 images；uploadedFilePaths 是
 * 生成提交边界的兼容兜底。顺序与两个编辑入口实际拿到的源保持一致，避免同一张图
 * 因展示 URL / 本地路径形态不同被误判为来源变化。
 */
export function resolveDerivedMediaSource(
  param: ParamDef,
  values: DynamicValueMap,
): string | null {
  if (param.type !== 'image-upload' || param.derivedMediaAuthoring?.source.kind !== 'first-image') {
    return null
  }
  return firstNonEmptyString(values.uploadedImages)
    ?? firstNonEmptyString(values.images)
    ?? firstNonEmptyString(values.uploadedFilePaths)
}

/**
 * 前置素材被删除或替换时，使旧遮罩与编辑文档一起失效。
 * 没有编辑文档的旧版上传值保持兼容；它无法判断来源关系，只能在首次重新绘制后
 * 进入完整的来源追踪闭环。
 */
export function reconcileDerivedMediaState(
  schema: readonly ParamDef[],
  values: DynamicValueMap,
): DynamicValueMap {
  let next = values

  for (const param of schema) {
    if (param.type !== 'image-upload' || !param.derivedMediaAuthoring) continue

    const stateKey = derivedMediaStateKey(param.id)
    const document = next[stateKey]
    const documentSource = readSourceRef(document)
    const source = resolveDerivedMediaSource(param, next)
    const hasDocument = document !== undefined && document !== null
    const shouldInvalidate = hasDocument && (!source || documentSource !== source)

    if (!shouldInvalidate) continue
    if (next === values) next = { ...values }
    next[param.id] = param.default
    delete next[stateKey]
  }

  return next
}

/** 删除所有应用专属编辑文档，保证 Electron/SDK 只收到规范媒体参数。 */
export function stripDerivedMediaState(values: DynamicValueMap): DynamicValueMap {
  const keys = Object.keys(values).filter((key) => key.startsWith(DERIVED_MEDIA_STATE_PREFIX))
  if (keys.length === 0) return values

  const next = { ...values }
  for (const key of keys) delete next[key]
  return next
}
