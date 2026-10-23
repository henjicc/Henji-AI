import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { FolderOpen, MonitorPlay, Square } from 'lucide-react'
import { Dropdown, PanelTrigger, UiButton, UiEmpty, UiError, UiFormRow, UiGroup, UiInlineStatus, UiSegmented, UiSwitch } from '@/components/ui'
import { UI_TEXT_TIMECODE_CLASS } from '@/components/ui/styleTokens'
import { VideoViewerModal } from '@/components/mediaViewer/VideoViewerModal'
import { ICON_TOOL_SCREEN_RECORDING } from '@/core/theme/icons'
import type { CaptureSource } from '@/core/screenRecording/contracts'
import { AudioCaptureSettingsForm } from '@/features/audioCapture'
import type { WebRecordingBackupOptions } from '@/platform/contracts/webReplay'
import { resolveImageDisplayUrl } from '@/services/imageSource'
import type { WebAppBackupSetup } from './recordingSetupModel'
import { RecordingVideoParams } from './RecordingVideoParams'
import { recordingTimeLabel } from './useRecordingControlSnapshot'
import type { WebAppRecordingModel } from './useWebAppRecording'
import { WebAppRecordingList } from './WebAppRecordingList'

/** Command band: the one primary action (start or stop) of the web app mode. */
export function WebAppRecordingActions({ model, setup, backup }: { model: WebAppRecordingModel; setup: WebAppBackupSetup; backup: WebRecordingBackupOptions | null }): React.ReactElement {
  const { t } = useTranslation('ui')
  if (model.activeId) return <UiButton variant="primary" loading={model.busy} onClick={() => void model.stop()}><Square />{t('recording.stop')}</UiButton>
  return <UiButton variant="primary" loading={model.busy} disabled={!model.selectedApp} disabledReason={t('recording.webapp_selectApp')} onClick={() => void model.start(setup, backup)}><ICON_TOOL_SCREEN_RECORDING />{t('recording.start')}</UiButton>
}

/** Command band text while recording: the same elapsed-time label as screen recording. */
export function WebAppRecordingStatus({ model }: { model: WebAppRecordingModel }): React.ReactElement | null {
  const { t } = useTranslation('ui')
  if (!model.activeId) return null
  return <span className={`${UI_TEXT_TIMECODE_CLASS} text-xs text-text2`}>{model.elapsedMs ? recordingTimeLabel(model.elapsedMs) : t('recording.webapp_reloading')}</span>
}

type PreviewView = 'backup' | 'replay'

function Preview({ model, view }: { model: WebAppRecordingModel; view: PreviewView | null }): React.ReactElement {
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
  const file = view === 'backup' ? recording.backupVideo : view === 'replay' ? recording.video : null
  // The app's shared viewer, sized to the space left: its 16:9 frame letterboxes the recording.
  if (file) return <div className="flex aspect-video h-full max-w-full items-center"><VideoViewerModal key={file} open presentation="inline" videoUrl={resolveImageDisplayUrl(file)} filePath={file} onClose={() => undefined} /></div>
  return <UiEmpty title={t('recording.webapp_noVideo')} description={t('recording.webapp_noVideoHint')} />
}

/** The backup screen recording's choices, kept with the other recording choices across restarts. */
function BackupGroup({ value, screens, disabled, onChange }: { value: WebAppBackupSetup; screens: CaptureSource[]; disabled: boolean; onChange(patch: Partial<WebAppBackupSetup>): void }): React.ReactElement {
  const { t } = useTranslation('ui')
  const screen = screens.find(item => item.id === value.sourceId) ?? screens.find(item => item.display?.primary) ?? screens[0]
  const microphone = value.microphone ?? true
  return <>
    <UiGroup title={t('recording.webapp_backup')} titleTone="compact" labelWidth={72}>
      <UiFormRow label={t('recording.webapp_backupEnabled')} density="compact"><UiSwitch checked={value.enabled} disabled={disabled} onCheckedChange={enabled => onChange({ enabled })} /></UiFormRow>
      {value.enabled && <>
        <UiFormRow label={t('recording.rangeMode')} density="compact"><UiSegmented ariaLabel={t('recording.rangeMode')} size="sm" value={value.range} disabled={disabled} onChange={range => onChange({ range })} options={[{ value: 'window', label: t('recording.webapp_range_window') }, { value: 'screen', label: t('recording.webapp_range_screen') }]} /></UiFormRow>
        {value.range === 'screen' && <UiFormRow label={t('recording.webapp_screen')} density="compact">
          <Dropdown size="sm" value={screen?.id ?? ''} disabled={disabled || !screens.length} disabledReason={t('recording.webapp_busyBackup')} emptyLabel={t('recording.noSources')}
            options={screens.map((item, index) => ({ value: item.id, label: `${t('recording.screenNumber', { index: index + 1 })}${item.display?.primary ? ` · ${t('recording.primaryScreen')}` : ''}` }))} onSelect={sourceId => onChange({ sourceId })} />
        </UiFormRow>}
        <UiFormRow label={t('recording.quality')} density="compact">{value.range === 'screen'
          ? <UiSegmented ariaLabel={t('recording.quality')} size="sm" value={value.quality} disabled={disabled} onChange={quality => onChange({ quality })} options={[{ value: '1080p', label: '1080p' }, { value: '1440p', label: '2K' }, { value: '2160p', label: '4K' }]} />
          : <span className="text-xs text-text2">{t('recording.webapp_windowSize')}</span>}</UiFormRow>
        <UiFormRow label={t('recording.fps')} density="compact"><UiSegmented ariaLabel={t('recording.fps')} size="sm" value={value.fps} disabled={disabled} onChange={fps => onChange({ fps })} options={[{ value: 30, label: '30' }, { value: 60, label: '60' }]} /></UiFormRow>
        <RecordingVideoParams value={value} onChange={onChange} />
      </>}
    </UiGroup>
    {value.enabled && <UiGroup title={t('recording.soundGroup')} titleTone="compact" labelWidth={72}>
      <UiFormRow label={t('recording.microphone')} density="compact"><UiSwitch checked={microphone} disabled={disabled} onCheckedChange={next => onChange({ microphone: next })} /></UiFormRow>
      {microphone && <UiFormRow label={t('recording.microphoneDevice')} density="compact"><PanelTrigger display={t('recording.audioSettings')} size="sm" panelSize="compact" panelPadding="content" disabled={disabled} renderPanel={() => <AudioCaptureSettingsForm />} /></UiFormRow>}
      <UiFormRow label={t('recording.systemAudio')} density="compact"><UiSwitch checked={value.systemAudio ?? false} disabled={disabled} onCheckedChange={systemAudio => onChange({ systemAudio })} /></UiFormRow>
    </UiGroup>}
  </>
}

/**
 * Three columns: saved recordings on the left (long lists stay manageable), the picture in the middle
 * (the backup screen recording first, live frames while a replay runs, then the replay video), and what
 * to record on the right.
 */
export function WebAppRecordingPanel({ model, backup, screens, onBackupChange }: { model: WebAppRecordingModel; backup: WebAppBackupSetup; screens: CaptureSource[]; onBackupChange(patch: Partial<WebAppBackupSetup>): void }): React.ReactElement {
  const { t } = useTranslation('ui')
  const apps = model.server?.apps ?? []
  const recording = model.selectedRecording
  const render = recording ? model.renders[recording.id] : undefined
  const conflicts = render?.result?.issues.filter(issue => issue.kind === 'conflict').length ?? 0
  const [chosenView, setView] = useState<PreviewView>('backup')
  useEffect(() => setView('backup'), [recording?.id])
  // The backup plays first when there is one, since it needs no replay; a finished replay switches over.
  const view: PreviewView | null = !recording ? null
    : chosenView === 'replay' && recording.video ? 'replay'
      : recording.backupVideo ? 'backup' : recording.video ? 'replay' : null
  const shownFile = view === 'backup' ? recording?.backupVideo : view === 'replay' ? recording?.video : null
  const replay = async (id: string): Promise<void> => {
    await model.render(id)
    setView('replay')
  }
  return <div className="flex min-h-0 flex-1" data-web-app-recording>
    <WebAppRecordingList model={model} />
    <div className="flex min-w-0 flex-1 flex-col bg-gap">
      <div className="flex min-h-0 flex-1 items-center justify-center p-6">
        <Preview model={model} view={view} />
      </div>
      {recording && !model.activeId && <div className="flex items-center gap-2 px-4 pb-4">
        {recording.backupVideo && recording.video && !render?.busy && <UiSegmented ariaLabel={t('recording.webapp_view')} size="sm" value={view ?? 'backup'} onChange={setView} options={[{ value: 'backup', label: t('recording.webapp_backup') }, { value: 'replay', label: t('recording.webapp_view_replay') }]} />}
        <span className="min-w-0 flex-1">
          {render?.error ? <UiInlineStatus tone="error" truncate tooltip={render.error}>{render.error}</UiInlineStatus>
            : render?.result ? <UiInlineStatus tone={conflicts ? 'warning' : 'success'}>{conflicts ? t('recording.webapp_conflicts', { count: conflicts }) : t('recording.webapp_rendered')}</UiInlineStatus>
            : recording.warnings.length ? <UiInlineStatus tone="warning">{t('recording.webapp_warnings', { count: recording.warnings.length })}</UiInlineStatus> : null}
        </span>
        <UiButton variant="secondary" loading={render?.busy} onClick={() => void replay(recording.id)}><MonitorPlay />{recording.video ? t('recording.webapp_rerender') : t('recording.webapp_render')}</UiButton>
        <UiButton onClick={() => void model.reveal(recording.id, shownFile ?? undefined)}><FolderOpen />{t('recording.webapp_reveal')}</UiButton>
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
      <BackupGroup value={backup} screens={screens} disabled={Boolean(model.activeId)} onChange={onBackupChange} />
    </aside>
  </div>
}
