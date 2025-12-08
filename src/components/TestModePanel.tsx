/**
 * 测试模式面板
 * 用于配置测试选项和查看请求参数
 */

import React, { useState, useEffect } from 'react'
import {
  getTestModeState,
  updateTestOptions,
  toggleTestMode,
  type TestModeState
} from '@/utils/testMode'

interface TestModePanelProps {
  isOpen: boolean
  onClose: () => void
}

const TestModePanel: React.FC<TestModePanelProps> = ({ isOpen, onClose }) => {
  const [state, setState] = useState<TestModeState>(getTestModeState())
  const [opacity, setOpacity] = useState(0)

  useEffect(() => {
    if (isOpen) {
      setOpacity(1)
    } else {
      setOpacity(0)
    }
  }, [isOpen])

  useEffect(() => {
    const handleTestModeChange = (event: CustomEvent) => {
      setState(event.detail)
    }

    window.addEventListener('test-mode-changed', handleTestModeChange as EventListener)

    return () => {
      window.removeEventListener('test-mode-changed', handleTestModeChange as EventListener)
    }
  }, [])

  const handleToggleTestMode = () => {
    toggleTestMode()
    setState(getTestModeState())
  }

  const handleToggleOption = (option: keyof typeof state.options) => {
    updateTestOptions({ [option]: !state.options[option] })
    setState(getTestModeState())
  }

  const handleClose = () => {
    setOpacity(0)
    setTimeout(() => onClose(), 180)
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* 背景遮罩 */}
      <div
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        style={{ opacity, transition: 'opacity 180ms ease' }}
        onClick={handleClose}
      />

      {/* 面板内容 */}
      <div
        className="relative bg-[#1a1a1a] border border-yellow-500/50 rounded-xl p-6 w-[600px] max-h-[80vh] overflow-y-auto shadow-2xl"
        style={{
          opacity,
          transform: `scale(${0.97 + 0.03 * opacity})`,
          transition: 'opacity 180ms ease, transform 180ms ease'
        }}
      >
        {/* 标题栏 */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <div className="w-3 h-3 bg-yellow-500 rounded-full animate-pulse" />
            <h2 className="text-xl font-bold text-yellow-500">测试模式</h2>
          </div>
          <button
            onClick={handleClose}
            className="text-gray-400 hover:text-white transition-colors"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="h-6 w-6"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>

        {/* 快捷键提示 */}
        <div className="mb-6 p-3 bg-yellow-500/10 border border-yellow-500/30 rounded-lg">
          <div className="text-sm text-yellow-500/80">
            快捷键: <kbd className="px-2 py-1 bg-black/30 rounded">Ctrl</kbd> +{' '}
            <kbd className="px-2 py-1 bg-black/30 rounded">Alt</kbd> +{' '}
            <kbd className="px-2 py-1 bg-black/30 rounded">Shift</kbd> +{' '}
            <kbd className="px-2 py-1 bg-black/30 rounded">T</kbd>
          </div>
        </div>

        {/* 测试模式开关 */}
        <div className="mb-6">
          <div className="flex items-center justify-between p-4 bg-zinc-800/50 rounded-lg border border-zinc-700/50">
            <div>
              <div className="text-white font-medium">启用测试模式</div>
              <div className="text-sm text-gray-400 mt-1">
                开启后可以使用测试功能，不影响正常使用
              </div>
            </div>
            <button
              onClick={handleToggleTestMode}
              className={`relative w-14 h-7 rounded-full transition-colors ${
                state.enabled ? 'bg-yellow-500' : 'bg-zinc-600'
              }`}
            >
              <div
                className={`absolute top-1 w-5 h-5 bg-white rounded-full transition-transform ${
                  state.enabled ? 'translate-x-8' : 'translate-x-1'
                }`}
              />
            </button>
          </div>
        </div>

        {/* 测试选项 */}
        {state.enabled && (
          <div className="mb-6">
            <h3 className="text-white font-medium mb-3">测试选项</h3>
            <div className="space-y-3">
              {/* 跳过请求 */}
              <label className="flex items-center justify-between p-3 bg-zinc-800/30 rounded-lg border border-zinc-700/30 cursor-pointer hover:bg-zinc-800/50 transition-colors">
                <div>
                  <div className="text-white text-sm">不发送实际请求</div>
                  <div className="text-xs text-gray-400 mt-1">
                    点击生成时不会调用 API，仅输出参数
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={state.options.skipRequest}
                  onChange={() => handleToggleOption('skipRequest')}
                  className="w-5 h-5 rounded border-gray-600 text-yellow-500 focus:ring-yellow-500 focus:ring-offset-0"
                />
              </label>

              {/* 输出参数 */}
              <label className="flex items-center justify-between p-3 bg-zinc-800/30 rounded-lg border border-zinc-700/30 cursor-pointer hover:bg-zinc-800/50 transition-colors">
                <div>
                  <div className="text-white text-sm">在控制台输出参数</div>
                  <div className="text-xs text-gray-400 mt-1">
                    在浏览器控制台显示完整的请求参数
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={state.options.logParams}
                  onChange={() => handleToggleOption('logParams')}
                  className="w-5 h-5 rounded border-gray-600 text-yellow-500 focus:ring-yellow-500 focus:ring-offset-0"
                />
              </label>
            </div>
          </div>
        )}

        {/* 最后的请求参数 */}
        {state.enabled && state.lastParams && (
          <div>
            <h3 className="text-white font-medium mb-3">最后的请求参数</h3>
            <div className="bg-black/50 rounded-lg p-4 border border-zinc-700/50 max-h-[300px] overflow-y-auto">
              <div className="space-y-2 text-sm">
                <div>
                  <span className="text-gray-400">模型:</span>{' '}
                  <span className="text-yellow-500">{state.lastParams.model}</span>
                </div>
                <div>
                  <span className="text-gray-400">类型:</span>{' '}
                  <span className="text-yellow-500">{state.lastParams.type}</span>
                </div>
                <div>
                  <span className="text-gray-400">提示词:</span>{' '}
                  <span className="text-white">{state.lastParams.input}</span>
                </div>
                <div className="pt-2 border-t border-zinc-700/50">
                  <div className="text-gray-400 mb-2">完整参数:</div>
                  <pre className="text-xs text-gray-300 whitespace-pre-wrap break-all">
                    {JSON.stringify(state.lastParams, null, 2)}
                  </pre>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* 提示信息 */}
        {state.enabled && !state.lastParams && (
          <div className="text-center text-gray-400 text-sm py-8">
            点击生成按钮后，请求参数将显示在这里
          </div>
        )}
      </div>
    </div>
  )
}

export default TestModePanel
