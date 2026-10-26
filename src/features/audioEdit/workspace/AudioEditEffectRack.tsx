import { UiEmpty, UiFormRow, UiGroup, UiIconButton, UiSwitch } from '@/components/ui'
import { Power } from 'lucide-react'
import { DockHeaderPortal } from '@/components/dockLayouts/DockHeaderPortal'
import NumberInput from '@/components/ui/NumberInput'
import { AudioEffectPicker, AudioEffectSlots, type AudioRackFixedSlot } from '@/components/audio/AudioEffectRack'
import { useRef, useState } from 'react'
import { UiFieldLayoutContext } from '@/components/ui'
import { ParamField } from '@/components/ui/params/ParamField'
import { ParamList } from '@/components/ui/params/ParamList'
import type { ParamFieldSpec } from '@/components/ui/params/fieldSpec'
import { createAudioRackEffect } from '@/core/audio/effects/rackEffect'
import { AUDIO_EDIT_MAX_EFFECTS, type AudioEditEffect } from '@/core/audioEdit/effects'
import { detectProjectAudioEditMouthClicks, prepareAudioEditProcessing } from '../application/audioEditApplicationService'
import { notificationMessage } from '@/i18n/notifications'
import { beginAudioEditGesture } from '../application/audioEditProjectInstances'
import { useAudioEditWorkspace } from './audioEditWorkspaceContext'

/**
 * 效果组（参照 Audition）：一列效果槽，按顺序处理剪好的整条声音；每槽有开关、名称、更多菜单，点名称展开参数。
 * 标签行右侧放“全部开关”和“添加效果”；拖动参数时实时试听。VST3 插件需要先离线处理，单列在下方。
 */
export function AudioEditEffectRack(): React.ReactElement {
  const workspace = useAudioEditWorkspace()
  const { project, update, processors, run, notify } = workspace
  const effects = project.effects ?? []
  const bypassed = project.effectsBypassed === true
  const disabled = workspace.disabled
  const plugins = processors.filter(item => item.available && item.semanticRole)
  const detectMouthClicks = (sensitivity: number) => void run(async () => {
    const { count, perMinute } = await detectProjectAudioEditMouthClicks(project.id, sensitivity, workspace.processRange)
    notify(notificationMessage(count ? 'audioMouthClicksDetected' : 'audioMouthClicksNone', { count, perMinute }))
  })
  // 去除口水音：和其他效果一样加进效果组、有开关和参数，但要先对整段声音检测再修，所以总排在最前（固定槽）。
  const clicks = project.mouthClicks
  const mouthTooltip = '检测说话时口水带出的“咔啦”声，按前后声音插值修掉，不改变时长。整段预先处理，总在其他效果之前。'
  const mouthPick = { id: 'mouth_declick', name: '去除口水音', group: 'audio_repair' as const, tooltip: mouthTooltip, onPick: () => detectMouthClicks(50) }
  const fixed: AudioRackFixedSlot[] = clicks ? [{ id: 'mouth_declick', name: '去除口水音', tooltip: mouthTooltip, enabled: clicks.enabled,
    onToggle: enabled => update({ mouthClicks: { ...clicks, enabled } }), onRemove: () => update({ mouthClicks: undefined }),
    params: <MouthDeclickParams sensitivity={clicks.sensitivity} count={clicks.clicks.length} onDetect={detectMouthClicks} /> }] : []
  const tools = <div className="flex items-center gap-0.5">
    <UiIconButton size="sm" on={!bypassed && effects.length > 0} aria-pressed={!bypassed} disabled={disabled || !effects.length} tooltip={bypassed ? '效果组已关闭：试听与导出都不经过效果组（基本声音照常）' : '关闭整个效果组，对比处理前后的声音'} aria-label="效果组开关" onClick={() => update({ effectsBypassed: !bypassed })}><Power /></UiIconButton>
    <AudioEffectPicker extras={workspace.sourceError || clicks ? [] : [mouthPick]} disabled={disabled || effects.length >= AUDIO_EDIT_MAX_EFFECTS} disabledReason={`效果组最多放 ${AUDIO_EDIT_MAX_EFFECTS} 个效果`} onPick={definition => update({ effects: [...effects, createAudioRackEffect(definition) as AudioEditEffect] })} />
  </div>
  return <div className="flex h-full min-h-0 flex-col" data-audio-edit-panel="effects">
    <DockHeaderPortal panelId="audio_edit:effects" fallback={children => <div className="flex shrink-0 justify-end px-2 pt-1">{children}</div>}>{tools}</DockHeaderPortal>
    <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3 pt-1" aria-label="效果组">
      <AudioEffectSlots fixed={fixed} effects={effects} disabled={disabled} bypassed={bypassed} gesture={() => beginAudioEditGesture(project.id)} onChange={next => update({ effects: next as AudioEditEffect[] })}
        empty={<UiEmpty size="node" title="效果组是空的" description="点标签栏的加号添加效果；想一键处理人声，用“基本声音”。" />} />
      {plugins.length > 0 && <UiGroup divided titleTone="compact" title="VST3 插件" description="插件要先整段离线处理，改动后重新打开“试听时启用”。">
        <UiFormRow label="试听时启用" density="compact" inline><UiSwitch aria-label="试听时启用插件" checked={project.vstEnabled} disabled={disabled} onCheckedChange={value => void run(async () => { if (value) await prepareAudioEditProcessing(project.id, crypto.randomUUID()); workspace.setVstEnabled(value) })} /></UiFormRow>
        {plugins.map(plugin => {
          const entry = project.processorChain?.find(item => item.id === plugin.id)
          return <div key={plugin.id} className="flex flex-col">
            <UiFormRow label={plugin.name} density="compact" inline><UiSwitch aria-label={plugin.name} checked={Boolean(entry?.enabled)} disabled={disabled} onCheckedChange={enabled => update({ vstEnabled: false, processorChain: [...(project.processorChain ?? []).filter(item => item.id !== plugin.id).map(item => processors.find(p => p.id === item.id)?.semanticRole === plugin.semanticRole ? { ...item, enabled: false } : item), { id: plugin.id, enabled, parameters: entry?.parameters ?? {} }] })} /></UiFormRow>
            {entry?.enabled && plugin.parameters?.map(parameter => <UiFormRow key={parameter.id} label={parameter.name} density="compact"><NumberInput ariaLabel={parameter.name} size="sm" min={0} max={1} step={0.01} precision={2} commitOnChange value={entry.parameters[parameter.name] ?? parameter.normalizedValue} onChange={next => update({ vstEnabled: false, processorChain: project.processorChain?.map(item => item.id === plugin.id ? { ...item, parameters: { ...item.parameters, [parameter.name]: next } } : item) })} /></UiFormRow>)}
          </div>
        })}
      </UiGroup>}
    </div>
  </div>
}

const SENSITIVITY: ParamFieldSpec = { source: 'builtin', bindingKeys: ['sensitivity'], key: 'sensitivity', title: '灵敏度', tooltip: '越高检出越多，也越容易把正常的辅音当成口水音；松手后自动按新灵敏度重新检测。', type: 'number', min: 0, max: 100, step: 5, unit: '', control: 'slider', default: 50, animatable: false }

/** 去除口水音的参数：灵敏度（松手后重新检测）与检测到的数量；时间刻度上的小标记就是检测到的位置。 */
function MouthDeclickParams({ sensitivity, count, onDetect }: { sensitivity: number; count: number; onDetect: (sensitivity: number) => void }): React.ReactElement {
  const [value, setValue] = useState(sensitivity)
  const latest = useRef(value); latest.current = value
  const dragging = useRef(false)
  const gesture = { begin: () => { dragging.current = true }, finish: () => { if (!dragging.current) return; dragging.current = false; onDetect(latest.current) }, cancel: () => { dragging.current = false; setValue(sensitivity) },
    active: () => dragging.current, write: (next: unknown) => setValue(Number(next)), atomic: (next: unknown) => { setValue(Number(next)); onDetect(Number(next)) } }
  return <UiFieldLayoutContext.Provider value="property"><div className="flex flex-col">
    <ParamList fields={[SENSITIVITY]} values={{ sensitivity: value }} renderControl={(field, current) => <ParamField field={field} value={current} gesture={gesture} />} />
    <UiFormRow label="检测到" density="compact"><span className="text-xs tabular-nums text-text1">{count ? `${count} 处` : '没有找到'}</span></UiFormRow>
  </div></UiFieldLayoutContext.Provider>
}
