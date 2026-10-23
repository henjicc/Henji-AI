import { useTranslation } from 'react-i18next'
import { FolderOpen, MonitorPlay, Square } from 'lucide-react'
import { UiButton, UiEmpty, UiError, UiGroup, UiInlineStatus, UiOptionButton, UiRecordItem, UiRecordList, UiRegion } from '@/components/ui'
import { ICON_TOOL_SCREEN_RECORDING } from '@/core/theme/icons'
import type { WebAppRecordingModel } from './useWebAppRecording'

export function WebAppRecordingActions({ model }: { model: WebAppRecordingModel }): React.ReactElement {
  const { t } = useTranslation('ui')
  if (model.activeId) return <UiButton variant="primary" loading={model.busy} onClick={() => void model.stop()}><Square />{t('recording.stop')}</UiButton>
  return <UiButton variant="primary" loading={model.busy} disabled={!model.selected} disabledReason={t('recording.webapp_selectApp')} onClick={() => void model.start()}><ICON_TOOL_SCREEN_RECORDING />{t('recording.start')}</UiButton>
}

export function WebAppRecordingPanel({ model }: { model: WebAppRecordingModel }): React.ReactElement {
  const { t } = useTranslation('ui')
  const apps = model.server?.apps ?? []
  return <div className="flex min-h-0 flex-1 justify-center overflow-auto px-6 py-8" data-web-app-recording>
    <UiRegion maxWidthClassName="max-w-2xl" className="flex flex-col">
      {model.server && !model.server.listening && <UiError message={model.server.error ?? t('recording.webapp_serverDown')} />}
      {model.error && <UiError message={model.error} />}
      <UiGroup title={t('recording.webapp_apps')}>
        {apps.length ? <div className="flex flex-col gap-1" role="radiogroup" aria-label={t('recording.webapp_apps')}>
          {apps.map(app => <UiOptionButton key={app.connectionId} variant="menu" active={app.connectionId === model.selected} onClick={() => model.select(app.connectionId)}>
            <span className="flex min-w-0 flex-col items-start">
              <span className="truncate">{app.app.name}{app.recordingId ? ` · ${t('recording.webapp_recordingNow')}` : ''}</span>
              <span className="truncate text-xs text-text3">{t(`recording.webapp_host_${app.host}`)} · {app.env.url} · {Math.round(app.env.viewport.width)}×{Math.round(app.env.viewport.height)}</span>
            </span>
          </UiOptionButton>)}
        </div> : <UiEmpty title={t('recording.webapp_noApps')} description={t('recording.webapp_noAppsHint')} />}
      </UiGroup>
      <UiGroup title={t('recording.webapp_recordings')}>
        {model.recordings.length ? <UiRecordList>
          {model.recordings.map((recording, index) => {
            const render = model.renders[recording.id]
            const conflicts = render?.result?.issues.filter(issue => issue.kind === 'conflict').length ?? 0
            return <UiRecordItem key={recording.id} index={index} density="panel"
              title={`${recording.app.name} ${new Date(recording.createdAt).toLocaleString()}`}
              meta={[t('recording.webapp_duration', { seconds: Math.round(recording.durationUs / 1_000_000) }), t(`recording.webapp_status_${recording.status}`)]}
              status={render?.error ? <UiInlineStatus tone="error">{render.error}</UiInlineStatus>
                : render?.result ? <UiInlineStatus tone={conflicts ? 'warning' : 'success'}>{conflicts ? t('recording.webapp_conflicts', { count: conflicts }) : t('recording.webapp_rendered')}</UiInlineStatus>
                : recording.warnings.length ? <UiInlineStatus tone="warning">{t('recording.webapp_warnings', { count: recording.warnings.length })}</UiInlineStatus> : null}
              actions={recording.status === 'recording' ? null : <>
                <UiButton size="sm" loading={render?.busy} onClick={() => void model.render(recording.id)}><MonitorPlay />{t('recording.webapp_render')}</UiButton>
                {render?.result && <UiButton size="sm" onClick={() => void model.reveal(recording.id, render.result!.output)}><FolderOpen />{t('recording.webapp_reveal')}</UiButton>}
              </>} />
          })}
        </UiRecordList> : <UiEmpty title={t('recording.webapp_noRecordings')} />}
      </UiGroup>
    </UiRegion>
  </div>
}
