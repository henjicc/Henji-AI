import { useEffect, useState } from 'react'
import { UiButton, UiError, UiFormRow, UiModal } from '@/components/ui'
import { useI18n } from '@/hooks/useI18n'
import { useSettingsStore } from '@/stores/settingsStore'
import { parseVideoEditShortcutOverrides, VIDEO_EDIT_COMMANDS, videoEditCommandShortcut, videoEditShortcutLabel, type VideoEditCommandId, type VideoEditShortcutOverrides } from '@/core/videoEdit/commands'

/**
 * 设置行 + 弹窗（设置 → 通用 → 查看与快捷键）。和同一分节的其他设置一样是“标签左、控件右”的一行，
 * 不再是一个孤零零贴在左侧的按钮（5.6 第二批）。
 */
export function VideoEditShortcutSettings(): React.ReactElement {
  const { t } = useI18n('settings')
  const [open, setOpen] = useState(false)
  return <>
    <UiFormRow label={t('videoEditShortcuts.label')} info={t('videoEditShortcuts.info')} inline>
      <UiButton variant="secondary" onClick={() => setOpen(true)}>{t('videoEditShortcuts.edit')}</UiButton>
    </UiFormRow>
    <VideoEditShortcutDialog open={open} onClose={() => setOpen(false)} />
  </>
}

/** 快捷键弹窗本体：剪辑命令带的剪辑名菜单打开它（界面重设计 3.5），打开时读取当前持久设置作为草稿。 */
export function VideoEditShortcutDialog({ open, onClose }: { open: boolean; onClose: () => void }): React.ReactElement {
  const { t } = useI18n('settings')
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
    <UiModal isOpen={open} title={t('videoEditShortcuts.label')} size="editor" onClose={close} footer={<>
      <UiButton onClick={() => { setCapture(null); change({}) }}>{t('videoEditShortcuts.reset')}</UiButton><UiButton onClick={close}>{t('videoEditShortcuts.cancel')}</UiButton>
      <UiButton variant="primary" disabled={Boolean(error) || capture !== null} onClick={() => { try { useSettingsStore.getState().setVideoEditShortcuts(draft); close() } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) } }}>{t('videoEditShortcuts.save')}</UiButton>
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
        <p className="mb-3 text-xs text-text3">{t('videoEditShortcuts.hint')}</p>
        <div className="min-h-0 flex-1 space-y-1 overflow-y-auto">
          {VIDEO_EDIT_COMMANDS.map(command => <div className="flex items-center gap-2 border-b border-line py-1" key={command.id}>
            <span className="min-w-0 flex-1 text-xs">{command.title}</span>
            <UiButton aria-label={t('videoEditShortcuts.keyLabel', { command: command.title })} aria-pressed={capture === command.id} onClick={() => setCapture(command.id)}>{capture === command.id ? t('videoEditShortcuts.capturing') : videoEditShortcutLabel(videoEditCommandShortcut(command.id, draft))}</UiButton>
            <UiButton aria-label={t('videoEditShortcuts.clearLabel', { command: command.title })} onClick={() => { setCapture(null); change({ ...draft, [command.id]: null }) }}>{t('videoEditShortcuts.clear')}</UiButton>
          </div>)}
        </div>
        {error && <UiError size="xs" align="start" title={error} message="" />}
      </div>
    </UiModal>
  </>
}
