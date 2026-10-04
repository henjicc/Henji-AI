import { useEffect, useState } from 'react'
import { UiButton, UiError, UiFormRow, UiModal } from '@/components/ui'
import { useSettingsStore } from '@/stores/settingsStore'
import { parseVideoEditShortcutOverrides, VIDEO_EDIT_COMMANDS, videoEditCommandShortcut, videoEditShortcutLabel, type VideoEditCommandId, type VideoEditShortcutOverrides } from '@/core/videoEdit/commands'

/**
 * 设置行 + 弹窗（设置 → 界面 → 布局行为）。和同一分节的其他设置一样是“标签左、控件右”的一行，
 * 不再是一个孤零零贴在左侧的按钮（5.6 第二批）。
 */
export function VideoEditShortcutSettings(): React.ReactElement {
  const [open, setOpen] = useState(false)
  return <>
    <UiFormRow label="剪辑快捷键" info="点击键位后按下新的组合键；冲突会阻止保存。" inline>
      <UiButton variant="secondary" onClick={() => setOpen(true)}>编辑快捷键</UiButton>
    </UiFormRow>
    <VideoEditShortcutDialog open={open} onClose={() => setOpen(false)} />
  </>
}

/** 快捷键弹窗本体：剪辑命令带的工程名菜单打开它（界面重设计 3.5），打开时读取当前持久设置作为草稿。 */
export function VideoEditShortcutDialog({ open, onClose }: { open: boolean; onClose: () => void }): React.ReactElement {
  const [draft, setDraft] = useState<VideoEditShortcutOverrides>({})
  const [capture, setCapture] = useState<VideoEditCommandId | null>(null)
  const [error, setError] = useState('')
  useEffect(() => { if (open) { setDraft(structuredClone(useSettingsStore.getState().videoEditShortcuts)); setCapture(null); setError('') } }, [open])
  const close = (): void => { setCapture(null); onClose() }
  const change = (next: VideoEditShortcutOverrides): void => {
    setDraft(next)
    const result = (() => { try { parseVideoEditShortcutOverrides(next); return '' } catch (reason) { return reason instanceof Error ? reason.message : String(reason) } })()
    setError(result)
  }
  return <>
    <UiModal isOpen={open} title="剪辑快捷键" size="editor" onClose={close} footer={<>
      <UiButton onClick={() => { setCapture(null); change({}) }}>恢复默认</UiButton><UiButton onClick={close}>取消</UiButton>
      <UiButton variant="primary" disabled={Boolean(error) || capture !== null} onClick={() => { try { useSettingsStore.getState().setVideoEditShortcuts(draft); close() } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) } }}>保存快捷键</UiButton>
    </>}>
      {/* 列表占满弹窗剩余高度（原来固定 max-h-96，弹窗下半截留空） */}
      <div className="flex min-h-0 flex-1 flex-col" onKeyDownCapture={event => {
        if (!capture) return
        event.stopPropagation(); event.preventDefault()
        if (event.nativeEvent.isComposing || event.key === 'Process' || event.repeat) return
        if (event.key === 'Escape') { setCapture(null); return }
        if (['Control', 'Shift', 'Alt', 'Meta'].includes(event.key)) return
        change({ ...draft, [capture]: { code: event.code, ctrl: event.ctrlKey, shift: event.shiftKey, alt: event.altKey, meta: event.metaKey } }); setCapture(null)
      }}>
        <p className="mb-3 text-xs text-text3">点击键位后按下新的组合键。冲突会阻止保存；Esc 取消录入。工具键仅作用于时间线，播放键作用于当前监视器。</p>
        <div className="ui-scrollbar min-h-0 flex-1 space-y-1 overflow-y-auto">
          {VIDEO_EDIT_COMMANDS.map(command => <div className="flex items-center gap-2 border-b border-line py-1" key={command.id}>
            <span className="min-w-0 flex-1 text-xs">{command.title}</span>
            <UiButton aria-label={`${command.title}键位`} aria-pressed={capture === command.id} onClick={() => setCapture(command.id)}>{capture === command.id ? '请按下组合键…' : videoEditShortcutLabel(videoEditCommandShortcut(command.id, draft))}</UiButton>
            <UiButton aria-label={`清除${command.title}键位`} onClick={() => { setCapture(null); change({ ...draft, [command.id]: null }) }}>清除</UiButton>
          </div>)}
        </div>
        {error && <UiError size="xs" align="start" title={error} message="" />}
      </div>
    </UiModal>
  </>
}
