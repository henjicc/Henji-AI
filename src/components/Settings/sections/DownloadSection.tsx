import React from 'react'
import { open as openDialog } from '@tauri-apps/plugin-dialog'
import Toggle from '@/components/ui/Toggle'
import SectionCard from '../components/SectionCard'
import { useI18n } from '@/hooks/useI18n'

interface DownloadSectionProps {
  enableQuickDownload: boolean
  quickDownloadButtonOnly: boolean
  quickDownloadPath: string
  onToggleQuickDownload: (value: boolean) => void
  onToggleButtonOnly: (value: boolean) => void
  onChangePath: (value: string) => void
}

const DownloadSection: React.FC<DownloadSectionProps> = ({
  enableQuickDownload,
  quickDownloadButtonOnly,
  quickDownloadPath,
  onToggleQuickDownload,
  onToggleButtonOnly,
  onChangePath
}) => {
  const { t } = useI18n('settings')
  const onText = t('actions.toggleOn')
  const offText = t('actions.toggleOff')

  const handleSelectPath = async () => {
    const selected = await openDialog({
      directory: true,
      multiple: false
    })
    if (!selected || Array.isArray(selected)) {
      return
    }
    onChangePath(selected)
  }

  return (
    <SectionCard title={t('sections.download.title')}>
      <div className="space-y-5">
        <div>
          <Toggle
            label={t('sections.download.enableLabel')}
            checked={enableQuickDownload}
            onChange={onToggleQuickDownload}
            className="w-full"
            onText={onText}
            offText={offText}
          />
          <p className="mt-2 text-xs text-zinc-500">{t('sections.download.enableHint')}</p>
        </div>

        <div className={`transition-opacity duration-300 ${!enableQuickDownload ? 'opacity-50 pointer-events-none' : ''}`}>
          <Toggle
            label={t('sections.download.buttonOnlyLabel')}
            checked={quickDownloadButtonOnly}
            onChange={onToggleButtonOnly}
            className="w-full"
            disabled={!enableQuickDownload}
            onText={onText}
            offText={offText}
          />
          <p className="mt-2 text-xs text-zinc-500">{t('sections.download.buttonOnlyHint')}</p>
        </div>

        <div className={`transition-opacity duration-300 ${!enableQuickDownload ? 'opacity-50 pointer-events-none' : ''}`}>
          <label className="block text-sm font-medium mb-2 text-zinc-300">
            {t('sections.download.pathLabel')}
          </label>
          <div className="flex gap-2">
            <input
              type="text"
              value={quickDownloadPath}
              onChange={(e) => onChangePath(e.target.value)}
              placeholder={t('sections.download.pathPlaceholder')}
              disabled={!enableQuickDownload}
              className="flex-1 bg-zinc-900/50 border border-zinc-700/50 rounded-lg px-3 py-2.5 outline-none focus:ring-2 focus:ring-[#007eff]/60 focus:border-[#007eff] transition-all duration-300 text-white placeholder-zinc-500 text-sm disabled:opacity-50"
            />
            <button
              onClick={handleSelectPath}
              disabled={!enableQuickDownload}
              className="px-4 py-2.5 bg-[#007eff] hover:bg-[#006add] text-white rounded-lg transition-all duration-300 font-medium text-sm disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
            >
              {t('actions.select')}
            </button>
          </div>
          <p className="mt-2 text-xs text-zinc-500">{t('sections.download.pathHint')}</p>
        </div>
      </div>
    </SectionCard>
  )
}

export default DownloadSection
