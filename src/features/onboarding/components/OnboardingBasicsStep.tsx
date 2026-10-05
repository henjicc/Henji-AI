import { Database } from 'lucide-react'

import {
  UI_COLOR_ACCENT_TEXT_CLASS,
  UI_TEXT_BODY_CLASS,
  UI_TEXT_META_CLASS,
  UI_TEXT_SECTION_CLASS,
  UiButton,
  UiInput,
  UiPanel,
} from '@/components/ui'
import DataPathDialogs from '@/components/Settings/components/DataPathDialogs'
import type { UseDataPathResult } from '@/components/Settings/hooks/useDataPath'
import { useI18n } from '@/hooks/useI18n'

export function OnboardingBasicsStep({ dataPath }: { dataPath: UseDataPathResult }): JSX.Element {
  const { t } = useI18n('onboarding')
  return (
    <div className="min-h-96">
      <h3 className={UI_TEXT_SECTION_CLASS}>{t('basics.headline')}</h3>
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
                className={`min-w-0 flex-1 font-mono`}
              />
              <UiButton
                variant="secondary"
                className="shrink-0"
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

/** 与设置页共用同一套作品目录弹窗。 */
export function OnboardingDataPathDialogs({ dataPath }: { dataPath: UseDataPathResult }): JSX.Element {
  return <DataPathDialogs dataPath={dataPath} />
}
