import { useNodeToolbarBoundary } from './useNodeToolbarBoundary'
import { memo } from 'react'
import { NodeToolbar as ReactFlowNodeToolbar } from '@xyflow/react'
import { Download } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { UiButton, UiPanel } from '@/components/ui'
import type { CanvasNode } from '@/features/canvas/domain/canvasNodes'
import { isAssetGroupNode } from '@/features/canvas/domain/canvasNodes'
import { ICON_NODE_ASSET_GROUP } from '@/core/theme/icons'
import { resolveAssetGroupMemberKind } from '@/features/canvas/application/assetGroupGraph'
import { useSettingsStore } from '@/stores/settingsStore'
import { useNodeDownload } from '@/features/canvas/hooks/useNodeDownload'
import ContextMenu from '@/components/ContextMenu'
import { BatchConnectionHandle } from './BatchConnectionHandle'
import {
  NODE_TOOLBAR_ALIGN,
  NODE_TOOLBAR_CLASS,
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
    closeDownloadMenu,
    handleDownloadClick,
  } = useNodeDownload(nodes, downloadPresetPaths)
  const selectedGroup = nodes.find(isAssetGroupNode)
  const mediaNodes = nodes.filter((node) => !isAssetGroupNode(node) && Boolean(resolveAssetGroupMemberKind(node)))
  const canCreateAssetGroup = !selectedGroup && mediaNodes.length >= 2
  const canAddToAssetGroup = Boolean(selectedGroup && mediaNodes.length > 0)

  const toolbarPanelRef = useNodeToolbarBoundary(
    nodes.map((node) => node.id).join(' '),
    canDownload || canCreateAssetGroup || canAddToAssetGroup,
  )

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
          <UiPanel ref={toolbarPanelRef} variant="glass" data-node-toolbar-panel className="flex w-max items-center gap-1 overflow-x-auto p-1 [&>*]:shrink-0">
            {canCreateAssetGroup && (
              <UiButton
                onClick={() => onCreateAssetGroup(mediaNodes.map((node) => node.id))}
              >
                <ICON_NODE_ASSET_GROUP className="h-3.5 w-3.5" />
                {t('nodeToolbar.createAssetGroup')}
              </UiButton>
            )}
            {canAddToAssetGroup && selectedGroup && (
              <UiButton
                onClick={() => onAddToAssetGroup(selectedGroup.id, mediaNodes.map((node) => node.id))}
              >
                <ICON_NODE_ASSET_GROUP className="h-3.5 w-3.5" />
                {t('nodeToolbar.addToAssetGroup')}
              </UiButton>
            )}
            {canDownload && (
            <UiButton
              onClick={handleDownloadClick}
            >
              <Download className="h-3.5 w-3.5" />
              {t('nodeToolbar.batchDownload', { count: downloadCount })}
            </UiButton>
            )}
          </UiPanel>

          <ContextMenu
            visible={downloadMenu.visible}
            position={downloadMenu.position}
            items={downloadMenu.items}
            onClose={closeDownloadMenu}
            surface="glass"
          />
        </ReactFlowNodeToolbar>
      )}
      <BatchConnectionHandle nodes={nodes} onConnect={onBatchConnect} />
    </>
  )
})

MultiNodeActionToolbar.displayName = 'MultiNodeActionToolbar'
