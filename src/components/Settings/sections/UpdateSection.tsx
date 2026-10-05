import React, { useState } from 'react'
import { UI_TEXT_META_CLASS, UiButton, UiFormRow } from '@/components/ui'
import SettingsDialog from '../components/SettingsDialog'
import SettingsSegmented from '../components/SettingsSegmented'
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
  const activeFrequency: typeof config.frequency = config.enabled ? config.frequency : 'never'
  const selectFrequency = (freq: typeof config.frequency): void => {
    updateEnabled(freq !== 'never')
    updateFrequency(freq)
  }

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

      {/*
        开关与频率合成一项：原来开关是一个"关"，频率里的「从不」又是一个"关"。
        存储仍是 enabled + frequency 两个维度（助手按这两项读写），这里只是合并呈现。
      */}
      <UiFormRow label={t('sections.updates.autoCheckLabel')} info={t('sections.updates.autoCheckHint')} inline>
        <SettingsSegmented
          value={activeFrequency}
          options={frequencies.map((freq) => ({ value: freq, label: t(`sections.updates.frequency.${freq}`) }))}
          onChange={selectFrequency}
          ariaLabel={t('sections.updates.autoCheckLabel')}
        />
      </UiFormRow>

      {/* 没有忽略过任何版本时这一行没有可做的事，不显示 */}
      {config.ignoredVersions.length > 0 ? (
        <UiFormRow
          label={t('sections.updates.clearIgnoredLabel')}
          info={t('sections.updates.clearIgnoredHint')}
          inline
        >
          <span className={`font-mono ${UI_TEXT_META_CLASS}`}>{config.ignoredVersions.join('、')}</span>
          <UiButton onClick={clearIgnored} variant="secondary">
            {t('sections.updates.clearIgnoredAction')}
          </UiButton>
        </UiFormRow>
      ) : null}

      <SettingsDialog
        open={showResult}
        title={t(lastError
          ? 'sections.updates.resultTitle.failed'
          : lastResult?.hasUpdate
            ? 'sections.updates.resultTitle.hasUpdate'
            : 'sections.updates.resultTitle.upToDate')}
        description={resultMessage}
        actions={resultActions()}
        onClose={closeResult}
      />
    </>
  )
}

export default UpdateSection
