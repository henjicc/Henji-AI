import { GripHorizontal, PanelLeft, PanelRight, PictureInPicture2, Sparkles, X } from 'lucide-react'

import { UiIconButton } from '@/components/ui'
import { useDialogTransition } from '@/components/ui/useDialogTransition'

import { AssistantConversation } from './conversation/AssistantConversation'
import { useAssistantFloatingDrag } from './hooks/useAssistantFloatingDrag'
import { useAssistantUiStore, type AssistantDockMode } from './store/assistantUiStore'

const modeLabels: Record<AssistantDockMode, string> = {
  left: '停靠左侧',
  right: '停靠右侧',
  floating: '悬浮模式',
}

export function AssistantSidebar(): JSX.Element {
  const open = useAssistantUiStore((state) => state.open)
  const mode = useAssistantUiStore((state) => state.mode)
  const position = useAssistantUiStore((state) => state.floatingPosition)
  const size = useAssistantUiStore((state) => state.size)
  const setOpen = useAssistantUiStore((state) => state.setOpen)
  const setMode = useAssistantUiStore((state) => state.setMode)
  const setFloatingPosition = useAssistantUiStore((state) => state.setFloatingPosition)
  const { shouldRender, isVisible } = useDialogTransition(open, 180)
  const drag = useAssistantFloatingDrag({
    enabled: mode === 'floating' && open,
    position,
    size,
    onCommit: setFloatingPosition,
  })

  const positionStyle = mode === 'floating'
    ? {
        left: drag.displayPosition.x,
        top: drag.displayPosition.y,
        width: size.width,
        height: size.height,
        maxWidth: 'calc(100vw - 24px)',
        maxHeight: 'calc(100vh - 60px)',
      }
    : {
        top: 40,
        bottom: 0,
        width: size.width,
        ...(mode === 'left' ? { left: 0 } : { right: 0 }),
      }

  const hiddenTransform = mode === 'left'
    ? '-translate-x-3 opacity-0'
    : mode === 'right'
      ? 'translate-x-3 opacity-0'
      : 'translate-y-2 scale-[0.985] opacity-0'

  if (!shouldRender) return <></>

  return (
    <aside
      aria-label="智能助手"
      aria-hidden={!open}
      data-assistant-sidebar
      className={`fixed z-40 flex min-h-0 flex-col overflow-hidden border border-border-dark bg-panel shadow-2xl transition-[opacity,transform] duration-200 ease-out ${
        mode === 'floating' ? 'rounded-2xl' : mode === 'left' ? 'rounded-r-2xl border-l-0' : 'rounded-l-2xl border-r-0'
      } ${isVisible ? 'pointer-events-auto translate-x-0 translate-y-0 scale-100 opacity-100' : `pointer-events-none ${hiddenTransform}`}`}
      style={positionStyle}
    >
      <header
        className={`flex h-12 shrink-0 select-none items-center gap-2 border-b border-border-dark bg-panel px-2.5 ${mode === 'floating' ? 'cursor-move' : ''}`}
        onPointerDown={drag.onPointerDown}
      >
        <div className="flex min-w-0 flex-1 items-center gap-2 px-1">
          <div className="rounded-lg border border-accent/30 bg-accent/10 p-1.5 text-accent"><Sparkles className="h-3.5 w-3.5" /></div>
          <div className="min-w-0">
            <div className="truncate text-xs font-medium text-text-dark">智能助手</div>
            <div className="truncate text-[10px] text-text-muted">受控工具执行轨道</div>
          </div>
          {mode === 'floating' ? <GripHorizontal className={`ml-1 h-4 w-4 text-text-muted ${drag.dragging ? 'text-accent' : ''}`} /> : null}
        </div>
        <div className="flex items-center gap-1" data-assistant-drag-ignore>
          <UiIconButton type="button" active={mode === 'left'} onClick={() => setMode('left')} title={modeLabels.left} className="!h-7 !w-7 !rounded-md"><PanelLeft className="h-3.5 w-3.5" /></UiIconButton>
          <UiIconButton type="button" active={mode === 'right'} onClick={() => setMode('right')} title={modeLabels.right} className="!h-7 !w-7 !rounded-md"><PanelRight className="h-3.5 w-3.5" /></UiIconButton>
          <UiIconButton type="button" active={mode === 'floating'} onClick={() => setMode('floating')} title={modeLabels.floating} className="!h-7 !w-7 !rounded-md"><PictureInPicture2 className="h-3.5 w-3.5" /></UiIconButton>
          <UiIconButton type="button" onClick={() => setOpen(false)} title="收起智能助手" hoverVariant="danger" className="!h-7 !w-7 !rounded-md"><X className="h-3.5 w-3.5" /></UiIconButton>
        </div>
      </header>
      <AssistantConversation />
    </aside>
  )
}
