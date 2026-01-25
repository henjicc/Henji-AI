import React, { useState } from 'react'
import Toggle from '@/components/ui/Toggle'
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
            <p className="mt-2 text-xs text-zinc-500">{t('sections.updates.enableHint')}</p>
          </div>

          <div className={`transition-opacity duration-300 ${!config.enabled ? 'opacity-50 pointer-events-none' : ''}`}>
            <label className="block text-sm font-medium mb-2 text-zinc-300">
              {t('sections.updates.frequencyLabel')}
            </label>
            <div className="grid grid-cols-2 gap-2">
              {frequencies.map((freq) => (
                <button
                  key={freq}
                  onClick={() => updateFrequency(freq)}
                  disabled={!config.enabled}
                  className={`px-4 py-2.5 rounded-lg text-sm font-medium transition-all duration-300 ${config.frequency === freq
                    ? 'bg-[#007eff] text-white'
                    : 'bg-zinc-700/30 text-zinc-400 hover:bg-zinc-700/50 hover:text-zinc-200'
                    } disabled:opacity-50 disabled:cursor-not-allowed`}
                >
                  {t(`sections.updates.frequency.${freq}`)}
                </button>
              ))}
            </div>
            <p className="mt-2 text-xs text-zinc-500">{t('sections.updates.frequencyHint')}</p>
          </div>

          <div className="pt-3 border-t border-zinc-700/30 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-zinc-300 font-medium">{t('sections.updates.currentVersionLabel')}</p>
                <p className="text-xs text-zinc-500 mt-1 font-mono">{currentVersion}</p>
              </div>
              <button
                onClick={handleCheck}
                disabled={isChecking}
                className="px-4 py-2 bg-[#007eff] hover:bg-[#006add] text-white rounded-lg transition-all duration-300 text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
              >
                {isChecking ? t('actions.checking') : t('actions.checkUpdate')}
              </button>
            </div>
            <button
              onClick={clearIgnored}
              className="w-full px-4 py-2 bg-zinc-700/30 hover:bg-zinc-700/50 text-zinc-300 rounded-lg transition-all duration-300 text-sm"
            >
              {t('actions.clearIgnored')}
            </button>
            <p className="text-xs text-zinc-500">{t('sections.updates.clearIgnoredHint')}</p>
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
