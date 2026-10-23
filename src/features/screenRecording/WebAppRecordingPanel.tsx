import { useTranslation } from 'react-i18next'
import { FolderOpen, MonitorPlay, Square, SquarePlay, Trash2 } from 'lucide-react'
import { Dropdown, UiButton, UiEmpty, UiError, UiFormRow, UiGroup, UiInlineStatus, UiOptionButton } from '@/components/ui'
import { UI_TEXT_TIMECODE_CLASS } from '@/components/ui/styleTokens'
import { ICON_TOOL_SCREEN_RECORDING } from '@/core/theme/icons'
import { useNotification } from '@/contexts/NotificationContext'
import { resolveImageDisplayUrl } from '@/services/imageSource'
import { recordingTimeLabel } from './useRecordingControlSnapshot'
import type { WebAppRecordingModel } from './useWebAppRecording'

/** Command band: the one primary action (start or stop) of the web app mode. */
export function WebAppRecordingActions({ model }: { model: WebAppRecordingModel }): React.ReactElement {
  const { t } = useTranslation('ui')
  if (model.activeId) return <UiButton variant="primary" loading={model.busy} onClick={() => void model.stop()}><Square />{t('recording.stop')}</UiButton>
  return <UiButton variant="primary" loading={model.busy} disabled={!model.selectedApp} disabledReason={t('recording.webapp_selectApp')} onClick={() => void model.start()}><ICON_TOOL_SCREEN_RECORDING />{t('recording.start')}</UiButton>
}

/** Command band text while recording: the same elapsed-time label as screen recording. */
export function WebAppRecordingStatus({ model }: { model: WebAppRecordingModel }): React.ReactElement | null {
  const { t } = useTranslation('ui')
  if (!model.activeId) return null
  return <span className={`${UI_TEXT_TIMECODE_CLASS} text-xs text-text2`}>{model.elapsedMs ? recordingTimeLabel(model.elapsedMs) : t('recording.webapp_reloading')}</span>
}

function Preview({ model }: { model: WebAppRecordingModel }): React.ReactElement {
  const { t } = useTranslation('ui')
  const recording = model.selectedRecording
  const render = recording ? model.renders[recording.id] : undefined
  const recordingApp = model.server?.apps.find(app => app.recordingId)
  const hasApps = Boolean(model.server?.apps.length)
  if (recordingApp) return <UiEmpty title={t('recording.webapp_recordingIn', { app: recordingApp.app.name })} description={t('recording.webapp_recordingHint')} />
  if (!recording) return <UiEmpty title={hasApps ? t('recording.webapp_readyTitle') : t('recording.webapp_noApps')} description={hasApps ? t('recording.webapp_readyHint') : t('recording.webapp_noAppsHint')} />
  if (render?.busy) {
    return <div className="flex h-full w-full flex-col items-center justify-center gap-3">
      {render.frame ? <img src={render.frame} alt="" className="min-h-0 max-w-full flex-1 object-contain" /> : null}
      <span className="text-xs text-text2">{t('recording.webapp_rendering', { percent: Math.round(render.progress * 100) })}</span>
    </div>
  }
  if (recording.video) {
    // `#t=1` shows a frame from one second in, past the app's blank startup frame.
    return <video key={recording.video} src={`${resolveImageDisplayUrl(recording.video)}#t=1`} controls className="max-h-full max-w-full bg-media" />
  }
  return <UiEmpty title={t('recording.webapp_noVideo')} description={t('recording.webapp_noVideoHint')} />
}

/**
 * Same layout as recording the screen: the picture on the left, choices on the right. The left side
 * previews the selected recording (live frames while it replays, then the video); the right side
 * picks the app to record and lists saved recordings.
 */
export function WebAppRecordingPanel({ model }: { model: WebAppRecordingModel }): React.ReactElement {
  const { t } = useTranslation('ui')
  const { showNotification } = useNotification()
  const apps = model.server?.apps ?? []
  const recording = model.selectedRecording
  const render = recording ? model.renders[recording.id] : undefined
  const conflicts = render?.result?.issues.filter(issue => issue.kind === 'conflict').length ?? 0
  const remove = async (id: string): Promise<void> => {
    await model.remove(id)
    showNotification(t('recording.webapp_removed'), 'success', { label: t('recording.webapp_undo'), onClick: () => void model.restore(id) })
  }
  return <div className="flex min-h-0 flex-1" data-web-app-recording>
    <div className="flex min-w-0 flex-1 flex-col bg-gap">
      <div className="flex min-h-0 flex-1 items-center justify-center p-6">
        <Preview model={model} />
      </div>
      {recording && !model.activeId && <div className="flex items-center gap-2 px-4 pb-4">
        <span className="min-w-0 flex-1">
          {render?.error ? <UiInlineStatus tone="error" truncate tooltip={render.error}>{render.error}</UiInlineStatus>
            : render?.result ? <UiInlineStatus tone={conflicts ? 'warning' : 'success'}>{conflicts ? t('recording.webapp_conflicts', { count: conflicts }) : t('recording.webapp_rendered')}</UiInlineStatus>
            : recording.warnings.length ? <UiInlineStatus tone="warning">{t('recording.webapp_warnings', { count: recording.warnings.length })}</UiInlineStatus> : null}
        </span>
        <UiButton variant="secondary" loading={render?.busy} onClick={() => void model.render(recording.id)}><MonitorPlay />{recording.video ? t('recording.webapp_rerender') : t('recording.webapp_render')}</UiButton>
        <UiButton onClick={() => void model.reveal(recording.id, recording.video ?? undefined)}><FolderOpen />{t('recording.webapp_reveal')}</UiButton>
        {recording.backupVideo && <UiButton onClick={() => void model.reveal(recording.id, recording.backupVideo ?? undefined)}><SquarePlay />{t('recording.webapp_backup')}</UiButton>}
        <UiButton variant="danger" disabled={render?.busy} disabledReason={t('recording.webapp_busyRendering')} onClick={() => void remove(recording.id)}><Trash2 />{t('recording.webapp_delete')}</UiButton>
      </div>}
    </div>
    <aside className="flex w-80 shrink-0 flex-col gap-6 overflow-auto border-l border-gap bg-panel p-4" aria-label={t('recording.options')}>
      {model.server && model.server.enabled && !model.server.listening && <UiError message={model.server.error ?? t('recording.webapp_serverDown')} />}
      {model.error && <UiError message={model.error} />}
      <UiGroup title={t('recording.webapp_app')} titleTone="compact" labelWidth={72}>
        <UiFormRow label={t('recording.webapp_appLabel')} density="compact">
          <Dropdown size="sm" value={model.selectedApp} emptyLabel={t('recording.webapp_waiting')} disabled={!apps.length || Boolean(model.activeId)}
            disabledReason={apps.length ? t('recording.webapp_busyRecording') : t('recording.webapp_noAppsShort')}
            options={apps.map(app => ({ value: app.connectionId, label: `${app.app.name} · ${t(`recording.webapp_host_${app.host}`)}`, tooltip: app.env.url }))} onSelect={model.selectApp} />
        </UiFormRow>
      </UiGroup>
      <UiGroup title={t('recording.webapp_recordings')} titleTone="compact">
        {model.recordings.length ? <div className="flex flex-col gap-1" role="listbox" aria-label={t('recording.webapp_recordings')}>
          {model.recordings.map(item => <UiOptionButton key={item.id} variant="menu" active={item.id === recording?.id} onClick={() => model.selectRecording(item.id)}>
            <span className="flex min-w-0 flex-col items-start gap-0.5">
              <span className="truncate">{item.app.name} · {new Date(item.createdAt).toLocaleString()}</span>
              <span className={`${UI_TEXT_TIMECODE_CLASS} text-xs text-text3`}>{recordingTimeLabel(item.durationUs / 1000)}{item.status === 'complete' ? '' : ` · ${t(`recording.webapp_status_${item.status}`)}`}{item.video ? ` · ${t('recording.webapp_hasVideo')}` : ''}{item.backupVideo ? ` · ${t('recording.webapp_hasBackup')}` : ''}</span>
            </span>
          </UiOptionButton>)}
        </div> : <p className="text-xs text-text3">{t('recording.webapp_noRecordings')}</p>}
      </UiGroup>
    </aside>
  </div>
}
