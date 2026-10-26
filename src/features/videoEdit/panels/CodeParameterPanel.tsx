import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { UiButton, UiError, UiLoading } from '@/components/ui'
import { UI_PROPERTY_INSET_CLASS } from '@/components/ui/styleTokens'
import { EffectSection } from '@/components/effects/EffectSection'
import { useVideoEditCodeMetadata } from './useVideoEditCodeMetadata'
import { ICON_ASSET_LIBRARY } from '@/core/theme/icons'
import { useAssetLibraryStore } from '@/features/assets/store/assetLibraryStore'
import { openAssetLibrary } from '@/stores/navigationStore'
import { collectVideoEditCodeAsset } from '../application/videoEditCodeAssets'
import type { CodeImageReference, CodeAudioReference, CodeParameterDeclaration } from '@/core/videoEdit/codeMaterial/contract'
import { readVideoEditCodeEditor, resetVideoEditCodeParameter, setVideoEditCodeParameter, type VideoEditCodeEditorState, type VideoEditParameterEditorState } from '../application/videoEditCodeParameters'
import { activeVideoEditInstance, requireVideoEditInstance, subscribeVideoEditView, videoEditViewRevision } from '../application/videoEditService'
import { CodeKeyframePanel } from './CodeKeyframePanel'
import { videoEditParameterTargetIdentity } from './useCodeParameterGesture'
import { CodeImageParameterControl } from './CodeImageParameterControl'
import { CodeSourceEditor } from './CodeSourceEditor'
import { selectedVideoEditCodeElement } from '../application/videoEditCodeElements'
import { codeParameterFields } from './params/fieldSpec'
import { ParamList } from './params/ParamList'
import { ParamField } from './params/ParamField'
import { CodeParamField } from './params/CodeParamField'

/** 代码参数 / 对象参数：在效果控件里自成一节；效果链里的代码滤镜与图形文字样式里嵌在别的节内，只出各行（`bare`）。 */
export function VideoEditParameterFields({ editor, onError, bare = false }: { editor: VideoEditParameterEditorState; onError: (reason: unknown) => void; bare?: boolean }): React.ReactElement {
  useSyncExternalStore(subscribeVideoEditView, videoEditViewRevision)
  const selected = 'code' in editor && !editor.target.effectId ? selectedVideoEditCodeElement(requireVideoEditInstance(editor.target.projectId)) : undefined
  const chosen = selected?.entry.clip.id === editor.target.clipId ? selected : undefined
  const title = 'code' in editor ? editor.target.effectId ? '效果参数' : '代码参数' : '对象参数'
  const fields = codeParameterFields(chosen ? editor.metadata.parameters.filter(parameter => chosen.parameterKeys.includes(parameter.key)) : editor.metadata.parameters, editor.metadata.types)
  const content = <div className="flex flex-col" data-video-edit-code-parameters={editor.target.clipId}>
    {chosen && <div className={`py-1 text-xs text-accent-text ${UI_PROPERTY_INSET_CLASS}`} aria-label="已选元素">已选元素：{chosen.label}</div>}
    <ParamList key={videoEditParameterTargetIdentity(editor.target)} fields={fields} values={editor.parameters} extras={editor.curves} contextKey={JSON.stringify(editor.sourceTime)} highlightedKeys={chosen?.parameterKeys}
      onReset={field => { try { resetVideoEditCodeParameter(editor.target, field.key) } catch (error) { onError(error) } }}
      renderControl={(field, value) => (field.type === 'image' || field.type === 'audio') ? 'code' in editor ? <ParamField field={field} value={value} gesture={{ begin() {}, finish() {}, cancel() {}, active: () => false, write() {}, atomic() {} }} image={<CodeImageParameterControl target={editor.target} parameterKey={field.key} title={field.title} mediaType={field.type} value={value as CodeImageReference | CodeAudioReference | null} />} /> : null :
        <CodeParamField target={editor.target} field={field} value={value} time={editor.sourceTime} onError={onError} onWrite={(next, gesture, at) => setVideoEditCodeParameter(editor.target, field.key, next, { gesture, time: at })} />}
      renderAnimation={field => field.type === 'image' || field.type === 'audio' || field.type === 'lut' ? null : <div className={UI_PROPERTY_INSET_CLASS}><CodeKeyframePanel editor={editor} parameter={editor.metadata.parameters.find(parameter => parameter.key === field.key)! as Exclude<CodeParameterDeclaration, { type: 'image' | 'audio' }>} field={field} onError={onError} /></div>}
    />
  </div>
  return bare || ('code' in editor && editor.target.effectId) ? content : <EffectSection id={`parameters:${title}`} title={title}>{content}</EffectSection>
}

function CollectCodeAsset({ editor, onError }: { editor: VideoEditCodeEditorState; onError: (reason: unknown) => void }): React.ReactElement {
  const pending = useRef<AbortController>()
  const [busy, setBusy] = useState(false)
  useEffect(() => () => { pending.current?.abort(); pending.current = undefined }, [])
  const collect = async (): Promise<void> => {
    if (pending.current) return
    const controller = new AbortController(); pending.current = controller; setBusy(true)
    try {
      const target = editor.target
      const owner = requireVideoEditInstance(target.projectId)
      const libraryId = useAssetLibraryStore.getState().libraryId
      const asset = await collectVideoEditCodeAsset(target.projectId, { kind: 'clip', sequenceId: target.sequenceId, clipId: target.clipId, ...(target.effectId ? { effectId: target.effectId } : {}) }, libraryId ? { libraryId } : {}, controller.signal)
      if (asset && !controller.signal.aborted && activeVideoEditInstance() === owner) {
        useAssetLibraryStore.getState().setSelectedAsset(asset); openAssetLibrary('floating')
      }
    } catch (error) { if (!controller.signal.aborted) onError(error) }
    finally { if (pending.current === controller) { pending.current = undefined; setBusy(false) } }
  }
  const AssetIcon = ICON_ASSET_LIBRARY
  return <UiButton loading={busy} variant="secondary" disabled={busy} onClick={() => { void collect() }}><AssetIcon  />{'代码素材加入资产库'}</UiButton>
}

export function CodeParameterPanel({ projectId, sequenceId, clipId, effectId, onError }: { projectId: string; sequenceId: string; clipId: string; effectId?: string; onError: (reason: unknown) => void }): React.ReactElement {
  useSyncExternalStore(subscribeVideoEditView, videoEditViewRevision)
  const owner = requireVideoEditInstance(projectId)
  const clip = owner.document.sequences.find(sequence => sequence.id === sequenceId)?.clips.find(clip => clip.id === clipId)
  const code = effectId ? clip?.effects?.find(effect => effect.id === effectId)?.code : clip?.code
  const metadata = useVideoEditCodeMetadata(owner, code)
  if (metadata.error) return <div className={UI_PROPERTY_INSET_CLASS}><UiError title="代码参数读取失败" message={metadata.error instanceof Error ? metadata.error.message : '请恢复源码文件后重试。'} onRetry={metadata.retry} /></div>
  if (!metadata.ready) return <div className={UI_PROPERTY_INSET_CLASS}><UiLoading message="正在读取代码参数…" /></div>
  let editor: VideoEditCodeEditorState
  try { editor = readVideoEditCodeEditor(projectId, sequenceId, clipId, effectId) } catch (error) { return <div className={UI_PROPERTY_INSET_CLASS}><UiError title="代码参数暂不可用" message={error instanceof Error ? error.message : '请重新选择代码片段。'} /></div> }
  const source = <div className={`flex flex-col items-start gap-2 pb-1 ${UI_PROPERTY_INSET_CLASS}`}><CodeSourceEditor editor={editor} /><CollectCodeAsset editor={editor} onError={onError} /></div>
  // 片段本身是代码素材时，源码自成一节；效果链里的代码滤镜，源码跟在它的参数后面。
  return <div key={videoEditParameterTargetIdentity(editor.target)}><VideoEditParameterFields editor={editor} onError={onError} />{effectId ? source : <EffectSection id="code-source" title="源码">{source}</EffectSection>}</div>
}
