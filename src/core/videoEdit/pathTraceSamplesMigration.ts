/*
 * 剪辑内容 79 → 80：路径追踪采样数省略时的缺省值从 256 改为 64（4K 下一帧从约一分钟降到约十秒，与 256 的差肉眼几乎分不出）。
 * 旧作品里成片已选路径追踪、又没写采样数的序列，按旧含义写实为 256，打开后成片画面不变；
 * 没选路径追踪的序列采样数不起作用，原样保留，日后改成路径追踪时按新缺省。
 * 旧程序同样把省略读成 256，而且能在新版本戳下改写保存，所以最低可读版本随之提高（剪辑 80、录制会话 84）。
 * 纯函数，不改输入；主进程也会引用，只用相对路径导入。
 */
type Json = Record<string, unknown>
const isObject = (value: unknown): value is Json => Boolean(value) && typeof value === 'object' && !Array.isArray(value)

const LEGACY_DEFAULT_SAMPLES = 256

function pinSequence(sequence: unknown): unknown {
  if (!isObject(sequence) || !isObject(sequence.spaceRender)) return sequence
  const render = sequence.spaceRender
  if (render.finalRenderer !== 'pathTrace' || render.pathTraceSamples !== undefined) return sequence
  return { ...sequence, spaceRender: { ...render, pathTraceSamples: LEGACY_DEFAULT_SAMPLES } }
}

export function migrateVideoEditPathTraceSamples(content: unknown): unknown {
  if (!isObject(content) || !Array.isArray(content.sequences)) return structuredClone(content)
  return structuredClone({ ...content, sequences: content.sequences.map(pinSequence) })
}

/** 录屏等文档里嵌着的剪辑快照（format 为 henji-video-project 的对象，任意深度）同样写实。 */
export function migrateEmbeddedVideoEditPathTraceSamples(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(migrateEmbeddedVideoEditPathTraceSamples)
  if (!isObject(value)) return value
  if (value.format === 'henji-video-project') return migrateVideoEditPathTraceSamples(value)
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, migrateEmbeddedVideoEditPathTraceSamples(item)]))
}
