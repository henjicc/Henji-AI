import type { CodeEdits } from '@/core/videoEdit/codeEdits'

type CodeEdit = CodeEdits[string]
/** 修改记录的悬停说明：谁、什么时候改的（月-日 时:分）。 */
export function codeEditNote(edit: CodeEdit): string {
  const at = new Date(edit.at), pad = (value: number): string => String(value).padStart(2, '0')
  return `${edit.by === 'user' ? '用户手动改过' : '助手改过'} · ${pad(at.getMonth() + 1)}-${pad(at.getDate())} ${pad(at.getHours())}:${pad(at.getMinutes())}`
}
/** 几条记录里最近的一条；都没有（旧存档）时用 `fallback`。 */
export function latestCodeEditNote(edits: CodeEdits | undefined, keys: readonly string[], fallback = '已改'): string {
  const latest = keys.flatMap(key => edits && Object.hasOwn(edits, key) ? [edits[key]] : []).sort((a, b) => b.at - a.at)[0]
  return latest ? codeEditNote(latest) : fallback
}
