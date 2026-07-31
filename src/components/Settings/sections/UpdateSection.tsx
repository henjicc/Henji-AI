import React, { useState } from 'react'
import { UI_TEXT_META_CLASS, UiButton, UiChipButton, UiFormRow, UiSwitch } from '@/components/ui'
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
      <UiFormRow label={t('sections.updates.enableLabel')} info={t('sections.updates.enableHint')} inline>
        <UiSwitch checked={config.enabled} onCheckedChange={updateEnabled} />
      </UiFormRow>

      <UiFormRow
        label={t('sections.updates.frequencyLabel')}
        info={t('sections.updates.frequencyHint')}
        className={config.enabled ? '' : 'opacity-50'}
      >
        <div className="grid grid-cols-4 gap-2">
          {frequencies.map((freq) => (
            <UiChipButton
              key={freq}
              onClick={() => updateFrequency(freq)}
              disabled={!config.enabled}
              active={config.frequency === freq}
              className="justify-center px-4 text-sm font-medium"
            >
              {t(`sections.updates.frequency.${freq}`)}
            </UiChipButton>
          ))}
        </div>
      </UiFormRow>

      <UiFormRow label={t('sections.updates.currentVersionLabel')} inline>
        <span className={`font-mono ${UI_TEXT_META_CLASS}`}>{currentVersion}</span>
        <UiButton
          onClick={handleCheck}
          disabled={isChecking}
          variant="primary"
          size="sm"
          className="px-4"
        >
          {isChecking ? t('actions.checking') : t('actions.checkUpdate')}
        </UiButton>
      </UiFormRow>

      <UiFormRow
        label={t('sections.updates.clearIgnoredLabel')}
        info={t('sections.updates.clearIgnoredHint')}
        inline
      >
        <UiButton onClick={clearIgnored} variant="muted" size="sm" className="px-4">
          {t('sections.updates.clearIgnoredAction')}
        </UiButton>
      </UiFormRow>

      <SettingsDialog
        open={showResult}
        title={t('navSections.general-maintenance')}
        description={resultMessage}
        actions={resultActions()}
        onClose={closeResult}
      />
    </>
  )
}

export default UpdateSection
