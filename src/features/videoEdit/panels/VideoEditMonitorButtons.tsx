import { useEffect, useRef, useState } from 'react'
import type { LucideIcon } from 'lucide-react'
import { Plus } from 'lucide-react'
import { PanelTrigger, UiButton, UiIconButton } from '@/components/ui'
import type { PanelTriggerControls } from '@/components/ui/PanelTrigger'
import { useReorderDrag } from '@/components/ui/fileUploader/useReorderDrag'
import { Z_LAYERS } from '@/core/theme/zLayers'
import { VIDEO_EDIT_MONITOR_BUTTON_DEFAULTS, videoEditMonitorButtons, type VideoEditMonitorButtonId, type VideoEditMonitorKind } from '@/core/videoEdit/monitorButtons'
import { useSettingsStore } from '@/stores/settingsStore'

/**
 * 监视器按钮栏与按钮编辑器（剪辑对齐 PR 2.5）：按钮栏只显示用户选的按钮，末尾“+”打开按钮编辑器——
 * 网格里是全部可用按钮（点一下加入或移出），拖进下方按钮栏的任意位置；栏内拖动调整顺序，拖出栏外即移除。
 * “重置布局”回到默认，“确定”保存，“取消”放弃（与 PR 一致）。
 */
export interface VideoEditMonitorButtonSpec {
  id: VideoEditMonitorButtonId
  /** 按钮名（无障碍名称与编辑器里的名称） */
  title: string
  /** 悬停说明（含快捷键或不可用原因）；不传用 title */
  tooltip?: string
  Icon: LucideIcon
  size?: 'md' | 'lg'
  enabled?: boolean
  /** 开关按钮（节目工具模式）的开启态 */
  on?: boolean
  /** 当前素材不适用（如图片源没有播放）：不显示，但编辑器里仍可选 */
  hidden?: boolean
  onClick?: () => void
  /** 只能拖动的按钮（拖入画面／声音／链接音画） */
  onDragStart?: (event: React.DragEvent<HTMLElement>) => void
}

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

const BUTTON_MIME = 'application/x-henji-monitor-button'
/** 编辑器按钮栏里一格的宽度（28 图标 + 2 间距），拖动让位用。 */
const BAR_SLOT_PX = 30

function MonitorButtonEditorPanel({ kind, specs, onClose }: { kind: VideoEditMonitorKind; specs: readonly VideoEditMonitorButtonSpec[]; onClose: () => void }): React.ReactElement {
  const saved = useVideoEditMonitorButtonIds(kind)
  const [draft, setDraft] = useState<VideoEditMonitorButtonId[]>(() => saved.slice())
  const [dropIndex, setDropIndex] = useState<number | null>(null)
  const barRef = useRef<HTMLDivElement>(null)
  const skipReorder = useRef(false)
  const byId = new Map(specs.map(spec => [spec.id, spec]))
  const { dragState, itemRefs, handleMouseDown } = useReorderDrag({
    disabled: false, isCustomDragging: false, files: draft, layout: 'grid',
    onReorder: (from, to) => {
      if (skipReorder.current) { skipReorder.current = false; return }
      setDraft(list => { const next = list.slice(); const [moved] = next.splice(from, 1); next.splice(to, 0, moved); return next })
    },
  })
  const outside = (x: number, y: number): boolean => {
    const rect = barRef.current?.getBoundingClientRect()
    return !rect || x < rect.left - 12 || x > rect.right + 12 || y < rect.top - 16 || y > rect.bottom + 16
  }
  // 拖出按钮栏即移除（PR）：在拖动收尾之前判定，移除后跳过这次排序。
  const drag = useRef(dragState); drag.current = dragState
  useEffect(() => {
    if (!dragState.isDragging) return
    const up = (event: MouseEvent): void => {
      const { fromIndex, toIndex } = drag.current
      if (fromIndex === null || !outside(event.clientX, event.clientY)) return
      skipReorder.current = fromIndex !== toIndex
      setDraft(list => list.filter((_, index) => index !== fromIndex))
    }
    window.addEventListener('mouseup', up, true)
    return () => window.removeEventListener('mouseup', up, true)
  }, [dragState.isDragging])
  const insertionIndex = (clientX: number): number => {
    const index = draft.findIndex((_, i) => { const rect = itemRefs.current[i]?.getBoundingClientRect(); return rect ? clientX < rect.left + rect.width / 2 : false })
    return index < 0 ? draft.length : index
  }
  const insert = (id: VideoEditMonitorButtonId, index: number): void => setDraft(list => {
    const without = list.filter(value => value !== id)
    const at = Math.min(without.length, index - (list.indexOf(id) >= 0 && list.indexOf(id) < index ? 1 : 0))
    return [...without.slice(0, at), id, ...without.slice(at)]
  })
  const toggle = (id: VideoEditMonitorButtonId): void => setDraft(list => list.includes(id) ? list.filter(value => value !== id) : [...list, id])
  const shift = (index: number): number => {
    const { isDragging, fromIndex, toIndex } = dragState
    if (!isDragging || fromIndex === null || toIndex === null || index === fromIndex) return 0
    if (fromIndex < toIndex && index > fromIndex && index <= toIndex) return -BAR_SLOT_PX
    if (fromIndex > toIndex && index >= toIndex && index < fromIndex) return BAR_SLOT_PX
    return 0
  }
  const draggingOut = dragState.isDragging && outside(dragState.currentX, dragState.currentY)
  return <div className="flex flex-col gap-3" aria-label="按钮编辑器">
    <div className="grid grid-cols-8 gap-1" role="group" aria-label="可用按钮">
      {specs.map(spec => <UiIconButton key={spec.id} aria-label={spec.title} title={`${spec.title}：拖到下方按钮栏，或点击加入／移出`} on={draft.includes(spec.id)} aria-pressed={draft.includes(spec.id)} draggable
        onDragStart={event => { event.dataTransfer.setData(BUTTON_MIME, spec.id); event.dataTransfer.effectAllowed = 'copy' }}
        onDragEnd={() => setDropIndex(null)} onClick={() => toggle(spec.id)}><spec.Icon size={15} /></UiIconButton>)}
    </div>
    <p className="text-xs text-text3">把按钮拖进按钮栏；在栏内拖动调整顺序，拖出栏外即移除。</p>
    <div ref={barRef} className="relative flex min-h-control-md flex-wrap items-center justify-center gap-0.5 rounded-field bg-window px-1 py-0.5" role="list" aria-label="按钮栏"
      onDragOver={event => { if (!event.dataTransfer.types.includes(BUTTON_MIME)) return; event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; setDropIndex(insertionIndex(event.clientX)) }}
      onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropIndex(null) }}
      onDrop={event => {
        const id = event.dataTransfer.getData(BUTTON_MIME) as VideoEditMonitorButtonId
        setDropIndex(null)
        if (!byId.has(id)) return
        event.preventDefault(); insert(id, insertionIndex(event.clientX))
      }}>
      {draft.length === 0 && <span className="px-2 text-xs text-text3">按钮栏为空</span>}
      {draft.map((id, index) => {
        const spec = byId.get(id)
        if (!spec) return null
        const dragging = dragState.isDragging && dragState.fromIndex === index
        const offset = dragging ? `translate(${dragState.currentX - dragState.startX}px, ${dragState.currentY - dragState.startY}px)` : `translateX(${shift(index)}px)`
        return <div key={id} ref={element => { itemRefs.current[index] = element }} role="listitem" aria-label={spec.title} title={spec.title}
          className={`relative flex h-7 w-7 cursor-grab items-center justify-center rounded-control text-text2 hover:bg-hover ${dragging ? 'z-raised bg-hover' : 'transition-transform duration-120'} ${dragging && draggingOut ? 'opacity-40' : ''}`}
          style={{ transform: offset }} onMouseDown={event => handleMouseDown(index, event)}>
          {dropIndex === index && <span className="pointer-events-none absolute -left-0.5 bottom-1 top-1 w-0.5 rounded-full bg-accent" />}
          <spec.Icon size={15} />
        </div>
      })}
      {dropIndex !== null && dropIndex >= draft.length && <span className="pointer-events-none h-5 w-0.5 rounded-full bg-accent" />}
    </div>
    <div className="flex items-center justify-between gap-2">
      <UiButton size="sm" onClick={() => setDraft(VIDEO_EDIT_MONITOR_BUTTON_DEFAULTS[kind].slice())}>重置布局</UiButton>
      <div className="flex items-center gap-2">
        <UiButton size="sm" onClick={onClose}>取消</UiButton>
        <UiButton size="sm" variant="primary" onClick={() => { useSettingsStore.getState().setVideoEditMonitorButtons(kind, draft); onClose() }}>确定</UiButton>
      </div>
    </div>
  </div>
}

/** 按钮栏末尾的“+”：打开按钮编辑器（编辑的是草稿，确定才保存）。 */
export function VideoEditMonitorButtonEditor({ kind, specs }: { kind: VideoEditMonitorKind; specs: readonly VideoEditMonitorButtonSpec[] }): React.ReactElement {
  const controls = useRef<PanelTriggerControls | null>(null)
  // 每次打开都从已保存的按钮栏重新起草（收起动画期间再次打开也不沿用上一次没确定的草稿）。
  const [session, setSession] = useState(0)
  return <PanelTrigger controlsRef={controls} panelWidth={300} zIndex={Z_LAYERS.dropdown} panelPadding="content" alignment="bottomRight"
    renderPanel={() => <MonitorButtonEditorPanel key={session} kind={kind} specs={specs} onClose={() => controls.current?.closePanel()} />}>
    {({ open, togglePanel }) => <UiIconButton aria-label="按钮编辑器" title="按钮编辑器：自定义这一栏的按钮" aria-expanded={open} on={open} data-panel-trigger-button onClick={() => { if (!open) setSession(value => value + 1); togglePanel() }}><Plus size={15} /></UiIconButton>}
  </PanelTrigger>
}
