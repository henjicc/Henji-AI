import React from 'react'
import SettingsDialog from './SettingsDialog'
import SettingsProgressDialog from './SettingsProgressDialog'
import type { UseDataPathResult } from '../hooks/useDataPath'
import { useI18n } from '@/hooks/useI18n'

/** 作品目录相关弹窗：设置页与首次引导共用同一套（确认更换、移动进度、失败提示）。 */
const DataPathDialogs: React.FC<{ dataPath: UseDataPathResult }> = ({ dataPath }) => {
  const { t } = useI18n('settings')
  const { alert, confirm, progress } = dataPath
  const progressLabel = progress.file || (progress.phase ? t(`dialogs.workRootMove.phases.${progress.phase}`) : t('dialogs.workRootMove.phases.saving'))

  return (
    <>
      <SettingsDialog
        open={alert.open}
        title={t('dialogs.workRootAlert.title')}
        description={alert.message.key ? t(alert.message.key, alert.message.params) : ''}
        actions={[{ label: t('dialogs.alert.confirm'), onClick: dataPath.closeAlert, variant: 'primary' }]}
        onClose={dataPath.closeAlert}
      />

      <SettingsDialog
        open={confirm.open}
        title={t(confirm.mode === 'reset' ? 'dialogs.workRootConfirm.resetTitle' : 'dialogs.workRootConfirm.title')}
        description={t('dialogs.workRootConfirm.message')}
        detailPath={confirm.targetPath}
        actions={[
          { label: t('actions.cancel'), onClick: dataPath.closeConfirm, variant: 'secondary' },
          { label: t('actions.moveAndRestart'), onClick: () => void dataPath.confirmMove(), variant: 'primary' },
        ]}
        onClose={dataPath.closeConfirm}
      />

      <SettingsProgressDialog
        open={dataPath.showProgress}
        title={t('dialogs.workRootMove.title')}
        hint={t('dialogs.workRootMove.hint')}
        progress={{ ...progress, file: progressLabel }}
        onCancel={dataPath.canCancel ? () => void dataPath.cancelMove() : undefined}
        cancelLabel={t('actions.cancel')}
      />
    </>
  )
}

export default DataPathDialogs
