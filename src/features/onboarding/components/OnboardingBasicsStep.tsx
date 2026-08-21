import { Database } from 'lucide-react'

import {
  UI_COLOR_ACCENT_TEXT_CLASS,
  UI_FIELD_CONTROL_HEIGHT_SM_CLASS,
  UI_TEXT_BODY_CLASS,
  UI_TEXT_META_CLASS,
  UI_TEXT_TITLE_CLASS,
  UiButton,
  UiInput,
  UiPanel,
} from '@/components/ui'
import SettingsDialog from '@/components/Settings/components/SettingsDialog'
import SettingsProgressDialog from '@/components/Settings/components/SettingsProgressDialog'
import type { UseDataPathResult } from '@/components/Settings/hooks/useDataPath'
import { useI18n } from '@/hooks/useI18n'

export function OnboardingBasicsStep({ dataPath }: { dataPath: UseDataPathResult }): JSX.Element {
  const { t } = useI18n('onboarding')
  return (
    <div className="min-h-[25rem]">
      <h3 className={UI_TEXT_TITLE_CLASS}>{t('basics.headline')}</h3>
      <p className={`mt-2 leading-6 ${UI_TEXT_BODY_CLASS}`}>{t('basics.description')}</p>
      <UiPanel variant="inset" className="mt-7 p-4">
        <div className="flex items-start gap-3">
          <Database className={`mt-0.5 h-5 w-5 shrink-0 ${UI_COLOR_ACCENT_TEXT_CLASS}`} />
          <div className="min-w-0 flex-1">
            <p className={`leading-5 ${UI_TEXT_META_CLASS}`}>{t('basics.dataDescription')}</p>
            <div className="mt-3 flex items-stretch gap-2">
              <UiInput
                data-observation-sensitive
                value={dataPath.currentPath || dataPath.defaultPath}
                readOnly
                aria-label={t('basics.currentPath')}
                className={`${UI_FIELD_CONTROL_HEIGHT_SM_CLASS} min-w-0 flex-1 font-mono`}
              />
              <UiButton
                variant="muted"
                size="field-sm"
                className="shrink-0 whitespace-nowrap px-4"
                disabled={dataPath.isMigrating}
                onClick={() => void dataPath.selectDirectory()}
              >
                {t('actions.chooseDirectory')}
              </UiButton>
            </div>
            <p data-observation-sensitive className={`mt-2 break-all leading-5 ${UI_TEXT_META_CLASS}`}>
              {t('basics.defaultPath', { path: dataPath.defaultPath })}
            </p>
          </div>
        </div>
      </UiPanel>
    </div>
  )
}

export function OnboardingDataPathDialogs({ dataPath }: { dataPath: UseDataPathResult }): JSX.Element {
  const { t } = useI18n('settings')
  const alertTitle = t(`dialogs.alert.title.${dataPath.alert.type}`)
  const normalizedParams = dataPath.alert.message.params?.message === 'UnknownError'
    ? { ...dataPath.alert.message.params, message: t('alerts.unknownError') }
    : dataPath.alert.message.params
  const alertMessage = dataPath.alert.message.key
    ? t(dataPath.alert.message.key, normalizedParams)
    : ''

  return (
    <>
      <SettingsDialog
        open={dataPath.alert.open}
        title={alertTitle}
        description={alertMessage}
        actions={[{
          label: t('dialogs.alert.confirm'),
          onClick: dataPath.closeAlert,
          variant: 'primary',
        }]}
        onClose={dataPath.closeAlert}
      />
      <SettingsDialog
        open={dataPath.conflict.open}
        title={t('dialogs.conflict.title')}
        description={t('dialogs.conflict.message', { path: dataPath.conflict.targetPath })}
        actions={[
          { label: t('actions.merge'), onClick: () => void dataPath.resolveConflict('merge'), variant: 'primary' },
          { label: t('actions.overwrite'), onClick: () => void dataPath.resolveConflict('overwrite'), variant: 'danger' },
          { label: t('actions.cancel'), onClick: () => void dataPath.resolveConflict('cancel'), variant: 'secondary' },
        ]}
        onClose={dataPath.closeConflict}
      />
      <SettingsProgressDialog
        open={dataPath.showProgress}
        title={t('dialogs.migration.title')}
        hint={t('dialogs.migration.hint')}
        progress={dataPath.progress}
      />
    </>
  )
}
