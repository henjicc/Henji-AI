import type { ReactNode } from 'react'
import { AlignHorizontalJustifyStart, AlignHorizontalJustifyCenter, AlignHorizontalJustifyEnd, AlignVerticalJustifyStart, AlignVerticalJustifyCenter, AlignVerticalJustifyEnd, Link } from 'lucide-react'
import { UiFormRow, UiIconButton, UI_TEXT_META_CLASS } from '@/components/ui'
import { layoutVideoEditText, type VideoEditTextStyle } from '@/core/videoEdit/text'
import { readVideoEditGraphicEditor, setVideoEditCodeParameter, type VideoEditGraphicTarget } from '../application/videoEditCodeParameters'
import { updateVideoEditGraphicObject } from '../application/videoEditGraphics'
import { requireVideoEditInstance } from '../application/videoEditService'
import { collectVideoEditFonts } from '@/core/videoEdit/fonts'
import { VideoEditTypographyPanel } from './VideoEditTypographyPanel'
import { useVideoEditFontPreview } from './useVideoEditFontPreview'
import { useVideoEditTypographyGesture } from './useVideoEditTypographyGesture'

export function VideoEditGraphicTextStylePanel({ target, style, transform, onError }: { target: VideoEditGraphicTarget; style: VideoEditTextStyle; transform: ReactNode; onError: (error: unknown) => void }): React.ReactElement {
  const gesture = useVideoEditTypographyGesture(target.projectId, `${target.sequenceId}:${target.clipId}:${target.objectId}`, onError)
  const owner = requireVideoEditInstance(target.projectId)
  const preview = useVideoEditFontPreview(target.projectId, `${target.sequenceId}:${target.clipId}:${target.objectId}`, onError, (fontFamily, handle) => updateVideoEditGraphicObject(target, { textStyle: { ...style, fontFamily } }, handle))
  const align = (axis: 'x' | 'y', position: 0 | .5 | 1): void => {
    try {
      const editor = readVideoEditGraphicEditor(target.projectId, target.sequenceId, target.clipId, target.objectId)
      const graphic = owner.document.sequences.find(sequence => sequence.id === target.sequenceId)!.clips.find(clip => clip.id === target.clipId)!.graphic!
      const context = document.createElement('canvas').getContext('2d')
      if (!context) throw new Error('当前窗口无法测量文字。')
      const layout = layoutVideoEditText({ text: editor.parameters.text as string, textStyle: style }, graphic, (text, font) => { context.font = font; return context.measureText(text).width })
      const px = Number(editor.parameters.x); const py = Number(editor.parameters.y); const scale = Number(editor.parameters.scale); const angle = Number(editor.parameters.rotation) * Math.PI / 180
      const pivotX = px + Number(editor.parameters.anchorX); const pivotY = py + Number(editor.parameters.anchorY)
      const corners = [[layout.left, layout.top], [layout.left + layout.width, layout.top], [layout.left + layout.width, layout.top + layout.height], [layout.left, layout.top + layout.height]].map(([x, y]) => {
        const dx = (x + px - graphic.width / 2 - pivotX) * scale; const dy = (y + py - graphic.height / 2 - pivotY) * scale
        return axis === 'x' ? pivotX + dx * Math.cos(angle) - dy * Math.sin(angle) : pivotY + dx * Math.sin(angle) + dy * Math.cos(angle)
      })
      const min = Math.min(...corners); const max = Math.max(...corners); const edge = min + (max - min) * position
      setVideoEditCodeParameter(target, axis, (axis === 'x' ? px : py) + (axis === 'x' ? graphic.width : graphic.height) * position - edge, { time: editor.sourceTime })
    } catch (error) { onError(error) }
  }
  const controls = <><UiFormRow label="对齐到画面" density="compact"><div className="flex gap-1">{([['x', 0, '画面左对齐', AlignHorizontalJustifyStart], ['x', .5, '画面水平居中', AlignHorizontalJustifyCenter], ['x', 1, '画面右对齐', AlignHorizontalJustifyEnd], ['y', 0, '画面顶部对齐', AlignVerticalJustifyStart], ['y', .5, '画面垂直居中', AlignVerticalJustifyCenter], ['y', 1, '画面底部对齐', AlignVerticalJustifyEnd]] as const).map(([axis, value, label, Icon]) => <UiIconButton key={label} size="sm" aria-label={label} title={label} onClick={() => align(axis, value)}><Icon size={14} /></UiIconButton>)}</div></UiFormRow><span className={`flex items-center gap-1 ${UI_TEXT_META_CLASS}`}><Link size={12} />等比缩放</span>{transform}</>
  return <VideoEditTypographyPanel style={style} onError={onError} onChange={textStyle => updateVideoEditGraphicObject(target, { textStyle }, gesture.handle.current)} onBegin={gesture.begin} onEnd={gesture.end} onFontPreview={preview} projectFonts={collectVideoEditFonts(owner.document).map(use => use.font)} transform={controls} />
}
