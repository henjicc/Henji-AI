import { useCallback, useEffect, type MouseEvent } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import ContextMenu from '@/components/ContextMenu'
import { useContextMenu } from '@/hooks/useContextMenu'
import { useCanvasStore } from '@/stores/canvasStore'
import { getCanvasNodeDefinition } from '../domain/nodeRegistry'
import type { CanvasNode } from '../domain/canvasNodes'
import { nodeParameterDefaults, supportsNodeParameterDefaults } from '../application/nodeParameterDefaults'
import { canvasEventBus } from '../application/canvasServices'

export function useNodeParameterContextMenu(closeAddMenu: () => void) {
  const { t } = useTranslation()
  const menu = useContextMenu()
  const { showMenu, hideMenu } = menu
  useEffect(() => {
    if (!menu.menuVisible) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') hideMenu()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [hideMenu, menu.menuVisible])

  const onNodeContextMenu = useCallback((event: MouseEvent, node: CanvasNode) => {
    event.preventDefault()
    event.stopPropagation()
    closeAddMenu()
    hideMenu()
    const definition = getCanvasNodeDefinition(node.type)
    if (!definition || !supportsNodeParameterDefaults(definition)) return
    showMenu(event, [{
      id: 'set-node-defaults',
      label: t('canvas.setNodeDefaults', { defaultValue: '设置默认值' }),
      icon: null,
      onClick: () => {
        const current = useCanvasStore.getState().nodes.find((item) => item.id === node.id)
        if (!current || current.type !== node.type) return
        try {
          nodeParameterDefaults.save(definition, current.data)
          canvasEventBus.publish('canvas/toast', {
            type: 'success',
            message: t('canvas.nodeDefaultsSaved', { defaultValue: '已设为新建同类节点的默认参数' }),
          })
        } catch {
          canvasEventBus.publish('canvas/toast', {
            type: 'error',
            message: t('canvas.nodeDefaultsFailed', { defaultValue: '默认参数保存失败，请重试' }),
          })
        }
      },
    }])
  }, [closeAddMenu, hideMenu, showMenu, t])

  return {
    onNodeContextMenu,
    hideNodeContextMenu: hideMenu,
    nodeContextMenu: menu.menuVisible ? createPortal(
      <ContextMenu visible position={menu.menuPosition} items={menu.menuItems} onClose={hideMenu} />,
      document.body,
    ) : null,
  }
}
