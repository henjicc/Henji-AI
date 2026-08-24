import { memo } from 'react'
import { NodeToolbar as ReactFlowNodeToolbar } from '@xyflow/react'
import { Download } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { UiChipButton, UiPanel } from '@/components/ui'
import type { CanvasNode } from '@/features/canvas/domain/canvasNodes'
import { isAssetGroupNode } from '@/features/canvas/domain/canvasNodes'
import { ICON_NODE_ASSET_GROUP } from '@/core/theme/icons'
import { resolveAssetGroupMemberKind } from '@/features/canvas/application/assetGroupGraph'
import { useSettingsStore } from '@/stores/settingsStore'
import { useNodeDownload } from '@/features/canvas/hooks/useNodeDownload'
import { NodeDownloadMenu } from './NodeDownloadMenu'
import { BatchConnectionHandle } from './BatchConnectionHandle'
import {
  NODE_TOOLBAR_ALIGN,
  NODE_TOOLBAR_BUTTON_RADIUS_CLASS,
  NODE_TOOLBAR_CLASS,
  NODE_TOOLBAR_NEUTRAL_BUTTON_CLASS,
  NODE_TOOLBAR_OFFSET,
  NODE_TOOLBAR_POSITION,
} from './nodeToolbarConfig'

interface MultiNodeActionToolbarProps {
  nodes: CanvasNode[]
  onBatchConnect: (sourceNodeIds: string[], targetNodeId: string) => void
  onCreateAssetGroup: (memberIds: string[]) => void
  onAddToAssetGroup: (groupId: string, memberIds: string[]) => void
}

export const MultiNodeActionToolbar = memo(({
  nodes,
  onBatchConnect,
  onCreateAssetGroup,
  onAddToAssetGroup,
}: MultiNodeActionToolbarProps) => {
  const { t } = useTranslation()
  const downloadPresetPaths = useSettingsStore((state) => state.downloadPresetPaths)
  const {
    canDownload,
    downloadCount,
    downloadMenu,
    isDownloadMenuVisible,
    downloadMenuRef,
    handleDownloadClick,
    handleDownloadSaveAs,
    handleDownloadToPreset,
  } = useNodeDownload(nodes, downloadPresetPaths)
  const selectedGroup = nodes.find(isAssetGroupNode)
  const mediaNodes = nodes.filter((node) => !isAssetGroupNode(node) && Boolean(resolveAssetGroupMemberKind(node)))
  const canCreateAssetGroup = !selectedGroup && mediaNodes.length >= 2
  const canAddToAssetGroup = Boolean(selectedGroup && mediaNodes.length > 0)

  return (
    <>
      {(canDownload || canCreateAssetGroup || canAddToAssetGroup) && (
        <ReactFlowNodeToolbar
          nodeId={nodes.map((node) => node.id)}
          isVisible
          position={NODE_TOOLBAR_POSITION}
          align={NODE_TOOLBAR_ALIGN}
          offset={NODE_TOOLBAR_OFFSET}
          className={NODE_TOOLBAR_CLASS}
        >
          <UiPanel variant="glass" className="flex items-center gap-1 p-1">
            {canCreateAssetGroup && (
              <UiChipButton
                className={`h-8 ${NODE_TOOLBAR_BUTTON_RADIUS_CLASS} px-2.5 text-xs ${NODE_TOOLBAR_NEUTRAL_BUTTON_CLASS}`}
                onClick={() => onCreateAssetGroup(mediaNodes.map((node) => node.id))}
              >
                <ICON_NODE_ASSET_GROUP className="h-3.5 w-3.5" />
                {t('nodeToolbar.createAssetGroup')}
              </UiChipButton>
            )}
            {canAddToAssetGroup && selectedGroup && (
              <UiChipButton
                className={`h-8 ${NODE_TOOLBAR_BUTTON_RADIUS_CLASS} px-2.5 text-xs ${NODE_TOOLBAR_NEUTRAL_BUTTON_CLASS}`}
                onClick={() => onAddToAssetGroup(selectedGroup.id, mediaNodes.map((node) => node.id))}
              >
                <ICON_NODE_ASSET_GROUP className="h-3.5 w-3.5" />
                {t('nodeToolbar.addToAssetGroup')}
              </UiChipButton>
            )}
            {canDownload && (
            <UiChipButton
              className={`h-8 ${NODE_TOOLBAR_BUTTON_RADIUS_CLASS} px-2.5 text-xs ${NODE_TOOLBAR_NEUTRAL_BUTTON_CLASS}`}
              onClick={handleDownloadClick}
            >
              <Download className="h-3.5 w-3.5" />
              {t('nodeToolbar.batchDownload', { count: downloadCount })}
            </UiChipButton>
            )}
          </UiPanel>

          <NodeDownloadMenu
            menu={downloadMenu}
            isVisible={isDownloadMenuVisible}
            menuRef={downloadMenuRef}
            downloadPresetPaths={downloadPresetPaths}
            saveAsLabel={t('nodeToolbar.chooseDownloadFolder')}
            noPresetHintLabel={t('nodeToolbar.noDownloadPresetPathsHint')}
            onSaveAs={() => void handleDownloadSaveAs()}
            onSaveToPreset={(path) => void handleDownloadToPreset(path)}
          />
        </ReactFlowNodeToolbar>
      )}
      <BatchConnectionHandle nodes={nodes} onConnect={onBatchConnect} />
    </>
  )
})

MultiNodeActionToolbar.displayName = 'MultiNodeActionToolbar'
