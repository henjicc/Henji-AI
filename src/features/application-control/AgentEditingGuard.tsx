import { useEffect, useRef, useState, type RefObject } from 'react'
import { UiButton, UiPanel } from '@/components/ui'
import { useI18n } from '@/hooks/useI18n'
import { currentDocumentContext, getDocumentSessionRegistry } from '@/features/documents'
import { useNavigationStore } from '@/stores/navigationStore'
import {
  isAgentEditingSession, releaseAgentDocument, takeOverAgentDocument, useAgentEditingStore, type AgentEditingCaller,
} from './agentEditing'

type Translate = ReturnType<typeof useI18n>['t']

function callerName(caller: AgentEditingCaller, t: Translate): string {
  if (caller.kind === 'embedded') return t('agentEditing.embedded')
  return caller.name ? t('agentEditing.externalNamed', { name: caller.name }) : t('agentEditing.external')
}

function documentName(id: string): string | undefined {
  return getDocumentSessionRegistry().get(id)?.documentMeta.name
}

/** 当前工作区正在看的文档。currentDocumentContext 不是响应式的：跟着导航与助手编辑状态变化重新计算。 */
function useCurrentDocumentId(): string | undefined {
  useNavigationStore((state) => `${state.activeWorkspace}:${state.activeToolId ?? ''}`)
  useAgentEditingStore((state) => state.sessions)
  useAgentEditingStore((state) => state.takenOver)
  return currentDocumentContext().documentId
}

const editableTarget = (target: EventTarget | null): boolean => target instanceof HTMLElement
  && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))

/**
 * 助手正在编辑当前这份文档时：编辑区四周发光，暂时不让人改（可以看、滚动、空格播放），
 * 人一动手才在工作区中间问要不要接管——平时不压在任何控件上，状态看标题栏。
 * 只拦截落在工作区里的输入；标题栏、助手侧栏、其他浮层照常。
 */
export function AgentEditingGuard({ containerRef }: { containerRef: RefObject<HTMLElement> }): JSX.Element | null {
  const { t } = useI18n('ui')
  const documentId = useCurrentDocumentId()
  const session = useAgentEditingStore((state) => (documentId ? state.sessions[documentId] : undefined))
  const editing = isAgentEditingSession(session)
  const bannerRef = useRef<HTMLDivElement>(null)
  const [asking, setAsking] = useState(false)

  useEffect(() => {
    if (!editing) { setAsking(false); return }
    const inside = (target: EventTarget | null): boolean => {
      const node = target === document.body ? containerRef.current : target
      return node instanceof Node && Boolean(containerRef.current?.contains(node)) && !bannerRef.current?.contains(node)
    }
    const block = (event: Event): void => {
      if (!inside(event.target)) return
      event.preventDefault()
      event.stopPropagation()
      setAsking(true)
    }
    const key = (event: KeyboardEvent): void => {
      if (['Shift', 'Control', 'Alt', 'Meta'].includes(event.key)) return
      if (event.key === 'Escape' && inside(event.target)) { event.preventDefault(); event.stopPropagation(); setAsking(false); return }
      // 空格播放照常：只在不是输入框、也没按修饰键时放行
      if (event.key === ' ' && !event.ctrlKey && !event.metaKey && !event.altKey && !editableTarget(event.target)) return
      block(event)
    }
    const pointerEvents = ['pointerdown', 'mousedown', 'click', 'dblclick', 'contextmenu', 'dragstart', 'drop', 'paste', 'cut'] as const
    for (const name of pointerEvents) window.addEventListener(name, block, true)
    window.addEventListener('keydown', key, true)
    return () => {
      for (const name of pointerEvents) window.removeEventListener(name, block, true)
      window.removeEventListener('keydown', key, true)
    }
  }, [editing, containerRef])

  if (!editing || !documentId || !session) return null
  return (
    <>
      <div aria-hidden className="ui-agent-editing-frame pointer-events-none absolute inset-0 z-sticky" />
      {asking ? (
        <div className="pointer-events-none absolute inset-4 z-sticky flex items-center justify-center">
          <UiPanel ref={bannerRef} role="alertdialog" aria-label={t('agentEditing.takeOver')} className="pointer-events-auto flex min-w-0 max-w-md flex-col gap-3 p-4">
            <span className="flex min-w-0 items-center gap-2 text-13 text-text1">
              <span aria-hidden className="ui-agent-editing-dot shrink-0" />
              {t('agentEditing.asking', { who: callerName(session.caller, t) })}
            </span>
            <span className="flex justify-end gap-2">
              <UiButton size="sm" onClick={() => setAsking(false)}>{t('agentEditing.wait')}</UiButton>
              <UiButton size="sm" variant="primary" onClick={() => takeOverAgentDocument(documentId)}>{t('agentEditing.takeOver')}</UiButton>
            </span>
          </UiPanel>
        </div>
      ) : null}
    </>
  )
}

/** 标题栏里的状态：在任何页面都能看到助手正在改哪份文档，随时接管；接管后可以交还。 */
export function AgentEditingStatus(): JSX.Element | null {
  const { t } = useI18n('ui')
  const sessions = useAgentEditingStore((state) => state.sessions)
  const takenOver = useAgentEditingStore((state) => state.takenOver)
  const editing = Object.values(sessions).find((session) => isAgentEditingSession(session) && documentName(session.documentId))
  const held = Object.keys(takenOver).find((id) => documentName(id))
  if (editing) {
    const name = documentName(editing.documentId)!
    return (
      <div className="flex min-w-0 items-center gap-2 pl-2 pr-1 text-xs text-text2" role="status">
        <span aria-hidden className="ui-agent-editing-dot shrink-0" />
        <span className="min-w-0 truncate">{t('agentEditing.editing', { who: callerName(editing.caller, t), document: name })}</span>
        <UiButton size="sm" className="shrink-0" onClick={() => takeOverAgentDocument(editing.documentId)}>{t('agentEditing.takeOver')}</UiButton>
      </div>
    )
  }
  if (!held) return null
  return (
    <div className="flex min-w-0 items-center gap-2 pl-2 pr-1 text-xs text-text2" role="status">
      <span className="min-w-0 truncate">{t('agentEditing.takenOver', { document: documentName(held)! })}</span>
      <UiButton size="sm" className="shrink-0" tooltip={t('agentEditing.releaseHint')} onClick={() => releaseAgentDocument(held)}>{t('agentEditing.release')}</UiButton>
    </div>
  )
}
