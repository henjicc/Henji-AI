import { BrainCircuit, GripHorizontal, History, MessageSquarePlus, Sparkles, X } from 'lucide-react'
import { useState, type CSSProperties, type KeyboardEvent, type RefObject } from 'react'

import { UI_COLOR_ACCENT_TEXT_CLASS, UI_PANEL_SURFACE_CLASS, UI_TEXT_LABEL_CLASS, UiIconButton } from '@/components/ui'
import { useDialogTransition } from '@/components/ui/useDialogTransition'
import { UI_DIALOG_TRANSITION_MS } from '@/components/ui/motion'

import { AssistantConversation } from './conversation/AssistantConversation'
import { AssistantRunHistory } from './history/AssistantRunHistory'
import { AssistantMemoryPanel } from './memory/AssistantMemoryPanel'
import { useAssistantPanelInteraction } from './hooks/useAssistantPanelInteraction'
import { useAssistantUiStore, type AssistantDockMode } from './store/assistantUiStore'

const HEADER_ICON_BUTTON_CLASS = '!h-8 !w-8 shrink-0'

/**
 * 停靠态是窗口 chrome 的一部分，不是浮层：直角、无阴影、只留朝向工作区的那一条边。
 * 悬浮态才是卡片语义，保留圆角 + 四边框 + 浮层阴影。
 */
const SURFACE_BY_MODE = {
  floating: 'rounded-2xl',
  left: 'border-y-0 border-l-0 shadow-none',
  right: 'border-y-0 border-r-0 shadow-none',
} as const

const dockModeLabels: Record<AssistantDockMode, string> = {
  left: '停靠左侧',
  right: '停靠右侧',
  floating: '悬浮',
}

/** 停靠位置的键盘出口：拖拽是主路径，这里保证不用鼠标也能改位置（与缩放手柄的方向键一致） */
const KEY_TO_DOCK_MODE: Record<string, AssistantDockMode> = {
  ArrowLeft: 'left',
  ArrowRight: 'right',
  ArrowDown: 'floating',
}

interface AssistantSidebarProps {
  workspaceRef: RefObject<HTMLDivElement>
}

export function AssistantSidebar({ workspaceRef }: AssistantSidebarProps): JSX.Element {
  const [contentView, setContentView] = useState<'conversation' | 'history' | 'memory'>('conversation')
  const [conversationVersion, setConversationVersion] = useState(0)
  const open = useAssistantUiStore((state) => state.open)
  const mode = useAssistantUiStore((state) => state.mode)
  const position = useAssistantUiStore((state) => state.floatingPosition)
  const size = useAssistantUiStore((state) => state.size)
  const setOpen = useAssistantUiStore((state) => state.setOpen)
  const setMode = useAssistantUiStore((state) => state.setMode)
  const setFloatingPosition = useAssistantUiStore((state) => state.setFloatingPosition)
  const setSize = useAssistantUiStore((state) => state.setSize)
  const startNewConversation = useAssistantUiStore((state) => state.startNewConversation)
  const threadId = useAssistantUiStore((state) => state.threadId)
  const { shouldRender, isVisible } = useDialogTransition(open, UI_DIALOG_TRANSITION_MS)
  const interaction = useAssistantPanelInteraction({
    enabled: open,
    mode,
    position,
    size,
    workspaceRef,
    onCommitPosition: setFloatingPosition,
    onCommitSize: setSize,
    onCommitMode: setMode,
  })

  // 定位属性全部由 useAssistantPanelInteraction 写（拖拽时会临时脱手成悬浮框），
  // 这里只声明与定位无关的渲染提示，避免两边抢同一批 style 键。
  const positionStyle: CSSProperties = {
    contain: 'layout paint style',
    backfaceVisibility: 'hidden',
  }

  const handleHeaderKeyDown = (event: KeyboardEvent<HTMLElement>): void => {
    if (event.target !== event.currentTarget) return
    const nextMode = KEY_TO_DOCK_MODE[event.key]
    if (!nextMode || nextMode === mode) return
    event.preventDefault()
    setMode(nextMode)
  }

  const hiddenTransform = mode === 'left'
    ? '-translate-x-3 opacity-0'
    : mode === 'right'
      ? 'translate-x-3 opacity-0'
      : 'translate-y-2 scale-[0.985] opacity-0'

  if (!shouldRender) return <></>

  return (
    <>
      {interaction.dockPreview ? (
        <div
          aria-hidden="true"
          className={`pointer-events-none fixed bottom-0 top-10 z-drag bg-accent/10 border-accent/50 ${
            interaction.dockPreview === 'left' ? 'left-0 border-r-2' : 'right-0 border-l-2'
          }`}
          style={{ width: size.width }}
        />
      ) : null}
      <div
        ref={interaction.panelRef}
        data-assistant-sidebar
        className={`pointer-events-none fixed z-panel min-h-0 ${mode === 'floating' || interaction.dragging ? 'will-change-transform' : ''}`}
        style={positionStyle}
      >
      <aside
        aria-label="智能助手"
        aria-hidden={!open}
        className={`relative flex h-full min-h-0 w-full flex-col overflow-hidden ${UI_PANEL_SURFACE_CLASS} transition-[opacity,transform] duration-200 ease-out ${
          interaction.dragging ? SURFACE_BY_MODE.floating : SURFACE_BY_MODE[mode]
        } ${isVisible ? 'pointer-events-auto translate-x-0 translate-y-0 scale-100 opacity-100' : `pointer-events-none ${hiddenTransform}`}`}
      >
        {/* 命令带：不画底色也不画下边框，与正文同为 bg-panel，整块面板读作一张连续表面 */}
        <header
          tabIndex={0}
          aria-label={`智能助手（当前${dockModeLabels[mode]}）；拖动可改变位置，方向键左右停靠、下键悬浮`}
          className={`group flex h-10 shrink-0 touch-none select-none items-center gap-2 px-2 outline-none focus-visible:ring-inset focus-visible:ring-2 focus-visible:ring-accent ${
            interaction.dragging ? 'cursor-grabbing' : 'cursor-grab'
          }`}
          onPointerDown={interaction.onDragPointerDown}
          onKeyDown={handleHeaderKeyDown}
        >
          <div className="flex min-w-0 flex-1 items-center gap-2 px-1">
            <Sparkles className="h-4 w-4 shrink-0 text-text-muted" />
            <div className={`min-w-0 truncate ${UI_TEXT_LABEL_CLASS}`}>智能助手</div>
            <GripHorizontal
              aria-hidden="true"
              className={`h-4 w-4 shrink-0 transition-opacity duration-150 ${
                interaction.dragging
                  ? `${UI_COLOR_ACCENT_TEXT_CLASS} opacity-100`
                  : 'text-text-faint opacity-0 group-hover:opacity-100'
              }`}
            />
          </div>
          <div
            role="toolbar"
            aria-label="智能助手工具栏"
            className="flex items-center"
            data-assistant-drag-ignore
          >
            <div role="group" aria-label="对话操作" className="flex items-center gap-0.5">
              <UiIconButton
                type="button"
                showBorder={false}
                appearance="hover-only"
                onClick={() => {
                  startNewConversation()
                  setConversationVersion((version) => version + 1)
                  setContentView('conversation')
                }}
                title="新建对话"
                aria-label="新建对话"
                className={HEADER_ICON_BUTTON_CLASS}
              >
                <MessageSquarePlus className="h-4 w-4" />
              </UiIconButton>
              <UiIconButton
                type="button"
                showBorder={false}
                appearance="hover-only"
                active={contentView === 'history'}
                aria-pressed={contentView === 'history'}
                onClick={() => setContentView((view) => (
                  view === 'history' ? 'conversation' : 'history'
                ))}
                title={contentView === 'history' ? '返回当前对话' : '对话历史'}
                aria-label={contentView === 'history' ? '返回当前对话' : '对话历史'}
                className={HEADER_ICON_BUTTON_CLASS}
              >
                <History className="h-4 w-4" />
              </UiIconButton>
              <UiIconButton
                type="button"
                showBorder={false}
                appearance="hover-only"
                active={contentView === 'memory'}
                aria-pressed={contentView === 'memory'}
                onClick={() => setContentView((view) => (
                  view === 'memory' ? 'conversation' : 'memory'
                ))}
                title={contentView === 'memory' ? '返回当前对话' : '助手记忆'}
                aria-label={contentView === 'memory' ? '返回当前对话' : '助手记忆'}
                className={HEADER_ICON_BUTTON_CLASS}
              >
                <BrainCircuit className="h-4 w-4" />
              </UiIconButton>
            </div>

            {/* 停靠态不放关闭：它正好落在窗口关闭按钮的正下方，两个 X 叠在一条竖线上很容易误点。
                停靠时改用标题栏的助手按钮或 Ctrl+Shift+A 收起；悬浮窗没有可依的边，仍需自带关闭。 */}
            {mode === 'floating' ? (
              <UiIconButton
                type="button"
                showBorder={false}
                appearance="hover-only"
                onClick={() => setOpen(false)}
                title="收起智能助手"
                aria-label="收起智能助手"
                hoverVariant="danger"
                className={`${HEADER_ICON_BUTTON_CLASS} ml-1.5`}
              >
                <X className="h-4 w-4" />
              </UiIconButton>
            ) : null}
          </div>
        </header>
        <div
          aria-hidden={contentView !== 'conversation'}
          className={contentView === 'conversation' ? 'flex min-h-0 min-w-0 flex-1 overflow-hidden' : 'hidden'}
        >
          <AssistantConversation key={`${conversationVersion}:${threadId}`} />
        </div>
        <div
          aria-hidden={contentView !== 'history'}
          className={contentView === 'history' ? 'flex min-h-0 min-w-0 flex-1 overflow-hidden' : 'hidden'}
        >
          <AssistantRunHistory
            visible={contentView === 'history'}
            onOpenConversation={() => setContentView('conversation')}
          />
        </div>
        {contentView === 'memory' ? <AssistantMemoryPanel /> : null}

        {mode === 'left' || mode === 'right' ? (
          <div
            role="separator"
            aria-label={`调整智能助手${mode === 'left' ? '右侧' : '左侧'}边缘宽度`}
            aria-orientation="vertical"
            aria-valuenow={size.width}
            tabIndex={0}
            className={`group absolute inset-y-0 z-20 w-2 touch-none cursor-ew-resize outline-none ${mode === 'left' ? 'right-0' : 'left-0'}`}
            onPointerDown={(event) => interaction.onResizePointerDown(event, 'width')}
            onKeyDown={(event) => interaction.onResizeKeyDown(event, 'width')}
          >
          </div>
        ) : (
          <>
            <div
              role="separator"
              aria-label="调整智能助手宽度"
              aria-orientation="vertical"
              aria-valuenow={size.width}
              tabIndex={0}
              className="group absolute bottom-4 right-0 top-10 z-20 w-2 touch-none cursor-ew-resize outline-none"
              onPointerDown={(event) => interaction.onResizePointerDown(event, 'width')}
              onKeyDown={(event) => interaction.onResizeKeyDown(event, 'width')}
            >
            </div>
            <div
              role="separator"
              aria-label="调整智能助手高度"
              aria-orientation="horizontal"
              aria-valuenow={size.height}
              tabIndex={0}
              className="group absolute bottom-0 left-4 right-4 z-20 h-2 touch-none cursor-ns-resize outline-none"
              onPointerDown={(event) => interaction.onResizePointerDown(event, 'height')}
              onKeyDown={(event) => interaction.onResizeKeyDown(event, 'height')}
            >
            </div>
            <div
              role="separator"
              aria-label="同时调整智能助手宽度和高度"
              aria-valuetext={`${size.width} × ${size.height}`}
              tabIndex={0}
              className="group absolute bottom-0 right-0 z-30 h-4 w-4 touch-none cursor-nwse-resize outline-none"
              onPointerDown={(event) => interaction.onResizePointerDown(event, 'both')}
              onKeyDown={(event) => interaction.onResizeKeyDown(event, 'both')}
            >
            </div>
          </>
        )}
      </aside>
      </div>
    </>
  )
}
