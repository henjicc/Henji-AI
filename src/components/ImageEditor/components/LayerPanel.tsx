/**
 * 图层面板组件
 * 职责：管理图像图层
 */

import React from 'react'
import { useI18n } from '@/hooks/useI18n'
import { UiButton, UiIconButton, UiRangeInput } from '@/components/ui'

interface Layer {
  id: string
  name: string
  visible: boolean
  opacity: number
  locked: boolean
  thumbnail?: string
}

interface LayerPanelProps {
  layers: Layer[]
  activeLayerId: string
  onLayerSelect: (layerId: string) => void
  onLayerVisibilityToggle: (layerId: string) => void
  onLayerOpacityChange: (layerId: string, opacity: number) => void
  onLayerLockToggle: (layerId: string) => void
  onLayerAdd: () => void
  onLayerRemove: (layerId: string) => void
  onLayerDuplicate: (layerId: string) => void
  onLayerReorder: (fromIndex: number, toIndex: number) => void
}

export const LayerPanel: React.FC<LayerPanelProps> = ({
  layers,
  activeLayerId,
  onLayerSelect,
  onLayerVisibilityToggle,
  onLayerOpacityChange,
  onLayerLockToggle,
  onLayerAdd,
  onLayerRemove,
  onLayerDuplicate,
  onLayerReorder
}) => {
  const { t } = useI18n('ui')
  return (
    <div className="layer-panel">
      <div className="panel-header">
        <h3>{t('imageEditor.layerPanel.title')}</h3>
        <UiButton
          type="button"
          size="sm"
          variant="ghost"
          className="add-layer-btn"
          onClick={onLayerAdd}
          title={t('imageEditor.layerPanel.addLayer')}
        >
          +
        </UiButton>
      </div>

      <div className="panel-content">
        {layers.length === 0 ? (
          <div className="layers-empty">
            {t('imageEditor.layerPanel.empty')}
          </div>
        ) : (
          <div className="layers-list">
            {layers.map((layer, index) => (
              <div
                key={layer.id}
                className={`layer-item ${layer.id === activeLayerId ? 'active' : ''}`}
                onClick={() => onLayerSelect(layer.id)}
              >
                <div className="layer-thumbnail">
                  {layer.thumbnail ? (
                    <img src={layer.thumbnail} alt={layer.name} />
                  ) : (
                    <div className="thumbnail-placeholder">📄</div>
                  )}
                </div>

                <div className="layer-info">
                  <div className="layer-name">{layer.name}</div>
                  <div className="layer-controls">
                    <UiIconButton
                      type="button"
                      className={`layer-btn ${layer.visible ? 'active' : ''}`}
                      onClick={(e) => {
                        e.stopPropagation()
                        onLayerVisibilityToggle(layer.id)
                      }}
                      title={layer.visible ? t('imageEditor.layerPanel.actions.hide') : t('imageEditor.layerPanel.actions.show')}
                    >
                      {layer.visible ? '👁' : '👁‍🗨'}
                    </UiIconButton>

                    <UiIconButton
                      type="button"
                      className={`layer-btn ${layer.locked ? 'active' : ''}`}
                      onClick={(e) => {
                        e.stopPropagation()
                        onLayerLockToggle(layer.id)
                      }}
                      title={layer.locked ? t('imageEditor.layerPanel.actions.unlock') : t('imageEditor.layerPanel.actions.lock')}
                    >
                      {layer.locked ? '🔒' : '🔓'}
                    </UiIconButton>
                  </div>
                </div>

                <div className="layer-actions">
                  <UiIconButton
                    type="button"
                    className="layer-action-btn"
                    onClick={(e) => {
                      e.stopPropagation()
                      onLayerDuplicate(layer.id)
                    }}
                    title={t('common:actions.copy')}
                  >
                    📋
                  </UiIconButton>
                  <UiIconButton
                    type="button"
                    className="layer-action-btn"
                    onClick={(e) => {
                      e.stopPropagation()
                      onLayerRemove(layer.id)
                    }}
                    title={t('common:delete')}
                    disabled={layers.length === 1}
                  >
                    🗑️
                  </UiIconButton>
                </div>

                <div className="layer-opacity">
                  <UiRangeInput
                    min="0"
                    max="100"
                    value={layer.opacity}
                    onChange={(e) => {
                      e.stopPropagation()
                      onLayerOpacityChange(layer.id, Number(e.target.value))
                    }}
                    onClick={(e) => e.stopPropagation()}
                  />
                  <span>{layer.opacity}%</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
