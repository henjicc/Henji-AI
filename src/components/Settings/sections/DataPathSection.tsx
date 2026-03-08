import React from 'react'
import { UiButton, UiInput } from '@/components/ui'
import SectionCard from '../components/SectionCard'
import SettingsDialog from '../components/SettingsDialog'
import SettingsProgressDialog from '../components/SettingsProgressDialog'
import { useDataPath } from '../hooks/useDataPath'
import { useI18n } from '@/hooks/useI18n'

const DataPathSection: React.FC = () => {
  const { t } = useI18n('settings')
  const {
    currentPath,
    isMigrating,
    progress,
    showProgress,
    alert,
    conflict,
    confirmResetOpen,
    selectDirectory,
    openResetConfirm,
    closeResetConfirm,
    resolveConflict,
    resetToDefault,
    closeAlert,
    closeConflict
  } = useDataPath()

  const alertTitle = t(`dialogs.alert.title.${alert.type}`)
  const normalizedParams = alert.message.params?.message === 'UnknownError'
    ? { ...alert.message.params, message: t('alerts.unknownError') }
    : alert.message.params
  const alertMessage = alert.message.key ? t(alert.message.key, normalizedParams) : ''

  return (
    <>
      <SectionCard title={t('sections.dataPath.title')}>
        <label className="block text-sm font-medium mb-2 text-zinc-300">
          {t('sections.dataPath.pathLabel')}
        </label>
        <div className="flex gap-2">
          <UiInput
            value={currentPath}
            readOnly
            className="h-10 flex-1 font-mono"
          />
          <UiButton
            onClick={selectDirectory}
            disabled={isMigrating}
            variant="primary"
            size="sm"
            className="h-10 whitespace-nowrap px-4"
          >
            {t('actions.select')}
          </UiButton>
          <UiButton
            onClick={openResetConfirm}
            disabled={isMigrating}
            variant="muted"
            size="sm"
            className="h-10 whitespace-nowrap px-4"
          >
            {t('actions.resetDefault')}
          </UiButton>
        </div>
        <p className="mt-2 text-xs text-zinc-500">{t('sections.dataPath.pathHint')}</p>
      </SectionCard>

      <SettingsDialog
        open={alert.open}
        title={alertTitle}
        description={alertMessage}
        actions={[
          {
            label: t('dialogs.alert.confirm'),
            onClick: closeAlert,
            variant: 'primary'
          }
        ]}
        onClose={closeAlert}
      />

      <SettingsDialog
        open={confirmResetOpen}
        title={t('dialogs.resetDataPath.title')}
        description={t('dialogs.resetDataPath.message')}
        actions={[
          {
            label: t('actions.cancel'),
            onClick: closeResetConfirm,
            variant: 'secondary'
          },
          {
            label: t('actions.confirm'),
            onClick: resetToDefault,
            variant: 'primary'
          }
        ]}
        onClose={closeResetConfirm}
      />

      <SettingsDialog
        open={conflict.open}
        title={t('dialogs.conflict.title')}
        description={t('dialogs.conflict.message', { path: conflict.targetPath })}
        actions={[
          {
            label: t('actions.merge'),
            onClick: () => resolveConflict('merge'),
            variant: 'primary'
          },
          {
            label: t('actions.overwrite'),
            onClick: () => resolveConflict('overwrite'),
            variant: 'danger'
          },
          {
            label: t('actions.cancel'),
            onClick: () => resolveConflict('cancel'),
            variant: 'secondary'
          }
        ]}
        onClose={closeConflict}
      />

      <SettingsProgressDialog
        open={showProgress}
        title={t('dialogs.migration.title')}
        hint={t('dialogs.migration.hint')}
        progress={progress}
      />
    </>
  )
}

export default DataPathSection
