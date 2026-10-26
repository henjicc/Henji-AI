/*
 * 剪辑内容 30 → 31：序列 motionBlur 从“片段变换动画的模糊开关”改为整条序列的总开关（同时管代码图层的位姿模糊）。
 * 旧版里关着的序列：代码图层照常模糊、片段变换不模糊。迁移成打开总开关，并给有变换动画的片段写 motionBlur:false，画面不变。
 * 纯函数，不改输入；主进程也会引用，只用相对路径导入。
 */
const TRANSFORM_KEYS = ['x', 'y', 'scale', 'rotation', 'anchorX', 'anchorY']

type Json = Record<string, unknown>
const isObject = (value: unknown): value is Json => Boolean(value) && typeof value === 'object' && !Array.isArray(value)

function hasTransformAnimation(clip: Json): boolean {
  const curves = clip.curves
  return isObject(curves) && TRANSFORM_KEYS.some(key => Array.isArray(curves[key]) && (curves[key] as unknown[]).length > 0)
}

export function migrateVideoEditMotionBlurMaster(content: unknown): unknown {
  if (!isObject(content) || !Array.isArray(content.sequences)) return content
  return {
    ...content,
    sequences: content.sequences.map(sequence => {
      if (!isObject(sequence) || sequence.motionBlur === true) return sequence
      const clips = Array.isArray(sequence.clips) ? sequence.clips.map(clip => isObject(clip) && hasTransformAnimation(clip) ? { ...clip, motionBlur: false } : clip) : sequence.clips
      return { ...sequence, motionBlur: true, ...(clips === undefined ? {} : { clips }) }
    }),
  }
}

/** 录屏等文档里嵌着的剪辑快照（format 为 henji-video-project 的对象，任意深度）同样迁移。 */
export function migrateEmbeddedVideoEditMotionBlurMaster(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(migrateEmbeddedVideoEditMotionBlurMaster)
  if (!isObject(value)) return value
  if (value.format === 'henji-video-project') return migrateVideoEditMotionBlurMaster(value)
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, migrateEmbeddedVideoEditMotionBlurMaster(item)]))
}
