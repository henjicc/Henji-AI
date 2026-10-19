import { useRef } from 'react'
import { collectVideoEditFonts } from '@/core/videoEdit/fonts'
import type { CodeParameterValue } from '@/core/videoEdit/codeMaterial/contract'
import { replaceParameterPath } from '@/core/imaging/parameterPath'
import type { VideoEditSourceTime } from '@/core/videoEdit/time'
import { readVideoEditCodeEditor, readVideoEditGraphicEditor, type VideoEditParameterTarget } from '../../application/videoEditCodeParameters'
import { requireVideoEditInstance, type VideoEditGesture } from '../../application/videoEditService'
import { useCodeParameterGesture, videoEditParameterTargetIdentity } from '../useCodeParameterGesture'
import { useVideoEditFontPreview } from '../useVideoEditFontPreview'
import { ParamField } from './ParamField'
import type { ParamFieldSpec } from './fieldSpec'

export function CodeParamField({ target, field, value, time, label, pointId, onError, onWrite }: { target: VideoEditParameterTarget; field: ParamFieldSpec; value: CodeParameterValue; time?: VideoEditSourceTime; label?: string; pointId?: string; onError: (reason: unknown) => void; onWrite: (value: CodeParameterValue, gesture?: VideoEditGesture, at?: VideoEditSourceTime) => void }): React.ReactElement {
  const gesture = useCodeParameterGesture(target, onError, time)
  const path = useRef<readonly string[]>()
  const preview = useVideoEditFontPreview(target.projectId, `${videoEditParameterTargetIdentity(target)}:${field.key}:${pointId ?? ''}`, onError, (name, handle) => {
    if (!path.current?.length) { onWrite(name, handle, time); return }
    // The previous hover was rolled back synchronously. Read the restored value,
    // rather than merging a React snapshot which can still contain that hover.
    const editor = 'objectId' in target ? readVideoEditGraphicEditor(target.projectId, target.sequenceId, target.clipId, target.objectId) : readVideoEditCodeEditor(target.projectId, target.sequenceId, target.clipId, target.effectId)
    const restored = pointId ? editor.curves[field.key]?.find(point => point.id === pointId)?.value : editor.parameters[field.key]
    if (!restored) throw new Error('原字体参数已移除，请重新选择。')
    onWrite(replaceParameterPath(restored, path.current, name), handle, time)
  })
  const hasFont = field.type === 'font' || field.type === 'textStyle' || field.children?.some(child => child.type === 'font' || child.type === 'textStyle')
  return <ParamField field={field} value={value} label={label} onError={onError} gesture={{ ...gesture, write: next => gesture.write((handle, at) => onWrite(next, handle, at)), atomic: next => gesture.atomic((handle, at) => onWrite(next, handle, at)) }}
    font={hasFont ? { projectFonts: collectVideoEditFonts(requireVideoEditInstance(target.projectId).document).map(use => use.font), onPreview: (name, childPath) => { path.current = childPath; preview(name) } } : undefined} />
}
