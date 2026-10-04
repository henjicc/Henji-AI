import React, { useState } from 'react'
import { UI_SEGMENTED_TRACK_CLASS, UI_TEXT_META_CLASS, UiButton, UiFormRow, UiOptionButton, UiSwitch } from '@/components/ui'
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
        aria-disabled={!config.enabled || undefined}
      >
        {/* 检查频率是单选：分段选择（选中为淡强调底，重要记录 012） */}
        <div className={UI_SEGMENTED_TRACK_CLASS}>
          {frequencies.map((freq) => (
            <UiOptionButton
              key={freq}
              variant="segment"
              onClick={() => updateFrequency(freq)}
              disabled={!config.enabled}
              active={config.frequency === freq}
              aria-pressed={config.frequency === freq}
            >
              {t(`sections.updates.frequency.${freq}`)}
            </UiOptionButton>
          ))}
        </div>
      </UiFormRow>

      <UiFormRow label={t('sections.updates.currentVersionLabel')} inline>
        <span className={`font-mono ${UI_TEXT_META_CLASS}`}>{currentVersion}</span>
        <UiButton
          onClick={handleCheck}
          disabled={isChecking}
          variant="secondary"
        >
          {isChecking ? t('actions.checking') : t('actions.checkUpdate')}
        </UiButton>
      </UiFormRow>

      <UiFormRow
        label={t('sections.updates.clearIgnoredLabel')}
        info={t('sections.updates.clearIgnoredHint')}
        inline
      >
        <UiButton onClick={clearIgnored} variant="secondary">
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
