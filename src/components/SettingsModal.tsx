import React, { useState, useEffect, useRef } from 'react'
import NumberInput from './ui/NumberInput'
import Toggle from './ui/Toggle'
import { apiService } from '../services/api'

interface SettingsModalProps {
  onClose: () => void
}

const SettingsModal: React.FC<SettingsModalProps> = ({ onClose }) => {
  const [apiKey, setApiKey] = useState('')
  const [falApiKey, setFalApiKey] = useState('')
  const [maxHistoryCount, setMaxHistoryCount] = useState(50)
  const [showPriceEstimate, setShowPriceEstimate] = useState(true)
  const [showApiKey, setShowApiKey] = useState(false)
  const [showFalApiKey, setShowFalApiKey] = useState(false)
  const modalRef = useRef<HTMLDivElement>(null)
  const [closing, setClosing] = useState(false)

  useEffect(() => {
    // 从localStorage获取保存的设置
    const savedApiKey = localStorage.getItem('piaoyun_api_key') || ''
    setApiKey(savedApiKey)

    const savedFalApiKey = localStorage.getItem('fal_api_key') || ''
    setFalApiKey(savedFalApiKey)

    const savedMaxHistory = parseInt(localStorage.getItem('max_history_count') || '50', 10)
    setMaxHistoryCount(savedMaxHistory)

    const savedShowPrice = localStorage.getItem('show_price_estimate')
    setShowPriceEstimate(savedShowPrice !== 'false') // 默认开启

    // 点击模态框外部关闭
    const handleClickOutside = (event: MouseEvent) => {
      if (modalRef.current && !modalRef.current.contains(event.target as Node)) {
        handleClose()
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [])

  const handleClose = () => {
    setClosing(true)
    setTimeout(() => {
      onClose()
    }, 300)
  }

  // 实时保存 Piaoyun API Key
  const handleApiKeyChange = (value: string) => {
    setApiKey(value)
    localStorage.setItem('piaoyun_api_key', value)
    apiService.setApiKey(value)
    // 尝试初始化适配器（如果key不为空）
    if (value.trim()) {
      apiService.initializeAdapter({
        type: 'piaoyun',
        modelName: 'seedream-4.0'
      })
    }
  }

  // 实时保存 fal API Key
  const handleFalApiKeyChange = (value: string) => {
    setFalApiKey(value)
    localStorage.setItem('fal_api_key', value)
  }

  // 实时保存历史记录数量
  const handleHistoryCountChange = (value: number) => {
    const newValue = Math.max(1, Math.min(500, Math.round(value)))
    setMaxHistoryCount(newValue)
    localStorage.setItem('max_history_count', newValue.toString())
  }

  // 实时保存价格显示设置
  const handleShowPriceChange = (value: boolean) => {
    setShowPriceEstimate(value)
    localStorage.setItem('show_price_estimate', value.toString())
    // 触发自定义事件，通知 PriceEstimate 组件更新
    window.dispatchEvent(new Event('priceSettingChanged'))
  }

  return (
    <div className={`fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4 ${closing ? 'animate-fade-out' : 'animate-fade-in'}`}>
      <div
        ref={modalRef}
        className={`bg-[#131313]/90 backdrop-blur-xl border border-zinc-700/50 rounded-2xl w-full max-w-md shadow-2xl transform transition-all duration-300 scale-100 ${closing ? 'animate-scale-out' : 'animate-scale-in'}`}
      >
        <div className="p-5 border-b border-zinc-700/50 flex justify-between items-center">
          <h2 className="text-xl font-bold text-[#007eff]">
            设置
          </h2>
          <button
            onClick={handleClose}
            className="text-zinc-400 hover:text-white transition-colors duration-200 p-1 rounded-full hover:bg-zinc-800/50"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="p-5">
          <div className="mb-5">
            <label className="block text-sm font-medium mb-2 text-zinc-300">派欧云API密钥</label>
            <div className="relative">
              <input
                type={showApiKey ? "text" : "password"}
                value={apiKey}
                onChange={(e) => handleApiKeyChange(e.target.value)}
                placeholder="请输入您的API密钥"
                className="w-full bg-zinc-800/70 backdrop-blur-lg border border-zinc-700/50 rounded-lg px-4 py-3 outline-none focus:outline-none focus:ring-inset focus:ring-2 focus:ring-[#007eff]/60 focus:ring-offset-0 focus:ring-offset-transparent focus:border-[#007eff] transition-shadow duration-300 ease-out text-white placeholder-zinc-400 pr-10"
              />
              <button
                onClick={() => setShowApiKey(!showApiKey)}
                className="absolute inset-y-0 right-0 flex items-center pr-3 text-zinc-500 hover:text-zinc-300 transition-colors"
              >
                {showApiKey ? (
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
                  </svg>
                ) : (
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                  </svg>
                )}
              </button>
            </div>
            <p className="mt-2 text-xs text-zinc-400">
              您可以在派欧云控制台获取API密钥
            </p>
          </div>

          <div className="mb-5">
            <label className="block text-sm font-medium mb-2 text-zinc-300">fal API密钥</label>
            <div className="relative">
              <input
                type={showFalApiKey ? "text" : "password"}
                value={falApiKey}
                onChange={(e) => handleFalApiKeyChange(e.target.value)}
                placeholder="请输入您的 fal API 密钥"
                className="w-full bg-zinc-800/70 backdrop-blur-lg border border-zinc-700/50 rounded-lg px-4 py-3 outline-none focus:outline-none focus:ring-inset focus:ring-2 focus:ring-[#007eff]/60 focus:ring-offset-0 focus:ring-offset-transparent focus:border-[#007eff] transition-shadow duration-300 ease-out text-white placeholder-zinc-400 pr-10"
              />
              <button
                onClick={() => setShowFalApiKey(!showFalApiKey)}
                className="absolute inset-y-0 right-0 flex items-center pr-3 text-zinc-500 hover:text-zinc-300 transition-colors"
              >
                {showFalApiKey ? (
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
                  </svg>
                ) : (
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                  </svg>
                )}
              </button>
            </div>
            <p className="mt-2 text-xs text-zinc-400">
              您可以在 fal.ai 控制台获取 API 密钥
            </p>
          </div>

          <div className="mb-5">
            <NumberInput
              label="历史记录保存数量"
              value={maxHistoryCount}
              onChange={handleHistoryCountChange}
              min={1}
              max={500}
              step={1}
              widthClassName="w-full"
            />
            <p className="mt-2 text-xs text-zinc-400">最多保存 1-500 条历史记录,超出后将自动删除最旧的记录</p>
          </div>

          <div className="mb-5">
            <Toggle
              label="显示价格估算"
              checked={showPriceEstimate}
              onChange={handleShowPriceChange}
              className="w-full"
            />
            <p className="mt-2 text-xs text-zinc-400">在生成面板显示预估费用</p>
          </div>

          <div className="flex justify-end mt-6">
            <button
              onClick={handleClose}
              className="px-6 py-2 bg-[#007eff] hover:brightness-110 text-white shadow-lg hover:shadow-xl rounded-lg transition-all duration-300 flex items-center font-medium"
            >
              确定
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

export default SettingsModal
