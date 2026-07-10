import React, { useState } from 'react'
import { Trash2 } from 'lucide-react'
import { UiIconButton, UiInput } from '@/components/ui'
import type { StageShot } from '../../domain/shotTypes'
import type { ShotClipBlock } from './shotClipGeometry'

/** 极窄块（1 帧停留）保底最小可视宽度，避免无法点选（重要记录/01-实施方案 风险控制） */
const MIN_VISUAL_WIDTH = 16

/** 块身重排 / 右边缘 trim 共用的一组 pointer 事件透传（由父级 hook 提供，语义见各自 hook 定义） */
export interface ClipBlockPointerHandlers {
  onPointerDown: (event: React.PointerEvent) => void
  onPointerMove: (event: React.PointerEvent) => void
  onPointerUp: (event: React.PointerEvent) => void
  onPointerCancel: (event: React.PointerEvent) => void
}

interface StaticClipBlockProps {
  shot: StageShot
  block: ShotClipBlock
  selected: boolean
  /** 播放头当前落在本块内（跟随高亮，非选中态） */
  isPlayhead: boolean
  /** 键盘 Enter/Space 选卡（指针点击选卡走 reorderHandlers，见 2.2） */
  onSelect: () => void
  onRename: (name: string) => void
  onRemove: () => void
  /** 块身：pointerdown 记录起点，超过阈值判定重排拖拽，未超过在 pointerup 时选卡 */
  reorderHandlers: ClipBlockPointerHandlers
  /** 本块是否正在被重排拖拽（跟手视觉态） */
  dragging: boolean
  /** 重排拖拽中的水平位移（px），仅 dragging 为 true 时生效 */
  dragOffsetX: number
  /** 右边缘：拖拽调整停留时长（trim） */
  trimHandlers: ClipBlockPointerHandlers
  /** 本块右边缘是否正在被 trim 拖拽（高亮态） */
  trimming: boolean
}

/** 时间轴静止块：名称 + 停留时长，选中/播放头两种高亮态，双击重命名，悬浮删除，块身拖拽重排，右边缘 trim */
const StaticClipBlock: React.FC<StaticClipBlockProps> = ({
  shot,
  block,
  selected,
  isPlayhead,
  onSelect,
  onRename,
  onRemove,
  reorderHandlers,
  dragging,
  dragOffsetX,
  trimHandlers,
  trimming,
}) => {
  const [editingName, setEditingName] = useState(false)
  const [draftName, setDraftName] = useState(shot.name)

  const commitName = (): void => {
    onRename(draftName)
    setEditingName(false)
  }

  const beginRename = (event: React.SyntheticEvent): void => {
    event.stopPropagation()
    setDraftName(shot.name)
    setEditingName(true)
  }

  const handleKeyDown = (event: React.KeyboardEvent): void => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      onSelect()
    }
  }

  const shellClass = selected
    ? 'border-accent bg-accent/10'
    : 'border-border-dark bg-surface-dark hover:bg-layer'

  return (
    <div
      role="button"
      tabIndex={0}
      className={`group absolute inset-y-1 flex cursor-grab flex-col justify-between overflow-hidden rounded-md border px-2 py-1.5 transition-colors ${shellClass} ${dragging ? 'z-30 cursor-grabbing opacity-70 shadow-lg' : ''} ${trimming ? 'border-accent' : ''}`}
      style={{
        left: block.x,
        width: Math.max(block.width, MIN_VISUAL_WIDTH),
        transform: dragging ? `translateX(${dragOffsetX}px)` : undefined,
      }}
      onPointerDown={reorderHandlers.onPointerDown}
      onPointerMove={reorderHandlers.onPointerMove}
      onPointerUp={reorderHandlers.onPointerUp}
      onPointerCancel={reorderHandlers.onPointerCancel}
      onKeyDown={handleKeyDown}
      title={shot.name}
    >
      {isPlayhead && <div className="absolute inset-x-1 top-0 h-0.5 rounded-full bg-accent" />}
      <div className="flex min-w-0 items-center gap-1">
        {editingName ? (
          <UiInput
            autoFocus
            value={draftName}
            className="h-6 min-w-0 flex-1 px-1 text-xs"
            onClick={(event) => event.stopPropagation()}
            onPointerDown={(event) => event.stopPropagation()}
            onChange={(event) => setDraftName(event.target.value)}
            onBlur={commitName}
            onKeyDown={(event) => {
              if (event.key === 'Enter') event.currentTarget.blur()
              else if (event.key === 'Escape') setEditingName(false)
            }}
          />
        ) : (
          <span
            className="min-w-0 flex-1 truncate text-xs text-text-dark"
            onDoubleClick={beginRename}
          >
            {shot.name}
          </span>
        )}
        <UiIconButton
          showBorder={false}
          appearance="hover-only"
          hoverVariant="danger"
          className="h-5 w-5 shrink-0 opacity-0 group-hover:opacity-100"
          title="删除片段"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation()
            onRemove()
          }}
        >
          <Trash2 size={11} />
        </UiIconButton>
      </div>
      <span className="truncate text-[10px] text-text-muted">{shot.hold.toFixed(2)}s</span>

      {/* 右边缘 trim 命中区：调整停留时长，独立于块身重排手势 */}
      <div
        role="presentation"
        className="absolute inset-y-0 right-0 z-10 w-1.5 cursor-ew-resize"
        onPointerDown={trimHandlers.onPointerDown}
        onPointerMove={trimHandlers.onPointerMove}
        onPointerUp={trimHandlers.onPointerUp}
        onPointerCancel={trimHandlers.onPointerCancel}
      />
    </div>
  )
}

export default StaticClipBlock
