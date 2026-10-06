import { useEffect, useMemo, useState } from 'react'
import { UiButton, UiCheckbox, UiError, UiFieldLayoutContext, UiFieldTrigger, UiFormRow, UiLoading, UiModal, UiOptionButton } from '@/components/ui'
import { UI_SEGMENTED_TRACK_CLASS, UI_TEXT_META_CLASS } from '@/components/ui/styleTokens'
import PanelTrigger from '@/components/ui/PanelTrigger'
import PriceEstimate from '@/components/ui/PriceEstimate'
import { PromptEditor } from '@/components/ui/PromptEditor'
import ModelSelectorPanel from '@/components/MediaGenerator/components/ModelSelectorPanel'
import ParameterPanel from '@/components/MediaGenerator/components/ParameterPanel'
import { parseLegacyPromptString, toPromptPlainText, type PromptDocumentV1 } from '@/core/inputs/promptDocument'
import { videoEditReferenceLabel, type VideoEditInPlaceIntent, type VideoEditInPlaceMode, type VideoEditInPlacePlan, type VideoEditReferenceRole } from '@/core/videoEdit/inPlaceGeneration'
import { videoEditFrameTimecode } from '@/core/videoEdit/timecode'
import { videoEditTrackCodes } from '@/core/videoEdit/tracks'
import type { GenerationModelFilterType } from '@/features/generation/domain/generationDraft'
import { useGenerationDraftStore } from '@/features/generation/store/generationDraftStore'
import { generationApplicationService } from '@/features/generation/application/generationApplicationService'
import { getAvailableProviders, getModelInfo } from '@/utils/modelHelpers'
import { registry } from '@/core/ModelRegistry'
import { requireVideoEditInstance } from '../application/videoEditService'
import {
  planVideoEditInPlace, startVideoEditInPlaceGeneration, videoEditInPlaceActionLabel, videoEditInPlaceDefaultParams, videoEditInPlaceModelMismatch, videoEditInPlaceReferenceLimit,
} from '../application/videoEditInPlaceGeneration'

export interface VideoEditInPlaceDialogInitial { prompt?: string; modelId?: string; params?: Record<string, unknown>; referenceRoles?: VideoEditReferenceRole[] }
interface Props { projectId: string; sequenceId: string; intent: VideoEditInPlaceIntent; initial?: VideoEditInPlaceDialogInitial; replacesJobId?: string; onClose: () => void }

const PLACEHOLDERS: Record<VideoEditInPlaceIntent['action'], string> = {
  generate_shot: '描述这个镜头，例如：黄昏的海边空镜，镜头缓慢推进',
  replace_shot: '描述新画面，例如：同一场景换成雨天',
  extend_shot: '描述接下来发生什么，例如：人物转身走出画面',
  generate_audio: '写下要念的台词，或描述配乐的风格与情绪',
}

/** 落点的一句话说明：轨道、起点与长度，用户据此确认放在哪里。 */
function describe(projectId: string, plan: VideoEditInPlacePlan): string {
  const sequence = requireVideoEditInstance(projectId).document.sequences.find(value => value.id === plan.sequenceId)
  const track = sequence?.tracks.find(value => value.index === plan.trackIndex)
  const code = track && sequence ? videoEditTrackCodes(sequence).get(track.id) : undefined
  const clip = plan.clipId ? sequence?.clips.find(value => value.id === plan.clipId) : undefined
  const length = `${(plan.duration / plan.fps).toFixed(1)} 秒`
  if (plan.placement === 'replace') return `替换「${clip?.name ?? ''}」，同位置、同长度（${length}），原${plan.mediaType === 'audio' ? '声音' : '镜头'}保留，可随时切回`
  const where = code ? `${code} 轨` : `新建${plan.mediaType === 'audio' ? '音频' : '视频'}轨`
  const start = videoEditFrameTimecode(plan.frame, plan.fps)
  if (plan.action === 'extend_shot') return `接在「${clip?.name ?? ''}」后面（${start} 起），${plan.fill ? `长 ${length}` : '长度按生成结果'}`
  return `${where} · ${start} 起 · ${plan.fill ? `长 ${length}` : '长度按生成结果'}`
}

/**
 * 原地生成面板（4.12）：提示词、模型与参数（按模型 schema 渲染）、自动带入的参考帧、预估费用。
 * 提交后关闭面板，时间线上立刻出现占位，生成期间可以继续剪辑。
 */
export function VideoEditInPlaceDialog({ projectId, sequenceId, intent, initial, replacesJobId, onClose }: Props): React.ReactElement {
  const [mode, setMode] = useState<VideoEditInPlaceMode>(intent.mode ?? 'insert')
  const effectiveIntent = useMemo<VideoEditInPlaceIntent>(() => intent.action === 'extend_shot' ? { ...intent, mode } : intent, [intent, mode])
  const planned = useMemo((): { plan: VideoEditInPlacePlan } | { error: string } => {
    try { return { plan: planVideoEditInPlace(projectId, sequenceId, effectiveIntent) } } catch (error) { return { error: error instanceof Error ? error.message : String(error) } }
  }, [projectId, sequenceId, effectiveIntent])
  const plan = 'plan' in planned ? planned.plan : null
  const [prompt, setPrompt] = useState<PromptDocumentV1>(() => parseLegacyPromptString(initial?.prompt ?? ''))
  const [modelId, setModelId] = useState<string | null>(initial?.modelId ?? null)
  const [params, setParams] = useState<Record<string, unknown>>({})
  const [roles, setRoles] = useState<VideoEditReferenceRole[] | null>(initial?.referenceRoles ?? null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  // 模型面板的筛选是这个面板自己的；收藏与生成页共用
  const [filterProvider, setFilterProvider] = useState('all')
  const [filterType, setFilterType] = useState<GenerationModelFilterType>(plan?.mediaType ?? 'video')
  const [filterFunction, setFilterFunction] = useState('all')
  const favorites = useGenerationDraftStore(state => state.draft.favoriteModels)
  const patchDraftField = useGenerationDraftStore(state => state.patchField)

  // 默认模型：用户的默认模型里已配置、能接受这次输入的那个
  useEffect(() => {
    if (modelId || !plan) return
    let cancelled = false
    generationApplicationService.resolveModel({ mediaType: plan.mediaType, prompt: '镜头', options: {} })
      .then(resolved => { if (!cancelled) setModelId(resolved.modelId) }, (reason: unknown) => { if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason)) })
    return () => { cancelled = true }
  }, [modelId, plan])
  // 换模型时参数按落点重新换算（时长、画面比例）；换模型重试时沿用原来的参数
  const [paramsModel, setParamsModel] = useState<string | null>(null)
  useEffect(() => {
    if (!modelId || !plan || paramsModel === modelId) return
    setParams(paramsModel === null && initial?.params && initial.modelId === modelId ? { ...videoEditInPlaceDefaultParams(modelId, plan), ...initial.params } : videoEditInPlaceDefaultParams(modelId, plan))
    setParamsModel(modelId)
  }, [modelId, plan, paramsModel, initial])

  const references = plan?.references ?? []
  const wanted = references.filter(reference => roles === null || roles.includes(reference.role))
  const referenceLimit = modelId ? videoEditInPlaceReferenceLimit(modelId, params, wanted.length) : wanted.length
  const usedImages = wanted.slice(0, referenceLimit).map((_, index) => `reference-${index + 1}`)
  const mismatch = plan && modelId ? videoEditInPlaceModelMismatch(plan, modelId) : null
  const text = toPromptPlainText(prompt).trim()
  const model = modelId ? getModelInfo(modelId) ?? undefined : undefined
  const providerId = modelId ? registry.getModel(modelId)?.meta.provider ?? '' : ''
  const provider = getAvailableProviders().find(value => value.id === providerId)

  const submit = async (): Promise<void> => {
    if (!plan || !modelId) return
    setBusy(true); setError('')
    try {
      await startVideoEditInPlaceGeneration({ projectId, sequenceId, intent: effectiveIntent, prompt: text, modelId, params, referenceRoles: wanted.map(reference => reference.role) }, replacesJobId ? { replacesJobId } : {})
      onClose()
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) } finally { setBusy(false) }
  }
  const toggleRole = (role: VideoEditReferenceRole, on: boolean): void => {
    const current = roles ?? references.map(reference => reference.role)
    setRoles(on ? [...current, role] : current.filter(value => value !== role))
  }

  const modelTrigger = <PanelTrigger className="min-w-0" panelWidth={1100} alignment="aboveCenter" stableHeight
    closeOnPanelClick={target => { if ((target as HTMLElement).closest('[data-prevent-close]')) return false; return Boolean((target as HTMLElement).closest('[data-close-on-select]')) }}
    renderPanel={() => <ModelSelectorPanel selectedProvider={providerId} selectedModel={modelId ?? ''} modelFilterProvider={filterProvider} modelFilterType={filterType} modelFilterFunction={filterFunction} favoriteModels={favorites}
      onModelSelect={(_, id) => setModelId(id)} onFilterProviderChange={setFilterProvider} onFilterTypeChange={setFilterType} onFilterFunctionChange={setFilterFunction}
      onToggleFavorite={(event, providerId, id) => { event.stopPropagation(); const key = `${providerId}-${id}`; patchDraftField('favoriteModels', current => { const next = new Set(current); if (next.has(key)) next.delete(key); else next.add(key); return next }) }} />}>
    {({ open, togglePanel }) => <UiFieldTrigger appearance="quiet" open={open} onClick={togglePanel} data-panel-trigger-button aria-expanded={open} aria-label={`模型：${model?.name ?? '选择模型'}`} className="max-w-72 cursor-pointer">
      <span className="text-text1">{model?.name ?? '选择模型'}</span>{provider?.name ? <span className="ml-1.5 text-text3">{provider.name}</span> : null}
    </UiFieldTrigger>}
  </PanelTrigger>

  const title = videoEditInPlaceActionLabel(intent.action)
  return <UiModal isOpen title={title} size="form" onClose={onClose} footer={<>
    {modelId && !mismatch && <span className="mr-auto flex items-center"><PriceEstimate providerId={providerId} modelId={modelId} params={{ ...params, prompt: text, images: usedImages, uploadedImages: usedImages }} /></span>}
    <UiButton onClick={onClose}>取消</UiButton>
    <UiButton variant="primary" disabled={!plan || !modelId || Boolean(mismatch) || !text || busy} onClick={() => { void submit() }}>{busy ? '正在提交…' : '生成'}</UiButton>
  </>}>
    <div className="space-y-4" data-video-edit-in-place={intent.action}>
      {'error' in planned ? <UiError message={planned.error} /> : <>
        <p className={UI_TEXT_META_CLASS}>{describe(projectId, plan!)}</p>
        <PromptEditor value={prompt} onChange={setPrompt} preset="plain" layout="fill-scroll" ariaLabel={`${title}提示词`} placeholder={PLACEHOLDERS[intent.action]} autoFocus editorClassName="min-h-24 max-h-60" />
        {intent.action === 'extend_shot' && <UiFormRow label="放置方式" inline>
          <div className={UI_SEGMENTED_TRACK_CLASS} role="radiogroup" aria-label="放置方式">
            {([['insert', '插入（后面的片段后移）'], ['overwrite', '覆盖']] as const).map(([value, label]) => <UiOptionButton key={value} variant="segment" size="sm" active={mode === value} role="radio" aria-checked={mode === value} onClick={() => setMode(value)}>{label}</UiOptionButton>)}
          </div>
        </UiFormRow>}
        {references.length > 0 && <UiFormRow label="参考画面" hint={modelId && referenceLimit < wanted.length ? referenceLimit === 0 ? '所选模型不使用参考画面，将只按提示词生成。' : `所选模型只用前 ${referenceLimit} 张参考画面。` : undefined}>
          <div className="flex flex-col gap-1.5">
            {references.map(reference => <label key={reference.role} className="flex items-center gap-2 text-xs text-text2">
              <UiCheckbox checked={roles === null || roles.includes(reference.role)} onCheckedChange={on => toggleRole(reference.role, on)} aria-label={videoEditReferenceLabel(reference)} />
              <span className="truncate">{videoEditReferenceLabel(reference)}</span>
            </label>)}
          </div>
        </UiFormRow>}
        <UiFieldLayoutContext.Provider value="toolbar">
          {modelId ? <ParameterPanel currentModel={model} selectedModel={modelId} uploadedImages={usedImages} uploadedVideos={[]} values={params as DynamicValueMap}
            onChange={(id, value) => setParams(current => ({ ...current, [id]: value }))} onChanges={changes => setParams(current => ({ ...current, ...changes }))} toolbarLeading={modelTrigger} />
            : !error && <UiLoading size="sm" message="正在选择模型…" />}
        </UiFieldLayoutContext.Provider>
        {mismatch && <UiError message={mismatch} />}
      </>}
      {error && <UiError message={error} />}
    </div>
  </UiModal>
}
