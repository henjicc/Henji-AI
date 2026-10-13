import { UI_ICON_SIZE } from '@/core/theme/icons'
import { ClipboardPaste, FilePlus2, FolderOpen } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { PanelTrigger, UiButton, UiOptionButton } from '@/components/ui'

interface ImageMarkSourceMenuProps {
  disabled?: boolean
  onOpenFile: () => void
  onPasteFromClipboard: () => void
  onCreateBlank: () => void
}

/** 独立 V3 图片编辑器唯一的图片来源菜单。 */
export function ImageMarkSourceMenu({
  disabled = false,
  onOpenFile,
  onPasteFromClipboard,
  onCreateBlank,
}: ImageMarkSourceMenuProps): JSX.Element {
  const { t } = useTranslation('ui')

  return (
    <PanelTrigger
      panelSize="menu"
      panelPadding="menu"
      closeOnPanelClick
      renderPanel={() => (
        <div className="flex flex-col gap-0.5">
          <UiOptionButton
            type="button"
            variant="menu"
            size="md" className="gap-2"
            onClick={onOpenFile}
          >
            <FolderOpen size={UI_ICON_SIZE.sm} />
            {t('imageEditor.v3.host.sourceMenu.openFile')}
          </UiOptionButton>
          <UiOptionButton
            type="button"
            variant="menu"
            size="md" className="gap-2"
            onClick={onPasteFromClipboard}
          >
            <ClipboardPaste size={UI_ICON_SIZE.sm} />
            {t('imageEditor.v3.host.sourceMenu.paste')}
          </UiOptionButton>
          <UiOptionButton
            type="button"
            variant="menu"
            size="md" className="gap-2"
            onClick={onCreateBlank}
          >
            <FilePlus2 size={UI_ICON_SIZE.sm} />
            {t('imageEditor.v3.host.sourceMenu.createBlank')}
          </UiOptionButton>
        </div>
      )}
    >
      {({ togglePanel }) => (
        <UiButton
          variant="secondary"
          disabled={disabled}
          onClick={togglePanel}
          tooltip={t('imageEditor.v3.host.sourceMenu.title')}
        >
          <FolderOpen  className="mr-1.5" />
          {t('imageEditor.v3.host.sourceMenu.trigger')}
        </UiButton>
      )}
    </PanelTrigger>
  )
}
