import { ClipboardPaste, FileArchive, FilePlus2, FolderOpen } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { PanelTrigger, UiButton, UiOptionButton } from '@/components/ui'

interface ImageMarkSourceMenuProps {
  disabled?: boolean
  onOpenFile: () => void
  onOpenPackage?: () => void
  onPasteFromClipboard: () => void
  onCreateBlank: () => void
}

/** 独立图片编辑器唯一的图片来源菜单，V2/V3 宿主共用。 */
export function ImageMarkSourceMenu({
  disabled = false,
  onOpenFile,
  onOpenPackage,
  onPasteFromClipboard,
  onCreateBlank,
}: ImageMarkSourceMenuProps): JSX.Element {
  const { t } = useTranslation('ui')

  return (
    <PanelTrigger
      panelWidth={172}
      panelClassName="p-1"
      closeOnPanelClick
      renderPanel={() => (
        <div className="flex flex-col gap-0.5">
          <UiOptionButton
            type="button"
            variant="menu"
            className="gap-2 text-sm"
            onClick={onOpenFile}
          >
            <FolderOpen size={15} />
            {t('imageEditor.v3.host.sourceMenu.openFile')}
          </UiOptionButton>
          {onOpenPackage ? (
            <UiOptionButton
              type="button"
              variant="menu"
              className="gap-2 text-sm"
              onClick={onOpenPackage}
            >
              <FileArchive size={15} />
              {t('imageEditor.v3.host.sourceMenu.openPackage')}
            </UiOptionButton>
          ) : null}
          <UiOptionButton
            type="button"
            variant="menu"
            className="gap-2 text-sm"
            onClick={onPasteFromClipboard}
          >
            <ClipboardPaste size={15} />
            {t('imageEditor.v3.host.sourceMenu.paste')}
          </UiOptionButton>
          <UiOptionButton
            type="button"
            variant="menu"
            className="gap-2 text-sm"
            onClick={onCreateBlank}
          >
            <FilePlus2 size={15} />
            {t('imageEditor.v3.host.sourceMenu.createBlank')}
          </UiOptionButton>
        </div>
      )}
    >
      {({ togglePanel }) => (
        <UiButton
          variant="ghost"
          size="sm"
          disabled={disabled}
          onClick={togglePanel}
          title={t('imageEditor.v3.host.sourceMenu.title')}
        >
          <FolderOpen size={15} className="mr-1.5" />
          {t('imageEditor.v3.host.sourceMenu.trigger')}
        </UiButton>
      )}
    </PanelTrigger>
  )
}
