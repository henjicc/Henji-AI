import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { UiButton, UiError, UiLoading } from '@/components/ui'
import { ImageEditorV3 } from '@/features/imageEdit/v3/editor'
import { resolveImageEditorReadinessReasonV3 } from '@/features/imageEdit/v3/editor/readinessPresentationV3'
import {
  useViewerMarkEditorV3Host,
  type ViewerMarkEditorV3HostProps,
} from './useViewerMarkEditorV3Host'

export type { ViewerMarkEditorV3HostProps } from './useViewerMarkEditorV3Host'

function SessionStateShell({
  children,
  onClose,
}: {
  children: ReactNode
  onClose: () => void
}): JSX.Element {
  const { t } = useTranslation('ui')

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-app">
      <header className="flex h-12 shrink-0 items-center border-b border-border-dark bg-panel px-3">
        <span className="text-sm font-medium text-text-dark">
          {t('imageEditor.v3.viewer.title')}
        </span>
        <UiButton variant="ghost" size="sm" className="ml-auto" onClick={onClose}>
          {t('imageEditor.v3.viewer.close')}
        </UiButton>
      </header>
      {children}
    </div>
  )
}

export function ViewerMarkEditorV3Host(props: ViewerMarkEditorV3HostProps): JSX.Element {
  const { t } = useTranslation('ui')
  const host = useViewerMarkEditorV3Host(props)

  if (host.bootstrap.kind === 'loading') {
    return (
      <SessionStateShell onClose={props.onClose}>
        <UiLoading
          message={t('imageEditor.v3.viewer.loading')}
          className="min-h-0 flex-1"
        />
      </SessionStateShell>
    )
  }

  if (host.bootstrap.kind === 'failed') {
    const message = host.bootstrap.readiness
      ? resolveImageEditorReadinessReasonV3(host.bootstrap.readiness, t)
      : host.bootstrap.messageKey
        ? t(host.bootstrap.messageKey)
        : host.bootstrap.message?.trim() || undefined
    return (
      <SessionStateShell onClose={props.onClose}>
        <UiError
          className="min-h-0 flex-1"
          title={t('imageEditor.v3.viewer.bootstrapErrorTitle')}
          message={message ?? t('imageEditor.v3.viewer.bootstrapUnknown')}
          onRetry={host.retryBootstrap}
        />
      </SessionStateShell>
    )
  }

  const persistenceBusy = host.persistenceStatus?.kind === 'saving'
  const materialization = host.materialization
  const replacing = materialization !== null
  const replaceDisabled = !replacing && (
    host.busy
    || persistenceBusy
    || host.outputReadiness.state !== 'ready'
  )
  const outputReason = resolveImageEditorReadinessReasonV3(host.outputReadiness, t)
  const replaceTitle = host.outputReadiness.state === 'ready'
    ? t('imageEditor.v3.viewer.replaceTitle')
    : outputReason
      ? t('imageEditor.v3.viewer.replaceUnavailableWithReason', { reason: outputReason })
      : t('imageEditor.v3.viewer.replaceUnavailable')
  const replaceLabel = materialization?.cancelling
    ? t('imageEditor.v3.viewer.cancelling')
    : materialization
      ? materialization.total > 0
        ? t('imageEditor.v3.viewer.cancelProgress', {
            completed: materialization.completed,
            total: materialization.total,
          })
        : t('imageEditor.v3.viewer.cancel')
      : t('imageEditor.v3.viewer.replace')

  return (
    <ImageEditorV3
      sourceImageUrl={host.bootstrap.sourceUrl}
      document={host.bootstrap.document}
      historySnapshot={host.bootstrap.history}
      resourceDescriptors={host.bootstrap.resourceDescriptors}
      profileId="quick"
      onDocumentChange={host.handleDocumentChange}
      onPersistenceChange={host.handlePersistenceChange}
      onReloadEditor={host.retryBootstrap}
      toolbarActions={(
        <>
          <UiButton
            variant="ghost"
            size="sm"
            disabled={replaceDisabled || Boolean(materialization?.cancelling)}
            title={replaceTitle}
            onClick={() => {
              if (replacing) host.cancelMaterialization()
              else void host.materialize()
            }}
          >
            {replaceLabel}
          </UiButton>
          <UiButton
            variant="primary"
            size="sm"
            disabled={host.busy || persistenceBusy}
            onClick={() => void host.finish()}
          >
            {replacing
              ? t('imageEditor.v3.viewer.replacing')
              : host.busy || persistenceBusy
                ? t('imageEditor.v3.viewer.preserving')
                : t('imageEditor.v3.viewer.finish')}
          </UiButton>
        </>
      )}
      className="h-full"
    />
  )
}
