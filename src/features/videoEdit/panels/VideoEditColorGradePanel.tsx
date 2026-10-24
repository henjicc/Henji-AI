import { UiFormRow } from '@/components/ui'
import { ColorGradeSections } from '@/components/colorGrade/ColorGradeSections'
import { ColorGradeScopes } from '@/components/colorGrade/ColorGradeScopes'
import type { ColorStatistics } from '@/core/imaging/adjustments/colorStatistics'
import { useTranslation } from 'react-i18next'
import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { RotateCcw, SquareSplitHorizontal, WandSparkles, Upload } from 'lucide-react'
import { Dropdown, UiButton, UiEmpty, UiFieldLayoutContext, UiGroup, UiIconButton, UiLoading, UiPropertyMenuContext } from '@/components/ui'
import { UI_PROPERTY_INSET_CLASS } from '@/components/ui/styleTokens'
import ContextMenu from '@/components/ContextMenu'
import { useContextMenu } from '@/hooks/useContextMenu'

import { resolveVideoEditBuiltinParams, videoEditBuiltinDefaults } from '@/core/videoEdit/builtinEffects'
import { VIDEO_EDIT_COLOR_GRADE } from '@/core/videoEdit/colorGrade'
import type { VideoEditClip } from '@/core/videoEdit/document'
import { beginVideoEditGesture, finishVideoEditGesture, getActiveVideoEditSequence, requireVideoEditInstance, subscribeVideoEditView, videoEditViewRevision, type VideoEditGesture, type VideoEditInstance } from '../application/videoEditService'
import { evaluateVideoEditEffect } from '@/core/videoEdit/keyframes'
import type { VideoEditBuiltinEffect } from '@/core/videoEdit/compositing'
import { analyzeVideoEditColorGrade, editVideoEditColorGrade, observeVideoEditColor } from '../application/videoEditColorGrade'
import { updateVideoEditBuiltinEffect, type VideoEditCompositeTarget } from '../application/videoEditCompositing'
import { useVideoEditBuiltinParamGesture } from './useVideoEditBuiltinParamGesture'
import { VideoEditBuiltinParamRows } from './VideoEditBuiltinEffectControls'

import { importVideoEditColorLut } from '../application/videoEditColorLuts'

function ColorGradeEditor({ target, clip, selectedId, onError }: { target: VideoEditCompositeTarget; clip: VideoEditClip; selectedId: string; onError: (reason: unknown) => void }): React.ReactElement {
  const { t } = useTranslation('ui')
  useSyncExternalStore(subscribeVideoEditView, videoEditViewRevision)
  const effect = selectedId ? clip.effects?.find(effect => effect.id === selectedId) : clip.effects?.find(effect => effect.builtin?.id === VIDEO_EDIT_COLOR_GRADE.id)
  const frame = requireVideoEditInstance(target.projectId).frame
  const values = effect?.builtin ? resolveVideoEditBuiltinParams(evaluateVideoEditEffect(effect, frame - clip.start).builtin!) : videoEditBuiltinDefaults(VIDEO_EDIT_COLOR_GRADE)
  const animation = effect?.builtin ? { target, effect: effect as VideoEditBuiltinEffect, start: clip.start, duration: clip.duration, frame } : undefined
  const gesture = useVideoEditBuiltinParamGesture(target.projectId, `${target.sequenceId}:${target.clipId}:${selectedId}`, (changes, handle) => editVideoEditColorGrade(target, changes, handle, selectedId || undefined), onError)
  const request = useRef<AbortController>(); const [busy, setBusy] = useState(false)
  useEffect(() => () => { request.current?.abort() }, [])
  const [reference, setReference] = useState('')
  const [matchMethod, setMatchMethod] = useState<'mkl' | 'moments' | 'histogram'>('mkl')
  const luts = requireVideoEditInstance(target.projectId).document.colorLuts ?? []
  const upload = async (stage: string): Promise<void> => {
    if (busy || gesture.active()) return
    const controller = new AbortController(); request.current = controller; setBusy(true)
    try { const asset = await importVideoEditColorLut(target.projectId, controller.signal); controller.signal.throwIfAborted(); if (asset) gesture.commit({ params: { [`${stage}_lut`]: asset.id } }) }
    catch (error) { if (!controller.signal.aborted) onError(error) }
    finally { if (!controller.signal.aborted) setBusy(false) }
  }
  const lutControl = (stage: 'input' | 'look'): ReactNode => <UiFormRow label={t(stage === 'input' ? 'surfaceGrammar.inputLut' : 'surfaceGrammar.creativeLook')} density="compact"><div className="flex items-center gap-1"><div className="min-w-0 flex-1"><Dropdown size="sm" ariaLabel={stage === 'input' ? '输入 LUT' : '创意 Look'} value={values[`${stage}_lut`] as string} options={[{ value: '', label: '无' }, ...luts.map(asset => ({ value: asset.id, label: asset.name }))]} onSelect={id => gesture.commit({ params: { [`${stage}_lut`]: id } })} /></div><UiIconButton size="xs" aria-label="导入 LUT" tooltip="导入 .cube 颜色查找表" disabled={busy} onClick={() => { void upload(stage) }}><Upload  /></UiIconButton></div></UiFormRow>
  const automatic = async (): Promise<void> => {
    if (busy || gesture.active()) return
    const controller = new AbortController(); request.current = controller; setBusy(true)
    try {
      const result = await analyzeVideoEditColorGrade(target, undefined, controller.signal, selectedId || undefined, reference ? { referenceClipId: reference, matchMethod } : {})
      controller.signal.throwIfAborted()
      gesture.commit({ params: result.parameters, ...(reference ? { curves: {} } : {}) })
    } catch (error) { if (!controller.signal.aborted) onError(error) }
    finally { if (!controller.signal.aborted) setBusy(false) }
  }
  return <UiGroup labelWidth={96} className="flex flex-col" gap="row">
    <div className={`flex flex-wrap items-center justify-end gap-1 ${UI_PROPERTY_INSET_CLASS}`}>
      <UiButton size="sm" disabled={busy} onClick={() => { void automatic() }} tooltip="在片段内均匀采样，分析白平衡与明暗；选择参考后匹配其颜色"><WandSparkles  />{busy ? '分析中…' : reference ? '匹配颜色' : '自动'}</UiButton>
      <VideoEditGradeCompare target={target} effectId={effect?.id} disabled={busy || !effect?.enabled} />
      <UiIconButton size="xs" tooltip="重置全能调色" aria-label="重置全能调色" disabled={busy || !effect} onClick={() => gesture.commit({ curves: {}, params: videoEditBuiltinDefaults(VIDEO_EDIT_COLOR_GRADE) })}><RotateCcw  /></UiIconButton>
    </div>
    <UiFormRow label="校色参考片段" density="compact"><Dropdown ariaLabel="校色参考片段" value={reference} options={[{ value: '', label: '自动校色' }, ...getActiveVideoEditSequence(requireVideoEditInstance(target.projectId)).clips.filter(value => value.id !== clip.id && value.kind !== 'audio' && value.kind !== 'adjustment').map(value => ({ value: value.id, label: value.name }))]} onSelect={setReference} /></UiFormRow>
    {reference && <UiFormRow label="颜色匹配方式" density="compact"><Dropdown ariaLabel="颜色匹配方式" value={matchMethod} options={[{ value: 'mkl', label: '整体颜色（推荐）' }, { value: 'moments', label: '均值与反差曲线' }, { value: 'histogram', label: '颜色分布曲线' }]} onSelect={value => setMatchMethod(value as 'mkl' | 'moments' | 'histogram')} /></UiFormRow>}
    {busy && <UiLoading size="xs" message="正在处理颜色…" />}
    <ColorGradeSections host={{
      values, disabled: busy, renderLut: lutControl,
      renderRows: params => <VideoEditBuiltinParamRows params={params} values={values} gesture={gesture} animation={animation} />,
      resetParams: params => {
        const curves = { ...effect?.builtin?.curves }; for (const param of params) delete curves[param.key]
        gesture.commit({ params: Object.fromEntries(params.map(param => [param.key, param.default])), curves })
      },
      applyParams: values => gesture.commit({ params: values }),
      // Hovering a style previews it inside a gesture; leaving cancels it, so nothing enters the undo history.
      previewParams: values => { if (values) { gesture.begin(); gesture.commit({ params: values }) } else if (gesture.active()) gesture.cancel() },
      scopes: <VideoEditColorScopes target={target} effectId={selectedId || undefined} refreshKey={JSON.stringify([values, effect?.enabled])} />,
    }} />
  </UiGroup>
}

/** Press and hold to see the clip without this grade; release restores it without an undo step. */
function VideoEditGradeCompare({ target, effectId, disabled }: { target: VideoEditCompositeTarget; effectId?: string; disabled: boolean }): React.ReactElement {
  const handle = useRef<VideoEditGesture>()
  const release = (): void => { const previous = handle.current; handle.current = undefined; if (previous) finishVideoEditGesture(previous, false) }
  useEffect(() => release, [])
  const press = (): void => {
    if (handle.current || !effectId) return
    handle.current = beginVideoEditGesture(target.projectId)
    updateVideoEditBuiltinEffect(target, effectId, { enabled: false }, handle.current)
  }
  return <UiIconButton size="xs" tooltip="按住查看调色前" aria-label="按住查看调色前" disabled={disabled} disabledReason="调色效果已关闭或正在处理"
    onPointerDown={press} onPointerUp={release} onPointerLeave={release} onPointerCancel={release}
    onKeyDown={event => { if (event.key === ' ' || event.key === 'Enter') { event.preventDefault(); press() } }} onKeyUp={release} onBlur={release}><SquareSplitHorizontal /></UiIconButton>
}

/** Scopes read the same statistics as observe_video_edit_color, refreshed shortly after an edit settles. */
function VideoEditColorScopes({ target, effectId, refreshKey }: { target: VideoEditCompositeTarget; effectId?: string; refreshKey: string }): React.ReactElement {
  const [statistics, setStatistics] = useState<ColorStatistics | null>(null)
  const [busy, setBusy] = useState(false); const [error, setError] = useState('')
  const [manual, setManual] = useState(0)
  const { projectId, sequenceId, clipId } = target
  useEffect(() => {
    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      setBusy(true); setError('')
      observeVideoEditColor({ projectId, sequenceId, clipId }, { stage: 'after_grade', scopes: true, effectId }, controller.signal)
        .then(result => { if (!controller.signal.aborted) setStatistics(result.statistics) })
        .catch((reason: unknown) => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : String(reason)) })
        .finally(() => { if (!controller.signal.aborted) setBusy(false) })
    }, 350)
    return () => { window.clearTimeout(timer); controller.abort() }
  }, [projectId, sequenceId, clipId, effectId, refreshKey, manual])
  return <ColorGradeScopes statistics={statistics} busy={busy} error={error} onRefresh={() => setManual(value => value + 1)} />
}

/** Dock and native popout use this same body. Selection follows the existing primary selected clip. */
function VideoEditColorGradePanelContent({ instance, onError, visible = true }: { instance: VideoEditInstance; onError: (reason: unknown) => void; visible?: boolean }): React.ReactElement {
  const sequence = getActiveVideoEditSequence(instance); const clip = sequence.clips.find(value => value.id === instance.selection)
  const [choice, setChoice] = useState<{ clipId: string; effectId: string }>()
  const effects = clip?.effects?.filter(effect => effect.builtin?.id === VIDEO_EDIT_COLOR_GRADE.id) ?? []
  const selectedId = choice && choice.clipId === clip?.id && effects.some(effect => effect.id === choice.effectId) ? choice.effectId : ''
  const menu = useContextMenu()
  if (!clip || clip.kind === 'audio') return <UiEmpty size="sm" title="选择画面片段以调色" />
  // 与效果控件同一套属性排布（重要记录 019 / 020）：四列属性行、秒表一列、重置在右键菜单
  return <UiFieldLayoutContext.Provider value="property"><UiPropertyMenuContext.Provider value={menu.showMenu}>
    <div className="flex h-full min-h-0 flex-col gap-2 overflow-auto py-3" aria-label="全能调色">
      <span className={`truncate text-xs font-semibold text-text1 ${UI_PROPERTY_INSET_CLASS}`} data-user-content>{clip.name}</span>
      {effects.length > 1 && <div className={UI_PROPERTY_INSET_CLASS}><Dropdown ariaLabel="编辑全能调色效果" value={selectedId || effects[0].id} options={effects.map((effect, i) => ({ value: effect.id, label: `${effect.name} ${i + 1}` }))} onSelect={effectId => setChoice({ clipId: clip.id, effectId })} /></div>}
      {visible && <ColorGradeEditor key={`${instance.document.id}:${sequence.id}:${clip.id}:${selectedId}`} target={{ projectId: instance.document.id, sequenceId: sequence.id, clipId: clip.id }} clip={clip} selectedId={selectedId} onError={onError} />}
    </div>
    <ContextMenu items={menu.menuItems} position={menu.menuPosition} onClose={menu.hideMenu} visible={menu.menuVisible} />
  </UiPropertyMenuContext.Provider></UiFieldLayoutContext.Provider>
}

export function VideoEditColorGradePanel(props: Parameters<typeof VideoEditColorGradePanelContent>[0]): React.ReactElement {
  return props.instance.activeSequenceId ? <VideoEditColorGradePanelContent {...props} /> : <UiEmpty className="h-full" title="没有序列" />
}
