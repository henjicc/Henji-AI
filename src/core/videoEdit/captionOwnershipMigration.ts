type RecordValue = Record<string, unknown>
const isRecord = (value: unknown): value is RecordValue => Boolean(value) && typeof value === 'object' && !Array.isArray(value)

/** 字幕归剪辑所有：仅退役链接标记，保留文字、时间、样式、译文及逐词参考。 */
export function migrateVideoEditCaptionCollection(value: unknown): unknown {
  if (!isRecord(value) || !Array.isArray(value.captions)) return value
  return { ...value, captions: value.captions.map(caption => {
    if (!isRecord(caption)) return caption
    const { linkedCaptionId: _linkedCaptionId, ...owned } = caption
    return owned
  }) }
}

export function migrateVideoEditCaptionOwnership(value: unknown): unknown {
  if (!isRecord(value) || !Array.isArray(value.sequences)) return value
  return { ...value, sequences: value.sequences.map(migrateVideoEditCaptionCollection) }
}

/** 录制只在脚本基线里嵌入剪辑快照，不触碰作者参数等任意 JSON 中的同名字段。 */
export function migrateRecordingCaptionOwnership(value: unknown): unknown {
  if (!isRecord(value) || !isRecord(value.scriptCapture) || !Array.isArray(value.scriptCapture.baselines)) return value
  return { ...value, scriptCapture: { ...value.scriptCapture, baselines: value.scriptCapture.baselines.map(baseline =>
    isRecord(baseline) ? { ...baseline, content: migrateVideoEditCaptionOwnership(baseline.content) } : baseline,
  ) } }
}
