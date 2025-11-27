import React from 'react'
import PanelTrigger from '@/components/ui/PanelTrigger'

interface ResolutionPanelProps {
  selectedResolution: string
  resolutionQuality: '2K' | '4K'
  customWidth: string
  customHeight: string
  onResolutionSelect: (value: string) => void
  onQualitySelect: (value: '2K' | '4K') => void
  onWidthChange: (value: string) => void
  onHeightChange: (value: string) => void
}

/**
 * 即梦4.0专用的分辨率选择面板
 * 包含智能模式、比例选择、2K/4K切换和自定义尺寸输入
 */
const ResolutionPanel: React.FC<ResolutionPanelProps> = ({
  selectedResolution,
  resolutionQuality,
  customWidth,
  customHeight,
  onResolutionSelect,
  onQualitySelect,
  onWidthChange,
  onHeightChange
}) => {
  return (
    <PanelTrigger
      label="分辨率"
      display={selectedResolution === 'smart' ? '智能' : selectedResolution}
      className="w-auto"
      panelWidth={320}
      alignment="aboveCenter"
      closeOnPanelClick={false}
      renderPanel={() => (
        <div className="p-4">
          {/* 选择比例 */}
          <div className="mb-3">
            <label className="block text-xs text-zinc-400 mb-2">选择比例</label>
            <div className="grid grid-cols-4 gap-2">
              {[
                { label: '智能', value: 'smart' },
                { label: '21:9', value: '21:9', ratio: '21:9' },
                { label: '16:9', value: '16:9', ratio: '16:9' },
                { label: '3:2', value: '3:2', ratio: '3:2' },
                { label: '4:3', value: '4:3', ratio: '4:3' },
                { label: '1:1', value: '1:1', ratio: '1:1' },
                { label: '3:4', value: '3:4', ratio: '3:4' },
                { label: '2:3', value: '2:3', ratio: '2:3' },
                { label: '9:16', value: '9:16', ratio: '9:16' }
              ].map(resolution => (
                <button
                  key={resolution.value}
                  onClick={() => onResolutionSelect(resolution.value)}
                  className={`px-2 py-3 text-xs rounded flex flex-col items-center justify-center gap-2 transition-all duration-300 ${
                    selectedResolution === resolution.value
                      ? 'bg-[#007eff] text-white'
                      : 'bg-zinc-700/50 text-zinc-300 hover:bg-zinc-600/50'
                  }`}
                >
                  {resolution.ratio && (
                    <div className="flex items-center justify-center h-8">
                      <div
                        className={`border-2 border-white ${
                          resolution.ratio === '21:9' ? 'w-8 h-3' :
                          resolution.ratio === '16:9' ? 'w-8 h-4' :
                          resolution.ratio === '3:2' ? 'w-7 h-5' :
                          resolution.ratio === '4:3' ? 'w-7 h-5' :
                          resolution.ratio === '1:1' ? 'w-6 h-6' :
                          resolution.ratio === '3:4' ? 'w-5 h-7' :
                          resolution.ratio === '2:3' ? 'w-5 h-7' :
                          resolution.ratio === '9:16' ? 'w-4 h-8' :
                          'w-6 h-6'
                        }`}
                      ></div>
                    </div>
                  )}
                  <span className="font-medium">{resolution.label}</span>
                </button>
              ))}
            </div>
          </div>

          {/* 选择分辨率 (2K/4K) */}
          <div className="mb-3">
            <label className="block text-xs text-zinc-400 mb-2">选择分辨率</label>
            <div className="grid grid-cols-2 gap-2">
              {[
                { label: '高清 2K', value: '2K' },
                { label: '超清 4K', value: '4K' }
              ].map(res => (
                <button
                  key={res.value}
                  onClick={() => onQualitySelect(res.value as '2K' | '4K')}
                  className={`px-3 py-2 text-sm rounded transition-all duration-300 ${
                    resolutionQuality === res.value
                      ? 'bg-[#007eff] text-white'
                      : 'bg-zinc-700/50 text-zinc-300 hover:bg-zinc-600/50'
                  }`}
                >
                  {res.label}
                </button>
              ))}
            </div>
          </div>

          {/* 自定义尺寸 */}
          <div>
            <label className="block text-xs text-zinc-400 mb-2">尺寸</label>
            <div className="flex gap-2 items-center">
              <div className="flex-1">
                <input
                  type="number"
                  value={customWidth}
                  onChange={(e) => onWidthChange(e.target.value)}
                  disabled={selectedResolution === 'smart'}
                  placeholder="2048"
                  className={`w-full bg-zinc-700/50 border border-zinc-700/50 rounded px-3 py-2 text-sm ${
                    selectedResolution === 'smart' ? 'opacity-50 cursor-not-allowed' : ''
                  }`}
                  min="1024"
                  max="8192"
                />
              </div>
              <svg className="w-4 h-4 text-zinc-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4"></path>
              </svg>
              <div className="flex-1">
                <input
                  type="number"
                  value={customHeight}
                  onChange={(e) => onHeightChange(e.target.value)}
                  disabled={selectedResolution === 'smart'}
                  placeholder="2048"
                  className={`w-full bg-zinc-700/50 border border-zinc-700/50 rounded px-3 py-2 text-sm ${
                    selectedResolution === 'smart' ? 'opacity-50 cursor-not-allowed' : ''
                  }`}
                  min="1024"
                  max="8192"
                />
              </div>
              <span className="text-xs text-zinc-400">PX</span>
            </div>
          </div>
        </div>
      )}
    />
  )
}

export default ResolutionPanel
