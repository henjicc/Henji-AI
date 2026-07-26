import React, { useState } from 'react'
import Toggle from '@/components/ui/Toggle'
import { UiButton, UiChipButton } from '@/components/ui'
import SectionCard from '../components/SectionCard'
import SettingsDialog from '../components/SettingsDialog'
import { useUpdateConfig } from '../hooks/useUpdateConfig'
import { useExternalLink } from '../hooks/useExternalLink'
import { useI18n } from '@/hooks/useI18n'
import type { UpdateCheckResult } from '@/services/updateChecker'

const UpdateSection: React.FC = () => {
  const { t } = useI18n('settings')
  const { openExternal } = useExternalLink()
  const {
    config,
    currentVersion,
    isChecking,
    updateEnabled,
    updateFrequency,
    clearIgnored,
    checkNow
  } = useUpdateConfig()

  const [lastResult, setLastResult] = useState<UpdateCheckResult | null>(null)
  const [lastError, setLastError] = useState<string | null>(null)
  const [showResult, setShowResult] = useState(false)

  const onText = t('actions.toggleOn')
  const offText = t('actions.toggleOff')
  const frequencies: Array<typeof config.frequency> = ['startup', 'daily', 'weekly', 'never']

  const handleCheck = async () => {
    try {
      const result = await checkNow()
      setLastResult(result)
      setLastError(null)
    } catch (error) {
      const message = error instanceof Error ? error.message : t('alerts.unknownError')
      setLastError(message)
      setLastResult(null)
    } finally {
      setShowResult(true)
    }
  }

  const closeResult = () => {
    setShowResult(false)
  }

  const resultMessage = lastError
    ? t('sections.updates.checkFailed', { message: lastError })
    : lastResult?.hasUpdate
      ? t('sections.updates.hasUpdate', { version: lastResult.latestVersion })
      : t('sections.updates.upToDate', { version: lastResult?.currentVersion || currentVersion })

  const resultActions = () => {
    if (lastResult?.hasUpdate && lastResult.releaseInfo?.htmlUrl) {
      return [
        {
          label: t('actions.openRelease'),
          onClick: () => {
            openExternal(lastResult.releaseInfo!.htmlUrl)
            closeResult()
          },
          variant: 'primary' as const
        }
      ]
    }
    return [
      {
        label: t('dialogs.alert.confirm'),
        onClick: closeResult,
        variant: 'primary' as const
      }
    ]
  }

  return (
    <>
      <SectionCard title={t('sections.updates.title')}>
        <div className="space-y-5">
          <div>
            <Toggle
              label={t('sections.updates.enableLabel')}
              checked={config.enabled}
              onChange={updateEnabled}
              className="w-full"
              onText={onText}
              offText={offText}
            />
            <p className="mt-2 text-xs text-text-faint">{t('sections.updates.enableHint')}</p>
          </div>

          <div className={`transition-colors duration-300 ${!config.enabled ? 'pointer-events-none' : ''}`}>
            <label className="block text-sm font-medium mb-2 text-text-soft">
              {t('sections.updates.frequencyLabel')}
            </label>
            <div className="grid grid-cols-2 gap-2">
              {frequencies.map((freq) => (
                <UiChipButton
                  key={freq}
                  onClick={() => updateFrequency(freq)}
                  disabled={!config.enabled}
                  active={config.frequency === freq}
                  className={`justify-center px-4 text-sm font-medium ${config.frequency === freq ? '' : 'text-text-muted hover:text-text-dark'}`}
                >
                  {t(`sections.updates.frequency.${freq}`)}
                </UiChipButton>
              ))}
            </div>
            <p className="mt-2 text-xs text-text-faint">{t('sections.updates.frequencyHint')}</p>
          </div>

          <div className="space-y-3 border-t border-border-dark pt-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-text-soft font-medium">{t('sections.updates.currentVersionLabel')}</p>
                <p className="text-xs text-text-faint mt-1 font-mono">{currentVersion}</p>
              </div>
              <UiButton
                onClick={handleCheck}
                disabled={isChecking}
                variant="primary"
                size="sm"
                className="gap-2 px-4"
              >
                {isChecking ? t('actions.checking') : t('actions.checkUpdate')}
              </UiButton>
            </div>
            <UiButton
              onClick={clearIgnored}
              variant="muted"
              size="sm"
              className="w-full px-4 text-text-soft"
            >
              {t('actions.clearIgnored')}
            </UiButton>
            <p className="text-xs text-text-faint">{t('sections.updates.clearIgnoredHint')}</p>
          </div>
        </div>
      </SectionCard>

      <SettingsDialog
        open={showResult}
        title={t('sections.updates.title')}
        description={resultMessage}
        actions={resultActions()}
        onClose={closeResult}
      />
    </>
  )
}

export default UpdateSection
