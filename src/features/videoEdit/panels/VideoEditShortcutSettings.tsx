import { useState } from 'react'
import { UiButton, UiError, UiModal } from '@/components/ui'
import { useSettingsStore } from '@/stores/settingsStore'
import { parseVideoEditShortcutOverrides, VIDEO_EDIT_COMMANDS, videoEditCommandShortcut, videoEditShortcutLabel, type VideoEditCommandId, type VideoEditShortcutOverrides } from '@/core/videoEdit/commands'

export function VideoEditShortcutSettings(): React.ReactElement {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState<VideoEditShortcutOverrides>({})
  const [capture, setCapture] = useState<VideoEditCommandId | null>(null)
  const [error, setError] = useState('')
  const close = (): void => { setOpen(false); setCapture(null) }
  const change = (next: VideoEditShortcutOverrides): void => {
    setDraft(next)
    const result = (() => { try { parseVideoEditShortcutOverrides(next); return '' } catch (reason) { return reason instanceof Error ? reason.message : String(reason) } })()
    setError(result)
  }
  return <>
    <UiButton onClick={() => { setDraft(structuredClone(useSettingsStore.getState().videoEditShortcuts)); setCapture(null); setError(''); setOpen(true) }}>剪辑快捷键</UiButton>
    <UiModal isOpen={open} title="剪辑快捷键" size="editor" onClose={close} footer={<>
      <UiButton onClick={() => { setCapture(null); change({}) }}>恢复默认</UiButton><UiButton onClick={close}>取消</UiButton>
      <UiButton variant="primary" disabled={Boolean(error) || capture !== null} onClick={() => { try { useSettingsStore.getState().setVideoEditShortcuts(draft); close() } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) } }}>保存快捷键</UiButton>
    </>}>
      <div onKeyDownCapture={event => {
        if (!capture) return
        event.stopPropagation(); event.preventDefault()
        if (event.nativeEvent.isComposing || event.key === 'Process' || event.repeat) return
        if (event.key === 'Escape') { setCapture(null); return }
        if (['Control', 'Shift', 'Alt', 'Meta'].includes(event.key)) return
        change({ ...draft, [capture]: { code: event.code, ctrl: event.ctrlKey, shift: event.shiftKey, alt: event.altKey, meta: event.metaKey } }); setCapture(null)
      }}>
        <p className="mb-3 text-xs text-text-muted">点击键位后按下新的组合键。冲突会阻止保存；Esc 取消录入。工具键仅作用于时间线，播放键作用于当前监视器。</p>
        <div className="max-h-96 space-y-1 overflow-y-auto">
          {VIDEO_EDIT_COMMANDS.map(command => <div className="flex items-center gap-2 border-b border-border-dark py-1" key={command.id}>
            <span className="min-w-0 flex-1 text-xs">{command.title}</span>
            <UiButton aria-label={`${command.title}键位`} aria-pressed={capture === command.id} onClick={() => setCapture(command.id)}>{capture === command.id ? '请按下组合键…' : videoEditShortcutLabel(videoEditCommandShortcut(command.id, draft))}</UiButton>
            <UiButton aria-label={`清除${command.title}键位`} onClick={() => { setCapture(null); change({ ...draft, [command.id]: null }) }}>清除</UiButton>
          </div>)}
        </div>
        {error && <UiError size="xs" message={error} />}
      </div>
    </UiModal>
  </>
}
