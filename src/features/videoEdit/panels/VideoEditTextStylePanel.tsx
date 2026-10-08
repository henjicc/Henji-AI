import { useEffect, useRef } from 'react'
import { VideoEditTypographyPanel } from './VideoEditTypographyPanel'
import { VideoEditTextTransformControls } from './VideoEditClipPropertySections'
import { useVideoEditClipPropertyGesture } from './useVideoEditClipPropertyGesture'
import { defaultVideoEditTextStyle, type VideoEditTextStyle } from '@/core/videoEdit/text'
import type { VideoEditClip } from '@/core/videoEdit/document'
import { VideoEditEffectSection } from './VideoEditEffectSection'
import { updateVideoEditClipProperties } from '../application/videoEditClipProperties'
import { beginVideoEditGesture, finishVideoEditGesture, type VideoEditGesture } from '../application/videoEditService'
import { useVideoEditFontPreview } from './useVideoEditFontPreview'
import { collectVideoEditFonts } from '@/core/videoEdit/fonts'
import { requireVideoEditInstance } from '../application/videoEditService'

/** Reuses the existing content row; all style writes use the same clip mutation and gesture history. */
export function VideoEditTextStylePanel({ projectId, sequenceId, clip, height, onError }: { projectId: string; sequenceId: string; clip: VideoEditClip; height: number; onError: (error: unknown) => void }): React.ReactElement {
  const owner = requireVideoEditInstance(projectId)
  const sequence = owner.document.sequences.find(value => value.id === sequenceId)!
  const motionGesture = useVideoEditClipPropertyGesture(projectId, sequenceId, clip.id, onError)
  const style = clip.textStyle ?? defaultVideoEditTextStyle(height)
  const fontPreview = useVideoEditFontPreview(projectId, `${sequenceId}:${clip.id}`, onError, (fontFamily, handle) => updateVideoEditClipProperties(projectId, sequenceId, clip.id, { textStyle: { ...style, fontFamily } }, handle))
  const gesture = useRef<VideoEditGesture>()
  const fields = useRef<HTMLDivElement>(null)
  const end = (commit = true): void => { const value = gesture.current; gesture.current = undefined; if (value) { try { finishVideoEditGesture(value, commit) } catch (error) { onError(error) } } }
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
  return <VideoEditEffectSection id="text-style" title="文字样式" enabled={!clip.disabledIntrinsicSections?.includes('textStyle')} onEnabledChange={enabled => { end(); try { updateVideoEditClipProperties(projectId, sequenceId, clip.id, { disabledIntrinsicSections: enabled ? (clip.disabledIntrinsicSections ?? []).filter(value => value !== 'textStyle') : [...(clip.disabledIntrinsicSections ?? []), 'textStyle'] }) } catch (error) { onError(error) } }}>
    <div ref={fields} className="flex flex-col gap-2 pl-5">
      <VideoEditTypographyPanel key={`${projectId}:${sequenceId}:${clip.id}`} style={style} onChange={value => write(value)} onError={onError} onBegin={begin} onEnd={end} onFontPreview={fontPreview} projectFonts={collectVideoEditFonts(owner.document).map(use => use.font)} transform={<VideoEditTextTransformControls clip={clip} frame={{ width: sequence.width, height: sequence.height, playhead: owner.frame }} gesture={motionGesture} />} />
    </div>
  </VideoEditEffectSection>
}
