import { UiEmpty, UiFormRow, UiGroup, UiIconButton, UiSwitch } from '@/components/ui'
import { Power } from 'lucide-react'
import { DockHeaderPortal } from '@/components/dockLayouts/DockHeaderPortal'
import NumberInput from '@/components/ui/NumberInput'
import { AudioEffectPicker, AudioEffectSlots } from '@/components/audio/AudioEffectRack'
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
  // 口水音是整段预先检测再修的修复，不是效果组里的实时效果；放进菜单方便找到，点了直接检测并打开修复，灵敏度与结果在“处理”页的“口水音”里调。
  const mouthClicks = { id: 'mouth_declick', name: '去除口水音', group: 'audio_repair' as const, tooltip: '检测说话时口水带出的“咔啦”声并修掉，不改变时长；灵敏度与检测结果在“处理”页的“口水音”里调整。',
    onPick: () => void run(async () => {
      const { count, perMinute } = await detectProjectAudioEditMouthClicks(project.id, project.mouthClicks?.sensitivity ?? 50, workspace.processRange)
      notify(notificationMessage(count ? 'audioMouthClicksDetected' : 'audioMouthClicksNone', { count, perMinute }))
    }) }
  const tools = <div className="flex items-center gap-0.5">
    <UiIconButton size="sm" on={!bypassed && effects.length > 0} aria-pressed={!bypassed} disabled={disabled || !effects.length} tooltip={bypassed ? '效果组已关闭：试听与导出都不经过效果组（基本声音照常）' : '关闭整个效果组，对比处理前后的声音'} aria-label="效果组开关" onClick={() => update({ effectsBypassed: !bypassed })}><Power /></UiIconButton>
    <AudioEffectPicker extras={workspace.sourceError ? [] : [mouthClicks]} disabled={disabled || effects.length >= AUDIO_EDIT_MAX_EFFECTS} disabledReason={`效果组最多放 ${AUDIO_EDIT_MAX_EFFECTS} 个效果`} onPick={definition => update({ effects: [...effects, createAudioRackEffect(definition) as AudioEditEffect] })} />
  </div>
  return <div className="flex h-full min-h-0 flex-col" data-audio-edit-panel="effects">
    <DockHeaderPortal panelId="audio_edit:effects" fallback={children => <div className="flex shrink-0 justify-end px-2 pt-1">{children}</div>}>{tools}</DockHeaderPortal>
    <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3 pt-1" aria-label="效果组">
      <AudioEffectSlots effects={effects} disabled={disabled} bypassed={bypassed} gesture={() => beginAudioEditGesture(project.id)} onChange={next => update({ effects: next as AudioEditEffect[] })}
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
