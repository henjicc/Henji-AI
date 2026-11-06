/*
 * 剪辑内容 74 → 75：修改记录 edits 新增键 `check`（助手检查过手改的时刻，之后用户再手改的才提示交给助手检查）。
 * 旧作品里已有的手改都当作检查过：有修改记录、还没有 check 的片段补一条，时刻取已有记录里最晚的那条，打开旧作品不会冒出一堆待检查。
 * 旧程序不认识 check 也只是原样保留，最低可读版本不变。纯函数，不改输入；主进程也会引用，只用相对路径导入。
 */
type Json = Record<string, unknown>
const isObject = (value: unknown): value is Json => Boolean(value) && typeof value === 'object' && !Array.isArray(value)

function markClip(clip: unknown): unknown {
  if (!isObject(clip) || !isObject(clip.edits) || Object.hasOwn(clip.edits, 'check')) return clip
  const times = Object.values(clip.edits).flatMap(edit => isObject(edit) && typeof edit.at === 'number' ? [edit.at] : [])
  if (!times.length) return clip
  return { ...clip, edits: { ...clip.edits, check: { by: 'assistant', at: Math.max(...times) } } }
}

export function migrateVideoEditCodeEditChecks(content: unknown): unknown {
  if (!isObject(content) || !Array.isArray(content.sequences)) return content
  return { ...content, sequences: content.sequences.map(sequence => isObject(sequence) && Array.isArray(sequence.clips) ? { ...sequence, clips: sequence.clips.map(markClip) } : sequence) }
}

/** 录屏等文档里嵌着的剪辑快照（format 为 henji-video-project 的对象，任意深度）同样补检查记录。 */
export function migrateEmbeddedVideoEditCodeEditChecks(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(migrateEmbeddedVideoEditCodeEditChecks)
  if (!isObject(value)) return value
  if (value.format === 'henji-video-project') return migrateVideoEditCodeEditChecks(value)
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, migrateEmbeddedVideoEditCodeEditChecks(item)]))
}
