/**
 * 图层面板组件
 * 职责：管理图像图层
 */

import React from 'react'

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
  return (
    <div className="layer-panel">
      <div className="panel-header">
        <h3>图层</h3>
        <button className="add-layer-btn" onClick={onLayerAdd} title="添加图层">
          +
        </button>
      </div>

      <div className="panel-content">
        {layers.length === 0 ? (
          <div className="layers-empty">
            暂无图层
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
                    <button
                      className={`layer-btn ${layer.visible ? 'active' : ''}`}
                      onClick={(e) => {
                        e.stopPropagation()
                        onLayerVisibilityToggle(layer.id)
                      }}
                      title={layer.visible ? '隐藏' : '显示'}
                    >
                      {layer.visible ? '👁' : '👁‍🗨'}
                    </button>

                    <button
                      className={`layer-btn ${layer.locked ? 'active' : ''}`}
                      onClick={(e) => {
                        e.stopPropagation()
                        onLayerLockToggle(layer.id)
                      }}
                      title={layer.locked ? '解锁' : '锁定'}
                    >
                      {layer.locked ? '🔒' : '🔓'}
                    </button>
                  </div>
                </div>

                <div className="layer-actions">
                  <button
                    className="layer-action-btn"
                    onClick={(e) => {
                      e.stopPropagation()
                      onLayerDuplicate(layer.id)
                    }}
                    title="复制"
                  >
                    📋
                  </button>
                  <button
                    className="layer-action-btn"
                    onClick={(e) => {
                      e.stopPropagation()
                      onLayerRemove(layer.id)
                    }}
                    title="删除"
                    disabled={layers.length === 1}
                  >
                    🗑️
                  </button>
                </div>

                <div className="layer-opacity">
                  <input
                    type="range"
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
