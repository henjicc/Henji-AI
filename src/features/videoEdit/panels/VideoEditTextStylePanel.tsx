import { useEffect, useRef } from 'react'
import { Dropdown, UiColorInput, UiFormRow, UiInput, UiSwitch } from '@/components/ui'
import NumberInput from '@/components/ui/NumberInput'
import { defaultVideoEditTextStyle, type VideoEditTextStyle } from '@/core/videoEdit/text'
import type { VideoEditClip } from '@/core/videoEdit/document'
import { VideoEditEffectSection } from './VideoEditEffectSection'
import { updateVideoEditClipProperties } from '../application/videoEditClipProperties'
import { beginVideoEditGesture, finishVideoEditGesture, type VideoEditGesture } from '../application/videoEditService'

/** Reuses the existing content row; all style writes use the same clip mutation and gesture history. */
export function VideoEditTextStylePanel({ projectId, sequenceId, clip, height, onError }: { projectId: string; sequenceId: string; clip: VideoEditClip; height: number; onError: (error: unknown) => void }): React.ReactElement {
  const style = clip.textStyle ?? defaultVideoEditTextStyle(height)
  const gesture = useRef<VideoEditGesture>()
  const fields = useRef<HTMLDivElement>(null)
  const end = (commit = true): void => { const value = gesture.current; gesture.current = undefined; if (value) finishVideoEditGesture(value, commit) }
  useEffect(() => () => { if (gesture.current) finishVideoEditGesture(gesture.current, false) }, [projectId, sequenceId, clip.id])
  const begin = (): void => {
    try {
      const active = fields.current?.ownerDocument.activeElement
      // A scrub starts at pointerdown, before the browser's default blur: finish monitor typing first.
      if (!gesture.current && active?.getAttribute('contenteditable') === 'plaintext-only') (active as HTMLElement).blur()
      gesture.current ??= beginVideoEditGesture(projectId)
    } catch (error) { onError(error) }
  }
  const write = (patch: Partial<VideoEditTextStyle>): void => {
    try { updateVideoEditClipProperties(projectId, sequenceId, clip.id, { textStyle: { ...style, ...patch } }, gesture.current) } catch (error) { end(false); onError(error) }
  }
  const numeric = (key: 'fontSize' | 'strokeWidth' | 'shadowBlur', label: string, min: number, max: number): React.ReactElement => <NumberInput ariaLabel={label} size="sm" value={style[key]} min={min} max={max} step={1} precision={1} widthClassName="w-20" onChange={value => write({ [key]: value })} onScrubStart={begin} onScrubEnd={cancelled => end(!cancelled)} />
  const color = (key: 'color' | 'strokeColor' | 'shadowColor' | 'backgroundColor', label: string): React.ReactElement => <UiColorInput aria-label={label} value={style[key]} onFocus={begin} onPointerDown={begin} onBlur={() => end()} onChange={event => write({ [key]: event.target.value })} />
  return <VideoEditEffectSection id="text-style" title="文字样式" enabled={!clip.disabledIntrinsicSections?.includes('textStyle')} onEnabledChange={enabled => { end(); try { updateVideoEditClipProperties(projectId, sequenceId, clip.id, { disabledIntrinsicSections: enabled ? (clip.disabledIntrinsicSections ?? []).filter(value => value !== 'textStyle') : [...(clip.disabledIntrinsicSections ?? []), 'textStyle'] }) } catch (error) { onError(error) } }}>
    <div ref={fields} className="flex flex-col gap-2 pl-5">
      <UiFormRow label="字体" density="compact"><UiInput aria-label="文字字体" size="sm" value={style.fontFamily} onFocus={begin} onBlur={() => end()} onChange={event => { if (event.target.value.trim()) write({ fontFamily: event.target.value }) }} onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); if (event.key === 'Escape') { event.stopPropagation(); end(false); event.currentTarget.blur() } }} /></UiFormRow>
      <UiFormRow label="字号" density="compact">{numeric('fontSize', '文字字号', 1, 512)}</UiFormRow>
      <UiFormRow label="颜色" density="compact">{color('color', '文字颜色')}</UiFormRow>
      <UiFormRow label="对齐" density="compact"><Dropdown<VideoEditTextStyle['align']> ariaLabel="文字对齐" size="sm" value={style.align} options={[{ value: 'left', label: '左对齐' }, { value: 'center', label: '居中' }, { value: 'right', label: '右对齐' }]} onSelect={align => write({ align })} /></UiFormRow>
      <UiFormRow label="描边" density="compact"><div className="flex flex-wrap items-center gap-2">{numeric('strokeWidth', '文字描边宽度', 0, 20)}{color('strokeColor', '文字描边颜色')}</div></UiFormRow>
      <UiFormRow label="阴影" density="compact"><UiSwitch aria-label="文字阴影" checked={style.shadow} onCheckedChange={shadow => write({ shadow })} /></UiFormRow>
      {style.shadow && <UiFormRow label="阴影柔化" density="compact"><div className="flex flex-wrap items-center gap-2">{numeric('shadowBlur', '文字阴影柔化', 0, 50)}{color('shadowColor', '文字阴影颜色')}</div></UiFormRow>}
      <UiFormRow label="背景框" density="compact"><div className="flex items-center gap-2"><UiSwitch aria-label="文字背景框" checked={style.background} onCheckedChange={background => write({ background })} />{style.background && color('backgroundColor', '文字背景颜色')}</div></UiFormRow>
    </div>
  </VideoEditEffectSection>
}
