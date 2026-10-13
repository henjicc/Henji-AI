import { UI_ICON_SIZE_CLASS } from '@/components/ui/styleTokens'
import { isImageEditorInputBlockedV3 } from './imageEditorInputScopeV3'
import { Clipboard, Copy, Layers } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { PanelTrigger, UiButton, UiIconButton, UiOptionButton } from '@/components/ui'
import { createLogger } from '@/core/logging'
import { copyImageEditClipboardV3, pasteImageEditClipboardV3 } from '../application/imageEditClipboardV3'
import type { ImageEditCommandBusV3 } from '../application/imageEditCommandBus'
import type { ImageEditorV3Controller } from './types'
import { useImageEditorSessionStoreV3 } from '../store'

const logger = createLogger('features.imageEdit.v3.clipboard')
type Action = 'copy' | 'merged' | 'paste'
export function ImageEditorClipboardV3({ bus, controller }: { bus: ImageEditCommandBusV3; controller: ImageEditorV3Controller }): JSX.Element {
  const anchor = useRef<HTMLDivElement>(null)
  const operation = useRef<AbortController>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const execute = async (action: Action): Promise<void> => {
    if (operation.current) return
    const abort = new AbortController(); operation.current = abort; setBusy(true); setError(undefined)
    try {
      const state = useImageEditorSessionStoreV3.getState()
      const signal = AbortSignal.any([abort.signal, bus.getLifecycleSignal()])
      if (action === 'paste') state.setSelectedLayerIds(controller.sessionId, [await pasteImageEditClipboardV3(bus, signal)])
      else await copyImageEditClipboardV3(bus, state.sessions[controller.sessionId]?.selectedLayerIds ?? [], action === 'merged', signal)
    } catch (cause) {
      if (!abort.signal.aborted && !bus.getLifecycleSignal().aborted) {
        setError(cause instanceof Error ? cause.message : '剪贴板操作失败，请重试')
        logger.warn('图片剪贴板操作失败', { event: 'image_edit.clipboard.operation.failed', error: cause, context: { action } })
      }
    } finally { operation.current = undefined; setBusy(false) }
  }
  const executeRef = useRef(execute); executeRef.current = execute
  useEffect(() => {
    const root = anchor.current?.closest('[data-image-editor-v3]')
    const editable = (target: EventTarget | null): boolean => target instanceof Element && Boolean(target.closest('input,textarea,select,[contenteditable]:not([contenteditable="false"]),[role="textbox"],[role="slider"]'))
    const down = (event: KeyboardEvent): void => {
      if (!(event.target instanceof Node) || !root?.contains(event.target) || editable(event.target) || event.defaultPrevented || event.isComposing || event.altKey || !(event.ctrlKey || event.metaKey) || isImageEditorInputBlockedV3(root)) return
      if ([...document.querySelectorAll('[role="dialog"],[role="menu"]')].some(element => !element.contains(root) && element.getClientRects().length > 0 && !element.closest('[inert],[aria-hidden="true"]'))) return
      const key = event.key.toLowerCase()
      if (key !== 'c' && (key !== 'v' || event.shiftKey)) return
      event.preventDefault(); event.stopImmediatePropagation()
      void executeRef.current(key === 'v' ? 'paste' : event.shiftKey ? 'merged' : 'copy')
    }
    window.addEventListener('keydown', down, true)
    return () => { window.removeEventListener('keydown', down, true); operation.current?.abort() }
  }, [bus, controller.sessionId])
  return <div ref={anchor} className="flex min-w-0 items-center gap-1">
    <PanelTrigger panelPadding="menu" panelSize="menu" closeOnPanelClick renderPanel={() => <div role="menu" aria-label="图片剪贴板" className="flex flex-col gap-1">
      <UiOptionButton variant="menu" role="menuitem" disabled={busy} onClick={() => { void execute('copy') }}><Copy className={`${UI_ICON_SIZE_CLASS.md}`} />复制图层或选区 Ctrl+C</UiOptionButton>
      <UiOptionButton variant="menu" role="menuitem" disabled={busy} onClick={() => { void execute('merged') }}><Layers className={`${UI_ICON_SIZE_CLASS.md}`} />复制合成结果 Ctrl+Shift+C</UiOptionButton>
      <UiOptionButton variant="menu" role="menuitem" disabled={busy} onClick={() => { void execute('paste') }}><Clipboard className={`${UI_ICON_SIZE_CLASS.md}`} />粘贴图片 Ctrl+V</UiOptionButton>
    </div>}>
      {({ togglePanel, open }) => <UiIconButton onClick={togglePanel} aria-haspopup="menu" aria-expanded={open} aria-label="图片剪贴板" title="图片剪贴板" size="md"><Clipboard  /></UiIconButton>}
    </PanelTrigger>
    {busy && <UiButton size="sm" onClick={() => operation.current?.abort()}>取消</UiButton>}
      {error && <span data-image-edit-clipboard-error role="alert" className="max-w-48 truncate text-xs text-text2" title={error}>{error}</span>}
  </div>
}
