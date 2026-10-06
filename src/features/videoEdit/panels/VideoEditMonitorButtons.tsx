import { useRef, useState } from 'react'
import { Plus } from 'lucide-react'
import { PanelTrigger, UiIconButton } from '@/components/ui'
import type { PanelTriggerControls } from '@/components/ui/PanelTrigger'
import { VideoEditButtonBarEditorPanel, type VideoEditBarButtonSpec } from './VideoEditButtonBarEditor'
import { Z_LAYERS } from '@/core/theme/zLayers'
import { VIDEO_EDIT_MONITOR_BUTTON_DEFAULTS, videoEditMonitorButtons, type VideoEditMonitorButtonId, type VideoEditMonitorKind } from '@/core/videoEdit/monitorButtons'
import { useSettingsStore } from '@/stores/settingsStore'

/**
 * 监视器按钮栏与按钮编辑器（剪辑对齐 PR 2.5）：按钮栏只显示用户选的按钮，末尾“+”打开按钮编辑器——
 * 网格里是全部可用按钮（点一下加入或移出），拖进下方按钮栏的任意位置；栏内拖动调整顺序，拖出栏外即移除。
 * “重置布局”回到默认，“确定”保存，“取消”放弃（与 PR 一致）。
 */
export type VideoEditMonitorButtonSpec = VideoEditBarButtonSpec<VideoEditMonitorButtonId>

// eslint-disable-next-line react-refresh/only-export-components -- 按钮栏与编辑器共用的读取钩子，随组件一起维护
export function useVideoEditMonitorButtonIds(kind: VideoEditMonitorKind): readonly VideoEditMonitorButtonId[] {
  const layouts = useSettingsStore(state => state.videoEditMonitorButtons)
  return videoEditMonitorButtons(layouts, kind)
}

export function VideoEditMonitorButton({ spec }: { spec: VideoEditMonitorButtonSpec }): React.ReactElement {
  const { Icon, size = 'md' } = spec
  return <UiIconButton size={size} aria-label={spec.title} title={spec.tooltip ?? spec.title} disabled={spec.enabled === false}
    {...(spec.on !== undefined ? { on: spec.on, 'aria-pressed': spec.on } : {})}
    {...(spec.onDragStart ? { draggable: spec.enabled !== false, onDragStart: spec.onDragStart } : { onClick: spec.onClick })}>
    <Icon size={size === 'lg' ? 18 : 15} />
  </UiIconButton>
}

/** 按钮栏末尾的“+”：打开按钮编辑器（编辑的是草稿，确定才保存）。 */
export function VideoEditMonitorButtonEditor({ kind, specs }: { kind: VideoEditMonitorKind; specs: readonly VideoEditMonitorButtonSpec[] }): React.ReactElement {
  const controls = useRef<PanelTriggerControls | null>(null)
  const saved = useVideoEditMonitorButtonIds(kind)
  // 每次打开都从已保存的按钮栏重新起草（收起动画期间再次打开也不沿用上一次没确定的草稿）。
  const [session, setSession] = useState(0)
  return <PanelTrigger controlsRef={controls} panelWidth={300} zIndex={Z_LAYERS.dropdown} panelPadding="content" alignment="bottomRight"
    renderPanel={() => <VideoEditButtonBarEditorPanel key={session} specs={specs} saved={saved} defaults={VIDEO_EDIT_MONITOR_BUTTON_DEFAULTS[kind]} onSave={ids => useSettingsStore.getState().setVideoEditMonitorButtons(kind, ids)} onClose={() => controls.current?.closePanel()} />}>
    {({ open, togglePanel }) => <UiIconButton aria-label="按钮编辑器" title="按钮编辑器：自定义这一栏的按钮" aria-expanded={open} on={open} data-panel-trigger-button onClick={() => { if (!open) setSession(value => value + 1); togglePanel() }}><Plus size={15} /></UiIconButton>}
  </PanelTrigger>
}
