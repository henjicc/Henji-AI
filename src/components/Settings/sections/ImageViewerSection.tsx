import { UiFormRow, UiSwitch } from '@/components/ui'
import { useI18n } from '@/hooks/useI18n'
import { useSettingsStore } from '@/stores/settingsStore'

/** 查看图片时显示分辨率、文件大小等信息。生成页、画布和资产库共用同一个查看器，所以放在「通用」。 */
export default function ImageViewerSection(): JSX.Element {
  const { t } = useI18n('settings')
  const enabled = useSettingsStore((state) => state.enableImageViewerInfoPanel)
  const setEnabled = useSettingsStore((state) => state.setEnableImageViewerInfoPanel)
  return (
    <UiFormRow label={t('sections.canvas.imageViewerInfoLabel')} info={t('sections.canvas.imageViewerInfoHint')} inline>
      <UiSwitch checked={enabled} onCheckedChange={setEnabled} />
    </UiFormRow>
  )
}
