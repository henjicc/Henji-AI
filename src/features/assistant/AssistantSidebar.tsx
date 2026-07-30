import { BrainCircuit, GripHorizontal, History, MessageSquarePlus, PanelLeft, PanelRight, PictureInPicture2, Sparkles, X } from 'lucide-react'
import { useState, type CSSProperties, type RefObject } from 'react'

import { UI_PANEL_SURFACE_CLASS, UI_TEXT_SECTION_CLASS, UiIconButton } from '@/components/ui'
import { useDialogTransition } from '@/components/ui/useDialogTransition'

import { AssistantConversation } from './conversation/AssistantConversation'
import { AssistantRunHistory } from './history/AssistantRunHistory'
import { AssistantMemoryPanel } from './memory/AssistantMemoryPanel'
import { useAssistantPanelInteraction } from './hooks/useAssistantPanelInteraction'
import { useAssistantUiStore, type AssistantDockMode } from './store/assistantUiStore'

const modeLabels: Record<AssistantDockMode, string> = {
  left: '停靠左侧',
  right: '停靠右侧',
  floating: '悬浮模式',
}

const HEADER_ICON_BUTTON_CLASS = '!h-8 !w-8 shrink-0'

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
  const { shouldRender, isVisible } = useDialogTransition(open, 180)
  const interaction = useAssistantPanelInteraction({
    enabled: open,
    mode,
    position,
    size,
    workspaceRef,
    onCommitPosition: setFloatingPosition,
    onCommitSize: setSize,
  })

  const positionStyle: CSSProperties = mode === 'floating'
    ? {
        left: 0,
        top: 0,
        width: size.width,
        height: size.height,
        transform: `translate3d(${position.x}px, ${position.y}px, 0)`,
        transformOrigin: 'top left',
        contain: 'layout paint style',
        backfaceVisibility: 'hidden',
        maxWidth: 'calc(100vw - 24px)',
        maxHeight: 'calc(100vh - 60px)',
      }
    : {
        top: 40,
        bottom: 0,
        width: size.width,
        transform: 'translate3d(0, 0, 0)',
        transformOrigin: mode === 'right' ? 'top right' : 'top left',
        contain: 'layout paint style',
        backfaceVisibility: 'hidden',
        ...(mode === 'left' ? { left: 0 } : { right: 0 }),
      }

  const hiddenTransform = mode === 'left'
    ? '-translate-x-3 opacity-0'
    : mode === 'right'
      ? 'translate-x-3 opacity-0'
      : 'translate-y-2 scale-[0.985] opacity-0'

  if (!shouldRender) return <></>

  return (
    <div
      ref={interaction.panelRef}
      data-assistant-sidebar
      className={`pointer-events-none fixed z-panel min-h-0 ${mode === 'floating' ? 'will-change-transform' : ''}`}
      style={positionStyle}
    >
      <aside
        aria-label="智能助手"
        aria-hidden={!open}
        className={`relative flex h-full min-h-0 w-full flex-col overflow-hidden ${UI_PANEL_SURFACE_CLASS} transition-[opacity,transform] duration-200 ease-out ${
          mode === 'floating' ? 'rounded-2xl' : mode === 'left' ? 'rounded-r-2xl border-l-0' : 'rounded-l-2xl border-r-0'
        } ${isVisible ? 'pointer-events-auto translate-x-0 translate-y-0 scale-100 opacity-100' : `pointer-events-none ${hiddenTransform}`}`}
      >
        <header
          className={`flex h-11 shrink-0 touch-none select-none items-center gap-2 border-b border-border-dark bg-panel px-2.5 ${
            mode === 'floating' ? interaction.dragging ? 'cursor-grabbing' : 'cursor-move' : ''
          }`}
          onPointerDown={interaction.onDragPointerDown}
        >
          <div className="flex min-w-0 flex-1 items-center gap-2 px-1">
            <Sparkles className="h-4 w-4 shrink-0 text-brand-300" />
            <div className={`min-w-0 truncate ${UI_TEXT_SECTION_CLASS}`}>智能助手</div>
            {mode === 'floating' ? <GripHorizontal className={`ml-1 h-4 w-4 text-text-muted ${interaction.dragging ? 'text-accent' : ''}`} /> : null}
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
                onClick={() => setContentView('history')}
                title="对话历史"
                aria-label="对话历史"
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
                onClick={() => setContentView('memory')}
                title="助手记忆"
                aria-label="助手记忆"
                className={HEADER_ICON_BUTTON_CLASS}
              >
                <BrainCircuit className="h-4 w-4" />
              </UiIconButton>
            </div>

            <div aria-hidden="true" className="mx-1.5 h-4 w-px bg-border-dark" />

            <div role="group" aria-label="面板位置" className="flex items-center gap-0.5">
              <UiIconButton
                type="button"
                showBorder={false}
                appearance="hover-only"
                active={mode === 'left'}
                aria-pressed={mode === 'left'}
                onClick={() => setMode('left')}
                title={modeLabels.left}
                aria-label={modeLabels.left}
                className={HEADER_ICON_BUTTON_CLASS}
              >
                <PanelLeft className="h-4 w-4" />
              </UiIconButton>
              <UiIconButton
                type="button"
                showBorder={false}
                appearance="hover-only"
                active={mode === 'right'}
                aria-pressed={mode === 'right'}
                onClick={() => setMode('right')}
                title={modeLabels.right}
                aria-label={modeLabels.right}
                className={HEADER_ICON_BUTTON_CLASS}
              >
                <PanelRight className="h-4 w-4" />
              </UiIconButton>
              <UiIconButton
                type="button"
                showBorder={false}
                appearance="hover-only"
                active={mode === 'floating'}
                aria-pressed={mode === 'floating'}
                onClick={() => setMode('floating')}
                title={modeLabels.floating}
                aria-label={modeLabels.floating}
                className={HEADER_ICON_BUTTON_CLASS}
              >
                <PictureInPicture2 className="h-4 w-4" />
              </UiIconButton>
              <UiIconButton
                type="button"
                showBorder={false}
                appearance="hover-only"
                onClick={() => setOpen(false)}
                title="收起智能助手"
                aria-label="收起智能助手"
                hoverVariant="danger"
                className={`${HEADER_ICON_BUTTON_CLASS} ml-1`}
              >
                <X className="h-4 w-4" />
              </UiIconButton>
            </div>
          </div>
        </header>
        {contentView === 'conversation' ? <AssistantConversation key={conversationVersion} /> : null}
        {contentView === 'history'
          ? <AssistantRunHistory onOpenConversation={() => setContentView('conversation')} />
          : null}
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
  )
}
