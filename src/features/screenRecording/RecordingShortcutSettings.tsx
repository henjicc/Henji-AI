import { useEffect, useState } from 'react'
import { UiButton, UiError, UiFormRow, UiGroup } from '@/components/ui'
import { DEFAULT_RECORDING_SHORTCUTS, recordingActions, type RecordingAction } from '@/core/screenRecording/contracts'
import { useSettingsStore } from '@/stores/settingsStore'
import { useI18n } from '@/hooks/useI18n'

export function RecordingShortcutSettings(): React.ReactElement {
  const { t } = useI18n('settings')
  const shortcuts = useSettingsStore(state => state.recordingShortcuts)
  const [capture, setCapture] = useState<RecordingAction | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    if (!capture) return
    const listener = (event: KeyboardEvent): void => {
      event.preventDefault(); event.stopPropagation()
      if (event.repeat || event.isComposing || ['Control', 'Shift', 'Alt', 'Meta'].includes(event.key)) return
      if (event.key === 'Escape') { setCapture(null); return }
      const key = /^Key[A-Z]$/.test(event.code) ? event.code.slice(3) : /^Digit[0-9]$/.test(event.code) ? event.code.slice(5) : /^F(?:[1-9]|1[0-9]|2[0-4])$/.test(event.code) ? event.code : null
      if (!key || !event.ctrlKey && !event.metaKey && !event.altKey) { setError(t('recordingShortcuts.invalid')); return }
      const mac = /Mac/.test(navigator.userAgent)
      const accelerator = [...(event.ctrlKey ? [mac ? 'Control' : 'CommandOrControl'] : []), ...(event.metaKey ? [mac ? 'CommandOrControl' : 'Super'] : []), ...(event.altKey ? ['Alt'] : []), ...(event.shiftKey ? ['Shift'] : []), key].join('+')
      try { useSettingsStore.getState().setRecordingShortcuts({ ...shortcuts, [capture]: accelerator }); setError(''); setCapture(null) }
      catch { setError(t('recordingShortcuts.duplicate')) }
    }
    window.addEventListener('keydown', listener, true)
    return () => window.removeEventListener('keydown', listener, true)
  }, [capture, shortcuts, t])
  return <UiGroup title={t('recordingShortcuts.title')} info={t('recordingShortcuts.info')}>
    {recordingActions.map(action => <UiFormRow key={action} label={t(`recordingShortcuts.${action}`)} inline>
      <UiButton size="sm" aria-pressed={capture === action} aria-label={t('recordingShortcuts.change', { action: t(`recordingShortcuts.${action}`) })} onClick={() => { setCapture(action); setError('') }}>{capture === action ? t('recordingShortcuts.capture') : shortcuts[action]?.replace('CommandOrControl', 'Ctrl / Command') ?? t('recordingShortcuts.unset')}</UiButton>
      <UiButton size="sm" onClick={() => { setCapture(null); useSettingsStore.getState().setRecordingShortcuts({ ...shortcuts, [action]: null }) }}>{t('recordingShortcuts.clear')}</UiButton>
    </UiFormRow>)}
    <UiButton onClick={() => { setCapture(null); setError(''); useSettingsStore.getState().setRecordingShortcuts({ ...DEFAULT_RECORDING_SHORTCUTS }) }}>{t('recordingShortcuts.reset')}</UiButton>
    {error && <UiError size="xs" align="start" title={error} message="" />}
  </UiGroup>
}
