import React from 'react'
import { UiRegion } from '@/components/ui'
import SettingsSection from '../components/SettingsSection'
import { SETTINGS_CONTENT_CLASS, SETTINGS_CONTENT_MAX_WIDTH_CLASS } from '../settingsLayout'
import { useSettings } from '../hooks/useSettings'
import DataPathSection from '../sections/DataPathSection'
import LargeUploadSection from '../sections/LargeUploadSection'
import UploadSection from '../sections/UploadSection'
import DownloadSection from '../sections/DownloadSection'

/**
 * 文件与下载：文件存在哪、怎么传给模型、怎么下载回来。
 * 上传以前分在「通用 › 数据与下载」（大文件）和「模型 › 上传策略」（托管服务）两处。
 */
const FilesTab: React.FC = () => {
  const { settings, updateSetting } = useSettings()

  return (
    <UiRegion maxWidthClassName={SETTINGS_CONTENT_MAX_WIDTH_CLASS} className={SETTINGS_CONTENT_CLASS}>
      <SettingsSection id="files-storage">
        <DataPathSection />
      </SettingsSection>

      <SettingsSection id="files-upload">
        <LargeUploadSection />
        <UploadSection />
      </SettingsSection>

      <SettingsSection id="files-download">
        <DownloadSection
          enableQuickDownload={settings.enableQuickDownload}
          quickDownloadButtonOnly={settings.quickDownloadButtonOnly}
          quickDownloadPath={settings.quickDownloadPath}
          onToggleQuickDownload={(value) => updateSetting('enableQuickDownload', value)}
          onToggleButtonOnly={(value) => updateSetting('quickDownloadButtonOnly', value)}
          onChangePath={(value) => updateSetting('quickDownloadPath', value)}
        />
      </SettingsSection>
    </UiRegion>
  )
}

export default FilesTab
