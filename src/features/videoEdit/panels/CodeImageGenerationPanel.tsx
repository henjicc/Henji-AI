import { useEffect, useRef, useState } from 'react'
import { UiButton, UiError, UiFieldLayoutContext, UiFieldTrigger, UiLoading } from '@/components/ui'
import PanelTrigger from '@/components/ui/PanelTrigger'
import { PromptEditor } from '@/components/ui/PromptEditor'
import PriceEstimate from '@/components/ui/PriceEstimate'
import ModelSelectorPanel from '@/components/MediaGenerator/components/ModelSelectorPanel'
import ParameterPanel from '@/components/MediaGenerator/components/ParameterPanel'
import { parseLegacyPromptString, toPromptPlainText, type PromptDocumentV1 } from '@/core/inputs/promptDocument'
import { registry } from '@/core/ModelRegistry'
import type { GenerationModelFilterType } from '@/features/generation/domain/generationDraft'
import { useGenerationDraftStore } from '@/features/generation/store/generationDraftStore'
import { getModelInfo } from '@/utils/modelHelpers'
import { useSettingsStore } from '@/stores/settingsStore'
import { openSettingsPanel, useUiStore } from '@/stores/uiStore'
import type { VideoEditCodeTarget } from '../application/videoEditCodeParameters'
import { VIDEO_EDIT_CODE_IMAGE_DEFAULT_MODEL, codeImageGenerationDefaultParams, codeImageGenerationProviderConfigured, prepareCodeImageGenerationContext, startCodeImageGeneration, type CodeImageGenerationContext } from '../application/videoEditCodeImageGeneration'

/** 表单浮层由 PanelTrigger 持有，关掉浮层不取消正式后台任务。 */
export function CodeImageGenerationPanel({ target, parameterKey, title, onClose }: { target: VideoEditCodeTarget; parameterKey: string; title: string; onClose: () => void }): React.ReactElement {
  const [prompt, setPrompt] = useState<PromptDocumentV1>(() => parseLegacyPromptString(''))
  const [modelId, setModelId] = useState(VIDEO_EDIT_CODE_IMAGE_DEFAULT_MODEL)
  const [context, setContext] = useState<CodeImageGenerationContext | null>(null)
  const [params, setParams] = useState<Record<string, unknown>>({})
  const [configured, setConfigured] = useState<boolean | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const alive = useRef(true)
  const submitting = useRef(false)
  const [filterProvider, setFilterProvider] = useState('all')
  const [filterType, setFilterType] = useState<GenerationModelFilterType>('image')
  const [filterFunction, setFilterFunction] = useState('all')
  const favorites = useGenerationDraftStore(state => state.draft.favoriteModels)
  const patchDraftField = useGenerationDraftStore(state => state.patchField)
  const keys = useSettingsStore(state => state.providerKeyStatus)
  const settingsOpen = useUiStore(state => state.isSettingsOpen)
  const scope = JSON.stringify([target.projectId, target.sequenceId, target.clipId, target.versionId, target.effectId, parameterKey])
  useEffect(() => {
    alive.current = true
    const controller = new AbortController()
    setContext(null); setError('')
    void prepareCodeImageGenerationContext(target, parameterKey, controller.signal).then(value => {
      if (controller.signal.aborted) return
      setContext(value); setPrompt(parseLegacyPromptString(value.prompt))
    }, (reason: unknown) => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : String(reason)) })
    return () => { alive.current = false; controller.abort() }
    // Identity, not parent object allocation, owns this form.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope])
  useEffect(() => {
    let disposed = false; setConfigured(null)
    void codeImageGenerationProviderConfigured(modelId).then(value => { if (!disposed) setConfigured(value) }, (reason: unknown) => { if (!disposed) setError(reason instanceof Error ? reason.message : String(reason)) })
    return () => { disposed = true }
  }, [modelId, keys, settingsOpen])
  useEffect(() => { if (context) setParams(codeImageGenerationDefaultParams(modelId, context)) }, [modelId, context])
  const text = toPromptPlainText(prompt).trim()
  const model = getModelInfo(modelId) ?? undefined
  const providerId = registry.getModel(modelId)?.meta.provider ?? ''
  const mismatch = registry.getModel(modelId)?.meta.type !== 'image'
  const submit = async (): Promise<void> => {
    if (submitting.current) return
    submitting.current = true
    setBusy(true); setError('')
    try { await startCodeImageGeneration({ target, parameterKey, modelId, prompt: text, params }); if (alive.current) onClose() }
    catch (reason) { if (alive.current) setError(reason instanceof Error ? reason.message : String(reason)) }
    finally { submitting.current = false; if (alive.current) setBusy(false) }
  }
  const modelTrigger = <PanelTrigger panelWidth={1100} alignment="aboveCenter" stableHeight closeOnPanelClick={node => Boolean((node as Element).closest('[data-close-on-select]'))}
    renderPanel={() => <ModelSelectorPanel selectedProvider={providerId} selectedModel={modelId} modelFilterProvider={filterProvider} modelFilterType={filterType} modelFilterFunction={filterFunction} favoriteModels={favorites}
      onModelSelect={(_, id) => setModelId(id)} onFilterProviderChange={setFilterProvider} onFilterTypeChange={setFilterType} onFilterFunctionChange={setFilterFunction}
      onToggleFavorite={(event, provider, id) => { event.stopPropagation(); const key = `${provider}-${id}`; patchDraftField('favoriteModels', current => { const next = new Set(current); if (next.has(key)) next.delete(key); else next.add(key); return next }) }} />}>
    {({ open, togglePanel }) => <UiFieldTrigger appearance="quiet" open={open} onClick={togglePanel} aria-label="图片生成模型" data-panel-trigger-button className="max-w-72">{model?.name ?? '选择图片模型'}</UiFieldTrigger>}
  </PanelTrigger>
  return <div className="flex flex-col gap-3" aria-label={`生成${title}图片`}>
    {!context && !error ? <UiLoading size="xs" message="正在准备图片生成" /> : <>
      <PromptEditor value={prompt} onChange={setPrompt} preset="plain" layout="fill-scroll" ariaLabel={`${title}生成提示词`} autoFocus editorClassName="min-h-24 max-h-60" />
      <UiFieldLayoutContext.Provider value="toolbar">
        <ParameterPanel currentModel={model} selectedModel={modelId} uploadedImages={[]} uploadedVideos={[]} values={params as DynamicValueMap}
          onChange={(id, value) => setParams(current => ({ ...current, [id]: value }))} onChanges={changes => setParams(current => ({ ...current, ...changes }))} toolbarLeading={modelTrigger} />
      </UiFieldLayoutContext.Provider>
    </>}
    {configured === false && <UiError size="xs" align="start" title="请先配置生成密钥" message="在设置的“供应商与模型”中填写所选供应商的密钥，然后回来生成。" actions={<UiButton variant="secondary" onClick={() => openSettingsPanel({ tab: 'providers', sectionId: 'providers' })}>去设置</UiButton>} />}
    {mismatch && <UiError size="xs" message="此参数需要图片，请选择图片模型。" />}
    {error && <UiError size="xs" align="start" message={error} />}
    <div className="flex items-center gap-2">
      <span className="mr-auto"><PriceEstimate providerId={providerId} modelId={modelId} params={{ ...params, prompt: text } as DynamicValueMap} /></span>
      <UiButton onClick={onClose}>关闭</UiButton>
      <UiButton variant="primary" disabled={!context || !text || busy || configured !== true || mismatch} onClick={() => { void submit() }}>{busy ? '正在提交' : '生成图片'}</UiButton>
    </div>
  </div>
}
