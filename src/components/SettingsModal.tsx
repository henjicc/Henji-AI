import React, { useState, useEffect, useRef } from 'react'
import NumberInput from './ui/NumberInput'
import { apiService } from '../services/api'

interface SettingsModalProps {
  onClose: () => void
}

const SettingsModal: React.FC<SettingsModalProps> = ({ onClose }) => {
  const [apiKey, setApiKey] = useState('')
  const [maxHistoryCount, setMaxHistoryCount] = useState(50)
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [error, setError] = useState('')
  const modalRef = useRef<HTMLDivElement>(null)
  const [closing, setClosing] = useState(false)

  useEffect(() => {
    // 从localStorage获取保存的API密钥
    const savedApiKey = localStorage.getItem('piaoyun_api_key') || ''
    setApiKey(savedApiKey)
    
    // 从localStorage获取历史记录数量设置
    const savedMaxHistory = parseInt(localStorage.getItem('max_history_count') || '50', 10)
    setMaxHistoryCount(savedMaxHistory)
    
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

  const handleSave = () => {
    if (!apiKey.trim()) {
      setError('请输入API密钥')
      return
    }

    setStatus('saving')
    setError('')

    try {
      // 保存到localStorage
      localStorage.setItem('piaoyun_api_key', apiKey)
      localStorage.setItem('max_history_count', maxHistoryCount.toString())
      
      // 设置到API服务
      apiService.setApiKey(apiKey)
      
      // 初始化适配器
      apiService.initializeAdapter({
        type: 'piaoyun',
        modelName: 'seedream-4.0'
      })
      
      setStatus('saved')
      setTimeout(() => {
        handleClose()
      }, 1000)
    } catch (err) {
      setStatus('error')
      setError(err instanceof Error ? err.message : '保存失败')
    }
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
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="请输入您的API密钥"
                className="w-full bg-zinc-800/70 backdrop-blur-lg border border-zinc-700/50 rounded-lg px-4 py-3 focus:outline-none focus:ring-2 focus:ring-[#007eff]/50 transition-all duration-300 text-white placeholder-zinc-400"
              />
              <div className="absolute inset-y-0 right-0 flex items-center pr-3">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-zinc-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
                </svg>
              </div>
            </div>
            <p className="mt-2 text-xs text-zinc-400">
              您可以在派欧云控制台获取API密钥
            </p>
          </div>

          <div className="mb-5">
            <NumberInput label="历史记录保存数量" value={maxHistoryCount} onChange={(v)=>setMaxHistoryCount(Math.max(1, Math.min(500, Math.round(v))))} min={1} max={500} step={1} widthClassName="w-full" />
            <p className="mt-2 text-xs text-zinc-400">最多保存 1-500 条历史记录,超出后将自动删除最旧的记录</p>
          </div>

          {error && (
            <div className="mb-4 p-3 bg-red-900/50 backdrop-blur-lg border border-red-700/50 rounded-lg animate-shake">
              <p className="text-red-200 text-sm">{error}</p>
            </div>
          )}

          {status === 'saved' && (
            <div className="mb-4 p-3 bg-green-900/50 backdrop-blur-lg border border-green-700/50 rounded-lg">
              <p className="text-green-200 text-sm flex items-center">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                保存成功！
              </p>
            </div>
          )}

          <div className="flex justify-end gap-3 mt-6">
            <button
              onClick={handleClose}
              className="px-4 py-2 bg-zinc-700/50 hover:bg-zinc-600/50 backdrop-blur-lg rounded-lg transition-all duration-300 border border-zinc-700/50"
            >
              取消
            </button>
            <button
              onClick={handleSave}
              disabled={status === 'saving'}
              className={`px-4 py-2 rounded-lg transition-all duration-300 flex items-center ${
                status === 'saving'
                  ? 'bg-[#007eff]/20 text-[#66b3ff] cursor-not-allowed'
                  : 'bg-[#007eff] hover:brightness-110 text-white shadow-lg hover:shadow-xl'
              }`}
            >
              {status === 'saving' ? (
                <>
                  <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  保存中...
                </>
              ) : (
                <>
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  保存
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

export default SettingsModal
