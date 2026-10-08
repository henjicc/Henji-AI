import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { UiButton, UiError, UiGroup } from '@/components/ui'
import { ICON_ASSET_LIBRARY } from '@/core/theme/icons'
import { useAssetLibraryStore } from '@/features/assets/store/assetLibraryStore'
import { openAssetLibrary } from '@/stores/navigationStore'
import { collectVideoEditCodeAsset } from '../application/videoEditCodeAssets'
import type { CodeImageReference, CodeParameterDeclaration } from '@/core/videoEdit/codeMaterial/contract'
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

export function VideoEditParameterFields({ editor, onError }: { editor: VideoEditParameterEditorState; onError: (reason: unknown) => void }): React.ReactElement {
  useSyncExternalStore(subscribeVideoEditView, videoEditViewRevision)
  const selected = 'code' in editor && !editor.target.effectId ? selectedVideoEditCodeElement(requireVideoEditInstance(editor.target.projectId)) : undefined
  const chosen = selected?.entry.clip.id === editor.target.clipId ? selected : undefined
  const title = 'code' in editor ? editor.target.effectId ? '效果参数' : '代码参数' : '对象参数'
  const fields = codeParameterFields(editor.metadata.parameters, editor.metadata.types)
  return <UiGroup title={title} titleTone="compact" divided data-video-edit-code-parameters={editor.target.clipId}>
    {chosen && <div className="text-xs text-accent-text" aria-label="已选元素">已选元素：{chosen.label}</div>}
    <ParamList key={videoEditParameterTargetIdentity(editor.target)} fields={fields} values={editor.parameters} extras={editor.curves} contextKey={JSON.stringify(editor.sourceTime)} highlightedKeys={chosen?.parameterKeys}
      onReset={field => { try { resetVideoEditCodeParameter(editor.target, field.key) } catch (error) { onError(error) } }}
      renderControl={(field, value) => field.type === 'image' ? 'code' in editor ? <ParamField field={field} value={value} gesture={{ begin() {}, finish() {}, cancel() {}, active: () => false, write() {}, atomic() {} }} image={<CodeImageParameterControl target={editor.target} parameterKey={field.key} title={field.title} value={value as CodeImageReference | null} />} /> : null :
        <CodeParamField target={editor.target} field={field} value={value} time={editor.sourceTime} onError={onError} onWrite={(next, gesture, at) => setVideoEditCodeParameter(editor.target, field.key, next, { gesture, time: at })} />}
      renderAnimation={field => field.type === 'image' || field.type === 'lut' ? null : <CodeKeyframePanel editor={editor} parameter={editor.metadata.parameters.find(parameter => parameter.key === field.key)! as Exclude<CodeParameterDeclaration, { type: 'image' }>} field={field} onError={onError} />}
    />
  </UiGroup>
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
  return <UiButton variant="secondary" disabled={busy} onClick={() => { void collect() }}><AssetIcon className="h-3.5 w-3.5" />{busy ? '正在加入资产库' : '代码素材加入资产库'}</UiButton>
}

export function CodeParameterPanel({ projectId, sequenceId, clipId, effectId, onError }: { projectId: string; sequenceId: string; clipId: string; effectId?: string; onError: (reason: unknown) => void }): React.ReactElement {
  useSyncExternalStore(subscribeVideoEditView, videoEditViewRevision)
  let editor: VideoEditCodeEditorState
  try { editor = readVideoEditCodeEditor(projectId, sequenceId, clipId, effectId) } catch (error) { return <UiError title="代码参数暂不可用" message={error instanceof Error ? error.message : '请重新选择代码片段。'} /> }
  return <div key={videoEditParameterTargetIdentity(editor.target)}><VideoEditParameterFields editor={editor} onError={onError} /><CodeSourceEditor editor={editor} /><CollectCodeAsset editor={editor} onError={onError} /></div>
}
