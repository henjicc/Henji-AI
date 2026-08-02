import React from 'react'
import { UI_FIELD_CONTROL_HEIGHT_SM_CLASS, UiButton, UiFormRow, UiInput } from '@/components/ui'
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
      {/* 常驻说明：改了会自动迁移全部数据，属于「不看就可能误操作」那一档 */}
      <UiFormRow label={t('sections.dataPath.pathLabel')} hint={t('sections.dataPath.pathHint')}>
        <div className="flex items-stretch gap-2">
          {/* 这里是明文本地绝对路径（不像密钥框那样自带掩码），
              助手观察截图时必须遮住，否则路径会原样进模型。 */}
          <UiInput
            data-observation-sensitive
            value={currentPath}
            readOnly
            className={`${UI_FIELD_CONTROL_HEIGHT_SM_CLASS} flex-1 font-mono`}
          />
          <UiButton
            onClick={selectDirectory}
            disabled={isMigrating}
            variant="primary"
            size="sm"
            className="shrink-0 whitespace-nowrap px-4"
          >
            {t('actions.select')}
          </UiButton>
          <UiButton
            onClick={openResetConfirm}
            disabled={isMigrating}
            variant="muted"
            size="sm"
            className="shrink-0 whitespace-nowrap px-4"
          >
            {t('actions.resetDefault')}
          </UiButton>
        </div>
      </UiFormRow>

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
