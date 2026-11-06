import { codeEditOwner, codeEditSegments, pendingUserCodeEdits } from '@/core/videoEdit/codeEdits'
import { readCodeElementOverride } from '@/core/videoEdit/codeElementOverrides'
import type { CodeParameterDeclaration } from '@/core/videoEdit/codeMaterial/contract'
import type { VideoEditClip, VideoEditDocument } from '@/core/videoEdit/document'
import { assetToAgentAttachment, openAssistant } from '@/features/assistant'
import { createHostContextSnapshot } from '@/features/application-control/hostContext/hostContext'
import { readVideoEditCodeMetadata } from './videoEditCodeState'
import { observeVideoEditFrame } from './videoEditFrameObservation'
import { requireVideoEditInstance } from './videoEditService'

export interface VideoEditUserEdit { label: string; before?: unknown; after: unknown }
export interface VideoEditUserEditClip { clip: VideoEditClip; edits: VideoEditUserEdit[]; related: string[] }

const sameColor = (a: unknown, b: unknown): boolean => Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((value, index) => typeof value === 'number' && Math.abs(value - Number(b[index])) < .5 / 255)
const short = (value: unknown): unknown => { const text = JSON.stringify(value); return text !== undefined && text.length > 240 ? `${text.slice(0, 240)}…` : value }

/**
 * 序列里上次助手检查之后用户手改过的代码片段：每处改动的名称、代码原值（参数默认值；元素覆盖的原值在代码里）与现值，
 * 以及改掉的颜色在别处还在用的位置（同一片段其他颜色参数、其他代码片段同色参数），交给助手判断要不要一起改。
 */
export function videoEditPendingUserEdits(document: VideoEditDocument, sequenceId: string, owner: object): VideoEditUserEditClip[] {
  const sequence = document.sequences.find(value => value.id === sequenceId)
  if (!sequence) return []
  const metadata = readVideoEditCodeMetadata(owner, document)
  const declarationsOf = (clip: VideoEditClip): readonly CodeParameterDeclaration[] => { try { return clip.code ? metadata(clip.code).parameters : [] } catch { return [] } }
  const result: VideoEditUserEditClip[] = []
  for (const clip of sequence.clips) {
    if (clip.kind !== 'code' || !clip.code) continue
    const pending = pendingUserCodeEdits(clip.edits)
    if (!pending.length) continue
    const declarations = declarationsOf(clip), related = new Set<string>()
    const edits = pending.map(([key]): VideoEditUserEdit => {
      const owner = codeEditOwner(key)
      if (owner && 'parameter' in owner) {
        const declaration = declarations.find(item => item.key === owner.parameter)
        const after = clip.code!.curves?.[owner.parameter] ? { keyframes: clip.code!.curves[owner.parameter] } : clip.code!.parameters[owner.parameter]
        if (declaration?.type === 'color') {
          for (const other of declarations) if (other.key !== declaration.key && other.type === 'color' && sameColor(clip.code!.parameters[other.key] ?? other.default, declaration.default)) related.add(`本片段参数「${other.title}」（${other.key}）`)
          for (const peer of sequence.clips) if (peer !== clip && peer.kind === 'code' && peer.code) for (const other of declarationsOf(peer)) if (other.type === 'color' && sameColor(peer.code.parameters[other.key] ?? other.default, declaration.default)) related.add(`片段「${peer.name}」（${peer.id}）参数「${other.title}」（${other.key}）`)
        }
        return { label: `参数「${declaration?.title ?? owner.parameter}」（${owner.parameter}）`, before: short(declaration?.default), after: short(after) }
      }
      const [, elementId = '', ...path] = codeEditSegments(key)
      return { label: `元素 ${elementId} 的 ${path.join(' ')}`, after: short(readCodeElementOverride(clip.elementOverrides, elementId)) }
    })
    result.push({ clip, edits, related: [...related] })
  }
  return result
}

/** 代码原值写在参数声明里；元素覆盖没有单独的原值，看源码。 */
function describe(projectId: string, entries: readonly VideoEditUserEditClip[]): string {
  return entries.map(entry => [
    `片段「${entry.clip.name}」（video_edit.clip ${projectId}:${entry.clip.id}）：`,
    ...entry.edits.map(edit => `- ${edit.label}：${edit.before === undefined ? '' : `代码原值 ${JSON.stringify(edit.before)} → `}现在 ${JSON.stringify(edit.after)}`),
    ...(entry.related.length ? [`- 改掉的颜色在这些地方还在用：${entry.related.join('；')}`] : []),
  ].join('\n')).join('\n')
}

/**
 * 把手改交给助手检查：附每个改过片段一帧截图（播放头在片段里取当前帧，否则取片段中间），直接发出检查请求。
 * 助手检查完把各片段的 user_edits_checked 写为 true，提示随之消失。
 */
export async function askAssistantToCheckUserEdits(projectId: string, signal?: AbortSignal): Promise<void> {
  const owner = requireVideoEditInstance(projectId)
  if (owner.playing) throw new Error('请先暂停画面，再交给助手检查。')
  const sequenceId = owner.activeSequenceId
  const entries = videoEditPendingUserEdits(owner.document, sequenceId, owner)
  if (!entries.length) return
  const attachments = []
  for (const entry of entries.slice(0, 3)) {
    const { clip } = entry
    const frame = owner.frame >= clip.start && owner.frame < clip.start + clip.duration ? owner.frame : clip.start + Math.floor(clip.duration / 2)
    const shot = await observeVideoEditFrame(projectId, { kind: 'program', sequenceId, frame }, 1920, signal, undefined, { saveToAssets: true })
    signal?.throwIfAborted()
    attachments.push({ attachment: assetToAgentAttachment(shot.asset), previewSrc: shot.asset.displayUrl })
  }
  const request = '我在画面上手改了一些地方，请检查一遍：字数变了排版要不要跟着调（换行、框宽、对齐、与相邻元素的间距），改了的颜色在前后或其他元素上是否也该一起改，整体是否还一致。需要改就直接改，不要推翻我改的值；检查完把这些片段的 video_edit.clip.user_edits_checked 写为 true。'
  openAssistant(request, { autoSend: true, attachments, context: JSON.stringify({ ...createHostContextSnapshot(), userEdits: describe(projectId, entries) }) })
}
