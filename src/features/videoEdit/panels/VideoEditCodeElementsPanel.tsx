import { useSyncExternalStore } from 'react'
import { Virtuoso } from 'react-virtuoso'
import { Diamond, RotateCcw } from 'lucide-react'
import { UiButton, UiFormRow, UiGroup, UiIconButton, UiSwitch } from '@/components/ui'
import NumberInput from '@/components/ui/NumberInput'
import { defaultVideoEditTextStyle, type VideoEditTextStyle } from '@/core/videoEdit/text'
import type { CodeColor } from '@/core/videoEdit/codeMaterial/contract'
import type { CodeElementOverrideKey, CodeElementOverrideValues } from '@/core/videoEdit/codeElementOverrides'
import { collectVideoEditFonts } from '@/core/videoEdit/fonts'
import { selectedVideoEditCodeElement, selectVideoEditCodeElement } from '../application/videoEditCodeElements'
import { readVideoEditCodeElementEdit, resetVideoEditCodeElement, toggleVideoEditCodeElementKeyframe, updateVideoEditCodeElement, videoEditCodeElementOverrideSummary, type VideoEditCodeElementTarget } from '../application/videoEditCodeElementEditing'
import { subscribeVideoEditView, videoEditViewRevision, subscribeVideoEditDomain, videoEditDomainRevision, type VideoEditInstance } from '../application/videoEditService'
import { useVideoEditTypographyGesture } from './useVideoEditTypographyGesture'
import { useVideoEditFontPreview } from './useVideoEditFontPreview'
import { VideoEditTypographyPanel } from './VideoEditTypographyPanel'

const hex = (color: CodeColor): string => `#${color.slice(0, 3).map(channel => Math.round(channel * 255).toString(16).padStart(2, '0')).join('')}`
const rgba = (hex: string, alpha = 1): CodeColor => [parseInt(hex.slice(1, 3), 16) / 255, parseInt(hex.slice(3, 5), 16) / 255, parseInt(hex.slice(5, 7), 16) / 255, alpha]
function CodeElementProperties({ target, onError }: { target: VideoEditCodeElementTarget; onError: (error: unknown) => void }): React.ReactElement {
  const current = readVideoEditCodeElementEdit(target); const command = current.element!.command
  const identity = `${JSON.stringify(target)}:${JSON.stringify(current.time)}`
  const gesture = useVideoEditTypographyGesture(target.projectId, identity, onError)
  const write = (patch: CodeElementOverrideValues): void => { try { updateVideoEditCodeElement(target, patch, { gesture: gesture.handle.current, time: current.time }) } catch (error) { gesture.end(false); onError(error) } }
  const preview = useVideoEditFontPreview(target.projectId, identity, onError, (fontFamily, handle) => updateVideoEditCodeElement(target, { fontFamily }, { gesture: handle, time: current.time }))
  const run = (operation: () => void): void => { try { gesture.end(true); operation() } catch (error) { onError(error) } }
  const fields: Array<[CodeElementOverrideKey, string, number, number]> = [['dx', '水平位移', -32768, 32768], ['dy', '垂直位移', -32768, 32768], ['scale', '整体比例', .001, 1024], ['scaleX', '水平比例', .001, 1024], ['scaleY', '垂直比例', .001, 1024], ['rotation', '旋转', -32768, 32768], ['opacity', '不透明度', 0, 1]]
  let style: VideoEditTextStyle | undefined
  if (command.kind === 'text') style = { ...defaultVideoEditTextStyle(current.sequence.height), fontFamily: command.fontFamily, fontWeight: command.fontWeight ?? 400, fontSize: command.fontSize, fill: { enabled: true, color: hex(command.color) }, tracking: (command.letterSpacing ?? 0) * 1000 / command.fontSize, leading: (command.lineHeight ?? 1.2) * command.fontSize, strokes: Array.isArray(command.stroke) ? [{ enabled: true, color: hex(command.stroke), width: command.strokeWidth ?? 0, position: 'center' }] : [] }
  const changeStyle = (next: VideoEditTextStyle): void => {
    if (!style || command.kind !== 'text') return
    const patch: CodeElementOverrideValues = {}
    for (const key of ['fontFamily', 'fontWeight', 'fontSize'] as const) if (next[key] !== style[key]) Object.assign(patch, { [key]: next[key] })
    if (next.fill.color !== style.fill.color) patch.fill = rgba(next.fill.color, command.color[3])
    if (next.tracking !== style.tracking) patch.letterSpacing = next.tracking * next.fontSize / 1000
    if (next.leading !== style.leading) patch.lineHeight = Math.max(.1, Math.min(10, next.leading / next.fontSize))
    if (next.strokes[0]?.color !== style.strokes[0]?.color && next.strokes[0]) patch.stroke = rgba(next.strokes[0].color, Array.isArray(command.stroke) ? command.stroke[3] : 1)
    if (Object.keys(patch).length) write(patch)
  }
  return <div className="flex flex-col gap-3">
    {fields.map(([key, label, min, max]) => <UiFormRow key={key} label={label} density="compact"><NumberInput size="sm" ariaLabel={`元素${label}`} value={Number(current.values[key] ?? (key === 'dx' || key === 'dy' || key === 'rotation' ? 0 : key === 'opacity' ? command.opacity ?? 1 : 1))} min={min} max={max} step={key.startsWith('scale') || key === 'opacity' ? .01 : 1} precision={2} widthClassName="w-20" onScrubStart={gesture.begin} onScrubEnd={cancelled => gesture.end(!cancelled)} onChange={value => write({ [key]: value })} /><UiIconButton size="sm" on={Boolean(current.override.curves?.[key])} aria-label={`元素${label}关键帧`} title={`启用或关闭${label}关键帧`} onClick={() => run(() => toggleVideoEditCodeElementKeyframe(target, key))}><Diamond size={14} /></UiIconButton></UiFormRow>)}
    <UiFormRow label="显示" density="compact"><UiSwitch aria-label="显示元素" checked={!current.values.hidden} onCheckedChange={visible => write({ hidden: !visible })} /></UiFormRow>
    {style && <VideoEditTypographyPanel fields="code-element" style={style} onChange={changeStyle} onError={onError} onBegin={gesture.begin} onEnd={gesture.end} onFontPreview={preview} projectFonts={collectVideoEditFonts(current.owner.document).map(use => use.font)} />}
  </div>
}
export function VideoEditCodeElementsPanel({ instance, clipId, onError }: { instance: VideoEditInstance; clipId: string; onError: (error: unknown) => void }): React.ReactElement {
  useSyncExternalStore(subscribeVideoEditView, videoEditViewRevision); useSyncExternalStore(subscribeVideoEditDomain, videoEditDomainRevision)
  const clip = instance.document.sequences.find(sequence => sequence.id === instance.activeSequenceId)?.clips.find(clip => clip.id === clipId)
  const selected = selectedVideoEditCodeElement(instance)
  const target = clip?.code ? { projectId: instance.document.id, sequenceId: instance.activeSequenceId, clipId, versionId: clip.code.versionId } : undefined
  const entries = target ? videoEditCodeElementOverrideSummary(target.projectId, target.sequenceId, clipId) : []
  const row = (index: number): React.ReactElement => { const value = entries[index]; return <div className="flex items-center gap-1"><UiButton size="sm" className="min-w-0 flex-1" disabled={value.missing} onClick={() => selectVideoEditCodeElement(instance, clipId, value.elementId)}>{value.label}</UiButton><UiIconButton size="sm" aria-label={`重置${value.label}`} title="清除该元素的覆盖" onClick={() => { try { resetVideoEditCodeElement({ ...target!, elementId: value.elementId }) } catch (error) { onError(error) } }}><RotateCcw size={14} /></UiIconButton></div> }
  return <UiGroup title="元素" titleTone="compact" divided>
    {target && selected?.entry.clip.id === clipId && <CodeElementProperties key={`${target.versionId}:${selected.element.elementId}`} target={{ ...target, elementId: selected.element.elementId }} onError={onError} />}
    {entries.length > 0 && <div className="h-40"><Virtuoso totalCount={entries.length} itemContent={row} /></div>}
  </UiGroup>
}
