import React from 'react'
import { FolderOpen, Plus, Trash2 } from 'lucide-react'
import { openDialog } from '@/platform/desktopApi'
import {
  UI_FIELD_CONTROL_HEIGHT_SM_CLASS,
  UI_TEXT_META_CLASS,
  UiButton,
  UiFormRow,
  UiIconButton,
  UiInput,
  UiSwitch,
} from '@/components/ui'
import { useI18n } from '@/hooks/useI18n'
import { DOWNLOAD_PRESET_PATH_LIMIT, useSettingsStore } from '@/stores/settingsStore'

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
  const presetPaths = useSettingsStore((state) => state.downloadPresetPaths)
  const setPresetPaths = useSettingsStore((state) => state.setDownloadPresetPaths)

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

  /*
   * 预设路径此前只有读取方（画布节点的下载菜单按它渲染"保存到…"列表），却没有任何写入入口——
   * 菜单为空时提示"请在设置 - 通用中添加"，而这里根本没有这一项，等于让用户去做一件做不到的事。
   */
  const handleAddPresetPath = async () => {
    if (presetPaths.length >= DOWNLOAD_PRESET_PATH_LIMIT) return
    const selected = await openDialog({ directory: true, multiple: false })
    if (!selected || Array.isArray(selected)) return
    // 同一个目录加两次在下载菜单里会出现两行一模一样的项，点哪个都一样。
    if (presetPaths.includes(selected)) return
    setPresetPaths([...presetPaths, selected])
  }

  const handleRemovePresetPath = (path: string) => {
    setPresetPaths(presetPaths.filter((item) => item !== path))
  }

  return (
    <>
      <UiFormRow label={t('sections.download.enableLabel')} info={t('sections.download.enableHint')} inline>
        <UiSwitch checked={enableQuickDownload} onCheckedChange={onToggleQuickDownload} />
      </UiFormRow>

      <UiFormRow
        label={t('sections.download.buttonOnlyLabel')}
        info={t('sections.download.buttonOnlyHint')}
        inline
        className={enableQuickDownload ? '' : 'opacity-50'}
      >
        <UiSwitch
          checked={quickDownloadButtonOnly}
          onCheckedChange={onToggleButtonOnly}
          disabled={!enableQuickDownload}
        />
      </UiFormRow>

      <UiFormRow
        label={t('sections.download.pathLabel')}
        info={t('sections.download.pathHint')}
        className={enableQuickDownload ? '' : 'opacity-50'}
      >
        <div className="flex items-stretch gap-2">
          {/* 明文本地路径，观察截图时需要遮罩；密钥类输入自带 password 掩码，无需标注。 */}
          <UiInput
            data-observation-sensitive
            value={quickDownloadPath}
            onChange={(e) => onChangePath(e.target.value)}
            placeholder={t('sections.download.pathPlaceholder')}
            disabled={!enableQuickDownload}
            className={`${UI_FIELD_CONTROL_HEIGHT_SM_CLASS} flex-1`}
          />
          <UiButton
            onClick={handleSelectPath}
            disabled={!enableQuickDownload}
            variant="primary"
            size="field-sm"
            className="shrink-0 whitespace-nowrap px-4"
          >
            {t('actions.select')}
          </UiButton>
        </div>
      </UiFormRow>

      {/* 预设路径与快速下载是两件事：前者供画布节点的"保存到…"菜单，关掉快速下载也仍然有效，
          所以这一行不跟随 enableQuickDownload 变灰。 */}
      <UiFormRow
        label={t('sections.download.presetPathsLabel')}
        info={t('sections.download.presetPathsHint')}
      >
        <div className="space-y-1.5">
          {presetPaths.map((path) => (
            <div key={path} className="flex items-center gap-2">
              <FolderOpen className="h-3.5 w-3.5 shrink-0 text-text-muted" />
              {/* 明文本地路径，观察截图时需要遮罩 */}
              <span data-observation-sensitive className="min-w-0 flex-1 truncate text-sm" title={path}>
                {path}
              </span>
              <UiIconButton
                type="button"
                showBorder={false}
                appearance="hover-only"
                aria-label={t('sections.download.presetPathsRemove', { path })}
                onClick={() => handleRemovePresetPath(path)}
              >
                <Trash2 size={14} />
              </UiIconButton>
            </div>
          ))}
          <div className="flex items-center gap-2">
            <UiButton
              onClick={handleAddPresetPath}
              disabled={presetPaths.length >= DOWNLOAD_PRESET_PATH_LIMIT}
              variant="ghost"
              size="sm"
              className="shrink-0 gap-1.5 whitespace-nowrap"
            >
              <Plus className="h-3.5 w-3.5" />
              {t('sections.download.presetPathsAdd')}
            </UiButton>
            <span className={UI_TEXT_META_CLASS}>
              {t('sections.download.presetPathsCount', {
                count: presetPaths.length,
                limit: DOWNLOAD_PRESET_PATH_LIMIT,
              })}
            </span>
          </div>
        </div>
      </UiFormRow>
    </>
  )
}

export default DownloadSection
