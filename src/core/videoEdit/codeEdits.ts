import { z } from 'zod'
import { jsonEqual } from '../jsonEqual'
import type { VideoEditClip } from './document'
import { CODE_ELEMENT_OVERRIDE_KEYS } from './codeElementOverrides'

export const codeEditActorSchema = z.enum(['user', 'assistant'])
export type CodeEditActor = z.infer<typeof codeEditActorSchema>
export const codeEditsSchema = z.record(z.string().min(1), z.object({ by: codeEditActorSchema, at: z.number().finite().nonnegative() }).strict())
export type CodeEdits = z.infer<typeof codeEditsSchema>

// 元素 id、效果 key 与参数键都可以含冒号：记录键按冒号分段，每段只转义 % 与冒号，常见名字仍可直接读。
const encode = (segment: string): string => segment.replace(/[%:]/g, char => char === '%' ? '%25' : '%3A')
const decode = (segment: string): string => segment.replace(/%(25|3A)/g, (_, code: string) => code === '25' ? '%' : ':')
/** 助手检查过手改的时刻也记在修改记录里（键 `check`）：此后用户再手改的才是待检查的改动。它不属于任何参数或元素。 */
export const CODE_EDIT_CHECK_KEY = 'check'
/** 修改记录的键：`param:<参数>`、`element:<元素>:<属性>`、`element:<元素>:effect:<key>:<参数|enabled>`、`element:<元素>:added:<key>`。 */
export const codeEditKey = {
  param: (parameter: string): string => `param:${encode(parameter)}`,
  element: (elementId: string, property: string): string => `element:${encode(elementId)}:${encode(property)}`,
  effect: (elementId: string, key: string, field: string): string => `element:${encode(elementId)}:effect:${encode(key)}:${encode(field)}`,
  added: (elementId: string, key: string): string => `element:${encode(elementId)}:added:${encode(key)}`,
}
/** 记录键按段解码：`[类别, 参数或元素, ...属性路径]`。 */
export function codeEditSegments(key: string): string[] { return key.split(':').map(decode) }
/** 记录属于哪个作者参数或哪个元素；按段解析，不按字符串前缀匹配。 */
export function codeEditOwner(key: string): { parameter: string } | { elementId: string } | undefined {
  const [kind, owner, ...rest] = key.split(':')
  if (owner === undefined) return undefined
  if (kind === 'param' && !rest.length) return { parameter: decode(owner) }
  if (kind === 'element' && rest.length) return { elementId: decode(owner) }
  return undefined
}

function fields(clip: VideoEditClip): Map<string, unknown> {
  const result = new Map<string, unknown>()
  for (const key of new Set([...Object.keys(clip.code?.parameters ?? {}), ...Object.keys(clip.code?.curves ?? {})])) result.set(codeEditKey.param(key), [clip.code?.parameters[key], clip.code?.curves?.[key]])
  for (const [id, value] of Object.entries(clip.elementOverrides ?? {})) {
    for (const key of CODE_ELEMENT_OVERRIDE_KEYS) if (value[key] !== undefined || value.curves?.[key]) result.set(codeEditKey.element(id, key), [value[key], value.curves?.[key]])
    for (const [key, effect] of Object.entries(value.effects ?? {})) {
      if (effect.enabled !== undefined) result.set(codeEditKey.effect(id, key, 'enabled'), effect.enabled)
      for (const param of new Set([...Object.keys(effect.values ?? {}), ...Object.keys(effect.curves ?? {})])) result.set(codeEditKey.effect(id, key, param), [effect.values?.[param], effect.curves?.[param]])
    }
    for (const effect of value.addedEffects ?? []) result.set(codeEditKey.added(id, effect.key), effect)
  }
  return result
}

/** 记录与值在同一份片段草稿提交；源码换版不触碰记录，重置明确删除对应键。 */
export function recordVideoEditCodeEdits(before: VideoEditClip, after: VideoEditClip, actor: CodeEditActor, resets: readonly string[] = [], at = Date.now()): void {
  codeEditActorSchema.parse(actor)
  const previous = fields(before), next = fields(after)
  const edits = { ...before.edits }
  // 检查记录不随参数变化计算；同一次写入里刚标记的检查（after 上更新的那条）保留。
  const check = after.edits?.[CODE_EDIT_CHECK_KEY]
  if (check) Object.defineProperty(edits, CODE_EDIT_CHECK_KEY, { value: check, enumerable: true, configurable: true, writable: true })
  for (const key of new Set([...previous.keys(), ...next.keys()])) {
    if (jsonEqual(previous.get(key), next.get(key))) continue
    if (next.has(key)) Object.defineProperty(edits, key, { value: { by: actor, at }, enumerable: true, configurable: true, writable: true })
    else delete edits[key]
  }
  for (const key of resets) delete edits[key]
  if (Object.keys(edits).length) after.edits = edits
  else delete after.edits
}

/** 一个元素相关的记录：元素自身的覆盖与绑定到它的作者参数。 */
export function codeElementEdits(edits: CodeEdits | undefined, elementId: string, parameterKeys: readonly string[]): CodeEdits {
  return Object.fromEntries(Object.entries(edits ?? {}).filter(([key]) => {
    const owner = codeEditOwner(key)
    return owner !== undefined && ('elementId' in owner ? owner.elementId === elementId : parameterKeys.includes(owner.parameter))
  }))
}

/** 覆盖并入源码后删掉这些元素的记录；参数记录与其它元素不动。 */
export function dropCodeElementEdits(clip: VideoEditClip, elementIds: readonly string[]): void {
  if (!clip.edits) return
  const edits = Object.fromEntries(Object.entries(clip.edits).filter(([key]) => { const owner = codeEditOwner(key); return !(owner && 'elementId' in owner && elementIds.includes(owner.elementId)) }))
  if (Object.keys(edits).length) clip.edits = edits
  else delete clip.edits
}

/** 上次助手检查之后用户手改的记录（按时间先后）。 */
export function pendingUserCodeEdits(edits: CodeEdits | undefined): Array<[string, CodeEdits[string]]> {
  const checked = edits && Object.hasOwn(edits, CODE_EDIT_CHECK_KEY) ? edits[CODE_EDIT_CHECK_KEY].at : 0
  return Object.entries(edits ?? {}).filter(([key, edit]) => key !== CODE_EDIT_CHECK_KEY && edit.by === 'user' && edit.at > checked).sort((a, b) => a[1].at - b[1].at)
}
/** 标记助手已检查到此刻：只增加检查记录，不动其他记录。 */
export function markCodeEditsChecked(edits: CodeEdits | undefined, at = Date.now()): CodeEdits {
  const next = { ...edits }
  Object.defineProperty(next, CODE_EDIT_CHECK_KEY, { value: { by: 'assistant', at }, enumerable: true, configurable: true, writable: true })
  return next
}
