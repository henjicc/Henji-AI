import React, { useState, useEffect, useRef } from 'react'
import NumberInput from './ui/NumberInput'
import Toggle from './ui/Toggle'
import { apiService } from '../services/api'
import { open } from '@tauri-apps/plugin-shell'
import { open as openDialog } from '@tauri-apps/plugin-dialog'
import { getDataRoot, getDefaultDataRoot, setCustomDataRoot, resetToDefaultDataRoot, validateDirectory, hasExistingData, migrateData } from '../utils/dataPath'
import { path } from '@tauri-apps/api'
import { logError } from '../utils/errorLogger'

interface SettingsModalProps {
  onClose: () => void
}

type SettingsTab = 'general' | 'api' | 'interface'

const SettingsModal: React.FC<SettingsModalProps> = ({ onClose }) => {
  const [activeTab, setActiveTab] = useState<SettingsTab>('general')
  const [apiKey, setApiKey] = useState('')
  const [falApiKey, setFalApiKey] = useState('')
  const [modelscopeApiKey, setModelscopeApiKey] = useState('')
  const [kieApiKey, setKieApiKey] = useState('')
  const [maxHistoryCount, setMaxHistoryCount] = useState(50)
  const [showPriceEstimate, setShowPriceEstimate] = useState(true)
  const [showApiKey, setShowApiKey] = useState(false)
  const [showFalApiKey, setShowFalApiKey] = useState(false)
  const [showModelscopeApiKey, setShowModelscopeApiKey] = useState(false)
  const [showKieApiKey, setShowKieApiKey] = useState(false)
  const [enableAutoCollapse, setEnableAutoCollapse] = useState(true)
  const [collapseDelay, setCollapseDelay] = useState(500)
  const [collapseOnScrollOnly, setCollapseOnScrollOnly] = useState(true)
  const [enableQuickDownload, setEnableQuickDownload] = useState(false)
  const [quickDownloadButtonOnly, setQuickDownloadButtonOnly] = useState(false)
  const [quickDownloadPath, setQuickDownloadPath] = useState('')
  const modalRef = useRef<HTMLDivElement>(null)
  const [closing, setClosing] = useState(false)

  // 自定义数据目录相关状态
  const [customDataPath, setCustomDataPath] = useState('')
  const [isMigrating, setIsMigrating] = useState(false)
  const [migrationProgress, setMigrationProgress] = useState({ current: 0, total: 0, file: '' })
  const [showMigrationDialog, setShowMigrationDialog] = useState(false)
  const [showConflictDialog, setShowConflictDialog] = useState(false)
  const [conflictDialogPath, setConflictDialogPath] = useState('')

  // 统一的提示弹窗状态
  const [showAlertDialog, setShowAlertDialog] = useState(false)
  const [alertMessage, setAlertMessage] = useState('')
  const [alertType, setAlertType] = useState<'success' | 'error' | 'warning'>('success')
  const [showConfirmResetDialog, setShowConfirmResetDialog] = useState(false)
  const [dialogOpacity, setDialogOpacity] = useState(0)

  // 弹窗动画效果
  useEffect(() => {
    if (showAlertDialog || showConfirmResetDialog || showConflictDialog || showMigrationDialog) {
      requestAnimationFrame(() => setDialogOpacity(1))
    }
  }, [showAlertDialog, showConfirmResetDialog, showConflictDialog, showMigrationDialog])

  // 辅助函数：显示提示弹窗
  const showAlert = (message: string, type: 'success' | 'error' | 'warning' = 'success') => {
    setAlertMessage(message)
    setAlertType(type)
    setShowAlertDialog(true)
  }

  // 辅助函数：关闭弹窗
  const closeDialog = (setShowDialog: (show: boolean) => void) => {
    setDialogOpacity(0)
    setTimeout(() => setShowDialog(false), 180)
  }

  useEffect(() => {
    // 从localStorage获取保存的设置
    const savedApiKey = localStorage.getItem('ppio_api_key') || ''
    setApiKey(savedApiKey)

    const savedFalApiKey = localStorage.getItem('fal_api_key') || ''
    setFalApiKey(savedFalApiKey)

    const savedModelscopeApiKey = localStorage.getItem('modelscope_api_key') || ''
    setModelscopeApiKey(savedModelscopeApiKey)

    const savedKieApiKey = localStorage.getItem('kie_api_key') || ''
    setKieApiKey(savedKieApiKey)

    const savedMaxHistory = parseInt(localStorage.getItem('max_history_count') || '50', 10)
    setMaxHistoryCount(savedMaxHistory)

    const savedShowPrice = localStorage.getItem('show_price_estimate')
    setShowPriceEstimate(savedShowPrice !== 'false') // 默认开启

    const savedAutoCollapse = localStorage.getItem('enable_auto_collapse')
    setEnableAutoCollapse(savedAutoCollapse !== 'false') // 默认开启

    const savedCollapseDelay = parseInt(localStorage.getItem('collapse_delay') || '500', 10)
    setCollapseDelay(savedCollapseDelay)

    const savedCollapseOnScrollOnly = localStorage.getItem('collapse_on_scroll_only')
    setCollapseOnScrollOnly(savedCollapseOnScrollOnly !== 'false') // 默认开启

    const savedEnableQuickDownload = localStorage.getItem('enable_quick_download')
    setEnableQuickDownload(savedEnableQuickDownload === 'true')

    const savedQuickDownloadButtonOnly = localStorage.getItem('quick_download_button_only')
    setQuickDownloadButtonOnly(savedQuickDownloadButtonOnly !== 'false') // 默认开启

    const savedQuickDownloadPath = localStorage.getItem('quick_download_path') || ''
    setQuickDownloadPath(savedQuickDownloadPath)

    // 加载当前数据路径
    const loadDataPath = async () => {
      try {
        const currentPath = await getDataRoot()
        setCustomDataPath(currentPath)
      } catch (error) {
        logError('加载数据路径失败:', error)
      }
    }
    loadDataPath()

    // 点击模态框外部关闭
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as HTMLElement

      // 检查是否点击在弹窗内部（通过 data-dialog 属性识别）
      const isClickInsideDialog = target.closest('[data-dialog="true"]')

      if (isClickInsideDialog) {
        return // 点击在弹窗内部，不关闭设置面板
      }

      if (modalRef.current && !modalRef.current.contains(target)) {
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

  // 实时保存 PPIO API Key
  const handleApiKeyChange = (value: string) => {
    setApiKey(value)
    localStorage.setItem('ppio_api_key', value)
    apiService.setApiKey(value)
    // 尝试初始化适配器（如果key不为空）
    if (value.trim()) {
      apiService.initializeAdapter({
        type: 'ppio',
        modelName: 'seedream-4.0'
      })
    }
  }

  // 实时保存 fal API Key
  const handleFalApiKeyChange = (value: string) => {
    setFalApiKey(value)
    localStorage.setItem('fal_api_key', value)
  }

  // 实时保存魔搭 API Key
  const handleModelscopeApiKeyChange = (value: string) => {
    setModelscopeApiKey(value)
    localStorage.setItem('modelscope_api_key', value)
  }

  // 实时保存 KIE API Key
  const handleKieApiKeyChange = (value: string) => {
    setKieApiKey(value)
    localStorage.setItem('kie_api_key', value)
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

  // 实时保存自动折叠设置
  const handleAutoCollapseChange = (value: boolean) => {
    setEnableAutoCollapse(value)
    localStorage.setItem('enable_auto_collapse', value.toString())
    // 触发自定义事件通知 App 组件
    window.dispatchEvent(new Event('collapseSettingChanged'))
  }

  // 实时保存折叠延迟设置
  const handleCollapseDelayChange = (value: number) => {
    const newValue = Math.max(100, Math.min(3000, Math.round(value)))
    setCollapseDelay(newValue)
    localStorage.setItem('collapse_delay', newValue.toString())
    // 触发自定义事件通知 App 组件
    window.dispatchEvent(new Event('collapseSettingChanged'))
  }

  // 实时保存仅滚动时折叠设置
  const handleCollapseOnScrollOnlyChange = (value: boolean) => {
    setCollapseOnScrollOnly(value)
    localStorage.setItem('collapse_on_scroll_only', value.toString())
    // 触发自定义事件通知 App 组件
    window.dispatchEvent(new Event('collapseSettingChanged'))
  }

  // 实时保存快速下载启用设置
  const handleEnableQuickDownloadChange = (value: boolean) => {
    setEnableQuickDownload(value)
    localStorage.setItem('enable_quick_download', value.toString())
  }

  // 实时保存仅按钮快速下载设置
  const handleQuickDownloadButtonOnlyChange = (value: boolean) => {
    setQuickDownloadButtonOnly(value)
    localStorage.setItem('quick_download_button_only', value.toString())
  }

  // 实时保存快速下载路径
  const handleQuickDownloadPathChange = (value: string) => {
    setQuickDownloadPath(value)
    localStorage.setItem('quick_download_path', value)
  }

  // 选择快速下载路径
  const handleSelectQuickDownloadPath = async () => {
    try {
      const selected = await openDialog({
        directory: true,
        multiple: false,
        title: '选择快速下载保存目录'
      })

      if (selected && typeof selected === 'string') {
        handleQuickDownloadPathChange(selected)
      }
    } catch (error) {
      logError('选择目录失败:', error)
    }
  }

  // 打开外部链接
  const handleOpenLink = async (url: string) => {
    try {
      await open(url)
    } catch (error) {
      logError('Failed to open link:', error)
    }
  }

  // 执行数据迁移
  const performMigration = async (oldPath: string, newPath: string, mode: 'normal' | 'merge' | 'overwrite' = 'normal') => {
    setIsMigrating(true)
    setShowMigrationDialog(true)

    try {
      await migrateData(oldPath, newPath, (current, total, file) => {
        setMigrationProgress({ current, total, file })
      }, mode)

      // 迁移成功，更新配置
      await setCustomDataRoot(newPath)
      setCustomDataPath(newPath)

      // 触发路径变更事件
      window.dispatchEvent(new Event('dataPathChanged'))

      showAlert('数据迁移成功！页面即将刷新...', 'success')

      // 延迟刷新页面以确保数据正确加载
      setTimeout(() => {
        window.location.reload()
      }, 1500)
    } catch (error) {
      logError('迁移失败:', error)
      showAlert(`迁移失败：${error instanceof Error ? error.message : '未知错误'}`, 'error')
    } finally {
      setIsMigrating(false)
      setShowMigrationDialog(false)
    }
  }

  // 选择数据保存目录
  const handleSelectDataDirectory = async () => {
    try {
      const selected = await openDialog({
        directory: true,
        multiple: false,
        title: '选择数据保存目录'
      })

      if (!selected || typeof selected !== 'string') return

      // 验证目录
      const isValid = await validateDirectory(selected)
      if (!isValid) {
        showAlert('所选目录无法写入，请选择其他目录', 'error')
        return
      }

      // 检查是否已有数据
      const targetPath = await path.join(selected, 'Henji-AI')
      const hasData = await hasExistingData(targetPath)

      if (hasData) {
        // 显示冲突处理对话框
        setConflictDialogPath(targetPath)
        setShowConflictDialog(true)
        return
      }

      // 执行迁移
      const currentPath = await getDataRoot()
      await performMigration(currentPath, targetPath)
    } catch (error) {
      logError('选择目录失败:', error)
      showAlert(`操作失败：${error instanceof Error ? error.message : '未知错误'}`, 'error')
    }
  }

  // 恢复默认数据目录
  const handleResetToDefault = async () => {
    setShowConfirmResetDialog(true)
  }

  // 确认恢复默认
  const confirmResetToDefault = async () => {
    closeDialog(setShowConfirmResetDialog)

    try {
      const currentPath = await getDataRoot()
      const defaultPath = await getDefaultDataRoot()

      await performMigration(currentPath, defaultPath)
      await resetToDefaultDataRoot()
      setCustomDataPath(defaultPath)
    } catch (error) {
      logError('恢复默认失败:', error)
      showAlert(`恢复默认失败：${error instanceof Error ? error.message : '未知错误'}`, 'error')
    }
  }

  // 处理目录冲突
  const handleConflictResolution = async (action: 'merge' | 'overwrite' | 'cancel') => {
    closeDialog(setShowConflictDialog)

    if (action === 'cancel') {
      setConflictDialogPath('')
      return
    }

    try {
      const currentPath = await getDataRoot()
      await performMigration(currentPath, conflictDialogPath, action)
      setConflictDialogPath('')
    } catch (error) {
      logError('冲突处理失败:', error)
      showAlert(`操作失败：${error instanceof Error ? error.message : '未知错误'}`, 'error')
    }
  }

  const tabs: { id: SettingsTab; label: string; icon: React.ReactNode }[] = [
    {
      id: 'general',
      label: '常规设置',
      icon: (
        <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
        </svg>
      )
    },
    {
      id: 'api',
      label: 'API 设置',
      icon: (
        <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
        </svg>
      )
    },
    {
      id: 'interface',
      label: '界面设置',
      icon: (
        <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
        </svg>
      )
    }
  ]

  return (
    <div className={`fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4 ${closing ? 'animate-fade-out' : 'animate-fade-in'}`}>
      <div
        ref={modalRef}
        className={`bg-[#131313]/95 backdrop-blur-xl border border-zinc-700/50 rounded-2xl w-full max-w-4xl shadow-2xl transform transition-all duration-300 scale-100 flex overflow-hidden ${closing ? 'animate-scale-out' : 'animate-scale-in'}`}
        style={{
          height: '70vh',
          minHeight: '450px',
          maxHeight: '900px'
        }}
      >
        {/* 左侧侧边栏 */}
        <div className="w-56 bg-zinc-900/50 border-r border-zinc-700/50 flex flex-col">
          <div className="p-4 border-b border-zinc-700/50">
            <h2 className="text-lg font-bold text-[#007eff]">设置</h2>
          </div>
          <div className="flex-1 py-3 space-y-1">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`w-full px-4 py-2.5 flex items-center space-x-3 transition-colors duration-200 ${activeTab === tab.id
                  ? 'bg-[#007eff]/10 text-[#007eff] border-r-2 border-[#007eff]'
                  : 'text-zinc-400 hover:bg-zinc-800/50 hover:text-zinc-200'
                  }`}
              >
                {tab.icon}
                <span className="font-medium text-sm">{tab.label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* 右侧内容区域 */}
        <div className="flex-1 flex flex-col h-full">
          <div className="p-4 border-b border-zinc-700/50 flex justify-between items-center bg-zinc-900/20">
            <h3 className="text-base font-medium text-white">
              {tabs.find(t => t.id === activeTab)?.label}
            </h3>
            <button
              onClick={handleClose}
              className="text-zinc-400 hover:text-white transition-colors duration-200 p-1 rounded-full hover:bg-zinc-800/50"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-5">
            {activeTab === 'general' && (
              <div className="space-y-5 animate-fade-in">
                <div>
                  <h4 className="text-xs font-medium text-zinc-400 mb-3 uppercase tracking-wider">历史记录</h4>
                  <div className="bg-zinc-800/30 rounded-xl p-4 border border-zinc-700/30">
                    <NumberInput
                      label="保存数量限制"
                      value={maxHistoryCount}
                      onChange={handleHistoryCountChange}
                      min={1}
                      max={500}
                      step={1}
                      widthClassName="w-full"
                    />
                    <p className="mt-2 text-xs text-zinc-500">最多保存 1-500 条历史记录，超出后将自动删除最旧的记录</p>

                    <div className="mt-4 pt-4 border-t border-zinc-700/30">
                      <label className="block text-sm font-medium mb-2 text-zinc-300">
                        数据保存目录
                      </label>
                      <div className="flex gap-2">
                        <input
                          type="text"
                          value={customDataPath}
                          readOnly
                          className="flex-1 bg-zinc-900/50 border border-zinc-700/50 rounded-lg px-3 py-2.5 text-white text-sm font-mono"
                        />
                        <button
                          onClick={handleSelectDataDirectory}
                          disabled={isMigrating}
                          className="px-4 py-2.5 bg-[#007eff] hover:bg-[#006add] text-white rounded-lg text-sm disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap transition-all duration-300"
                        >
                          选择
                        </button>
                        <button
                          onClick={handleResetToDefault}
                          disabled={isMigrating}
                          className="px-4 py-2.5 bg-zinc-700/50 hover:bg-zinc-600/50 text-white rounded-lg text-sm disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap transition-all duration-300"
                        >
                          恢复默认
                        </button>
                      </div>
                      <p className="mt-2 text-xs text-zinc-500">
                        更改后将自动迁移现有数据到新目录
                      </p>
                    </div>
                  </div>
                </div>

                <div>
                  <h4 className="text-xs font-medium text-zinc-400 mb-3 uppercase tracking-wider">显示设置</h4>
                  <div className="bg-zinc-800/30 rounded-xl p-4 border border-zinc-700/30">
                    <Toggle
                      label="显示价格估算"
                      checked={showPriceEstimate}
                      onChange={handleShowPriceChange}
                      className="w-full"
                    />
                    <p className="mt-2 text-xs text-zinc-500">在生成面板显示预估费用</p>
                  </div>
                </div>

                <div>
                  <h4 className="text-xs font-medium text-zinc-400 mb-3 uppercase tracking-wider">下载设置</h4>
                  <div className="bg-zinc-800/30 rounded-xl p-4 border border-zinc-700/30 space-y-5">
                    <div>
                      <Toggle
                        label="启用快速下载"
                        checked={enableQuickDownload}
                        onChange={handleEnableQuickDownloadChange}
                        className="w-full"
                      />
                      <p className="mt-2 text-xs text-zinc-500">开启后下载文件将直接保存到指定目录，无需手动选择</p>
                    </div>

                    <div className={`transition-opacity duration-300 ${!enableQuickDownload ? 'opacity-50 pointer-events-none' : ''}`}>
                      <Toggle
                        label="仅按钮使用快速下载"
                        checked={quickDownloadButtonOnly}
                        onChange={handleQuickDownloadButtonOnlyChange}
                        className="w-full"
                        disabled={!enableQuickDownload}
                      />
                      <p className="mt-2 text-xs text-zinc-500">开启后，只有点击下载按钮时才使用快速下载，右键菜单下载依然手动选择目录</p>
                    </div>

                    <div className={`transition-opacity duration-300 ${!enableQuickDownload ? 'opacity-50 pointer-events-none' : ''}`}>
                      <label className="block text-sm font-medium mb-2 text-zinc-300">快速下载保存路径</label>
                      <div className="flex gap-2">
                        <input
                          type="text"
                          value={quickDownloadPath}
                          onChange={(e) => handleQuickDownloadPathChange(e.target.value)}
                          placeholder="选择保存目录"
                          disabled={!enableQuickDownload}
                          className="flex-1 bg-zinc-900/50 border border-zinc-700/50 rounded-lg px-3 py-2.5 outline-none focus:ring-2 focus:ring-[#007eff]/60 focus:border-[#007eff] transition-all duration-300 text-white placeholder-zinc-500 text-sm disabled:opacity-50"
                        />
                        <button
                          onClick={handleSelectQuickDownloadPath}
                          disabled={!enableQuickDownload}
                          className="px-4 py-2.5 bg-[#007eff] hover:bg-[#006add] text-white rounded-lg transition-all duration-300 font-medium text-sm disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
                        >
                          选择
                        </button>
                      </div>
                      <p className="mt-2 text-xs text-zinc-500">所有快速下载的文件将保存到此目录</p>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'api' && (
              <div className="space-y-5 animate-fade-in">
                <div>
                  <h4 className="text-xs font-medium text-zinc-400 mb-3 uppercase tracking-wider">派欧云</h4>
                  <div className="bg-zinc-800/30 rounded-xl p-4 border border-zinc-700/30">
                    <label className="block text-sm font-medium mb-2 text-zinc-300">API 密钥</label>
                    <div className="relative">
                      <input
                        type={showApiKey ? "text" : "password"}
                        value={apiKey}
                        onChange={(e) => handleApiKeyChange(e.target.value)}
                        placeholder="请输入您的 API 密钥"
                        className="w-full bg-zinc-900/50 border border-zinc-700/50 rounded-lg px-3 py-2.5 outline-none focus:ring-2 focus:ring-[#007eff]/60 focus:border-[#007eff] transition-all duration-300 text-white placeholder-zinc-500 pr-10 text-sm"
                      />
                      <button
                        onClick={() => setShowApiKey(!showApiKey)}
                        className="absolute inset-y-0 right-0 flex items-center pr-3 text-zinc-500 hover:text-zinc-300 transition-colors"
                      >
                        {showApiKey ? (
                          <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
                          </svg>
                        ) : (
                          <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                          </svg>
                        )}
                      </button>
                    </div>
                    <p className="mt-2 text-xs text-zinc-500">
                      打开
                      <button
                        onClick={() => handleOpenLink('https://ppio.com/user/register?invited_by=MLBDS6')}
                        className="text-[#007eff] hover:underline mx-1"
                      >
                        派欧云官网
                      </button>
                      注册并登录，然后在
                      <button
                        onClick={() => handleOpenLink('https://ppio.com/settings/key-management')}
                        className="text-[#007eff] hover:underline mx-1"
                      >
                        密钥管理页面
                      </button>
                      获取密钥
                    </p>
                  </div>
                </div>

                <div>
                  <h4 className="text-xs font-medium text-zinc-400 mb-3 tracking-wider">fal.ai</h4>
                  <div className="bg-zinc-800/30 rounded-xl p-4 border border-zinc-700/30">
                    <label className="block text-sm font-medium mb-2 text-zinc-300">API 密钥</label>
                    <div className="relative">
                      <input
                        type={showFalApiKey ? "text" : "password"}
                        value={falApiKey}
                        onChange={(e) => handleFalApiKeyChange(e.target.value)}
                        placeholder="请输入您的 fal API 密钥"
                        className="w-full bg-zinc-900/50 border border-zinc-700/50 rounded-lg px-3 py-2.5 outline-none focus:ring-2 focus:ring-[#007eff]/60 focus:border-[#007eff] transition-all duration-300 text-white placeholder-zinc-500 pr-10 text-sm"
                      />
                      <button
                        onClick={() => setShowFalApiKey(!showFalApiKey)}
                        className="absolute inset-y-0 right-0 flex items-center pr-3 text-zinc-500 hover:text-zinc-300 transition-colors"
                      >
                        {showFalApiKey ? (
                          <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
                          </svg>
                        ) : (
                          <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                          </svg>
                        )}
                      </button>
                    </div>
                    <p className="mt-2 text-xs text-zinc-500">
                      打开
                      <button
                        onClick={() => handleOpenLink('https://fal.ai/')}
                        className="text-[#007eff] hover:underline mx-1"
                      >
                        fal 官网
                      </button>
                      注册并登录，然后在
                      <button
                        onClick={() => handleOpenLink('https://fal.ai/dashboard/keys')}
                        className="text-[#007eff] hover:underline mx-1"
                      >
                        密钥管理页面
                      </button>
                      获取密钥
                    </p>
                  </div>
                </div>

                <div>
                  <h4 className="text-xs font-medium text-zinc-400 mb-3 tracking-wider">魔搭 ModelScope</h4>
                  <div className="bg-zinc-800/30 rounded-xl p-4 border border-zinc-700/30">
                    <label className="block text-sm font-medium mb-2 text-zinc-300">API 密钥</label>
                    <div className="relative">
                      <input
                        type={showModelscopeApiKey ? "text" : "password"}
                        value={modelscopeApiKey}
                        onChange={(e) => handleModelscopeApiKeyChange(e.target.value)}
                        placeholder="请输入您的魔搭 API 密钥"
                        className="w-full bg-zinc-900/50 border border-zinc-700/50 rounded-lg px-3 py-2.5 outline-none focus:ring-2 focus:ring-[#007eff]/60 focus:border-[#007eff] transition-all duration-300 text-white placeholder-zinc-500 pr-10 text-sm"
                      />
                      <button
                        onClick={() => setShowModelscopeApiKey(!showModelscopeApiKey)}
                        className="absolute inset-y-0 right-0 flex items-center pr-3 text-zinc-500 hover:text-zinc-300 transition-colors"
                      >
                        {showModelscopeApiKey ? (
                          <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
                          </svg>
                        ) : (
                          <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                          </svg>
                        )}
                      </button>
                    </div>
                    <p className="mt-2 text-xs text-zinc-500">
                      打开
                      <button
                        onClick={() => handleOpenLink('https://www.modelscope.cn/')}
                        className="text-[#007eff] hover:underline mx-1"
                      >
                        魔搭官网
                      </button>
                      注册并登录，然后查阅
                      <button
                        onClick={() => handleOpenLink('https://modelscope.cn/docs/model-service/API-Inference/limits')}
                        className="text-[#007eff] hover:underline mx-1"
                      >
                        相关说明
                      </button>
                      了解详情，最后打开
                      <button
                        onClick={() => handleOpenLink('https://modelscope.cn/my/myaccesstoken')}
                        className="text-[#007eff] hover:underline mx-1"
                      >
                        访问令牌页面
                      </button>
                      来获取访问令牌
                    </p>
                  </div>
                </div>

                <div>
                  <h4 className="text-xs font-medium text-zinc-400 mb-3 tracking-wider">KIE</h4>
                  <div className="bg-zinc-800/30 rounded-xl p-4 border border-zinc-700/30">
                    <label className="block text-sm font-medium mb-2 text-zinc-300">API 密钥</label>
                    <div className="relative">
                      <input
                        type={showKieApiKey ? "text" : "password"}
                        value={kieApiKey}
                        onChange={(e) => handleKieApiKeyChange(e.target.value)}
                        placeholder="请输入您的 KIE API 密钥"
                        className="w-full bg-zinc-900/50 border border-zinc-700/50 rounded-lg px-3 py-2.5 outline-none focus:ring-2 focus:ring-[#007eff]/60 focus:border-[#007eff] transition-all duration-300 text-white placeholder-zinc-500 pr-10 text-sm"
                      />
                      <button
                        onClick={() => setShowKieApiKey(!showKieApiKey)}
                        className="absolute inset-y-0 right-0 flex items-center pr-3 text-zinc-500 hover:text-zinc-300 transition-colors"
                      >
                        {showKieApiKey ? (
                          <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
                          </svg>
                        ) : (
                          <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                          </svg>
                        )}
                      </button>
                    </div>
                    <p className="mt-2 text-xs text-zinc-500">
                      打开
                      <button
                        onClick={() => handleOpenLink('https://kie.ai/zh-CN')}
                        className="text-[#007eff] hover:underline mx-1"
                      >
                        KIE 官网
                      </button>
                      注册并登录，然后在
                      <button
                        onClick={() => handleOpenLink('https://kie.ai/zh-CN/api-key')}
                        className="text-[#007eff] hover:underline mx-1"
                      >
                        密钥管理页面
                      </button>
                      获取密钥
                    </p>
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'interface' && (
              <div className="space-y-5 animate-fade-in">
                <div>
                  <h4 className="text-xs font-medium text-zinc-400 mb-3 uppercase tracking-wider">底部面板</h4>
                  <div className="bg-zinc-800/30 rounded-xl p-4 border border-zinc-700/30 space-y-5">
                    <div>
                      <Toggle
                        label="智能折叠"
                        checked={enableAutoCollapse}
                        onChange={handleAutoCollapseChange}
                        className="w-full"
                      />
                      <p className="mt-2 text-xs text-zinc-500">浏览历史记录时自动折叠底部面板，节省显示空间</p>
                    </div>

                    <div className={`transition-opacity duration-300 ${!enableAutoCollapse ? 'opacity-50 pointer-events-none' : ''}`}>
                      <NumberInput
                        label="折叠延迟 (ms)"
                        value={collapseDelay}
                        onChange={handleCollapseDelayChange}
                        min={100}
                        max={3000}
                        step={100}
                        widthClassName="w-full"
                        disabled={!enableAutoCollapse}
                      />
                      <p className="mt-2 text-xs text-zinc-500">鼠标离开面板后等待多久自动折叠</p>
                    </div>

                    <div className={`transition-opacity duration-300 ${!enableAutoCollapse ? 'opacity-50 pointer-events-none' : ''}`}>
                      <Toggle
                        label="仅滚动时折叠"
                        checked={collapseOnScrollOnly}
                        onChange={handleCollapseOnScrollOnlyChange}
                        className="w-full"
                        disabled={!enableAutoCollapse}
                      />
                      <p className="mt-2 text-xs text-zinc-500">开启后，只在浏览历史记录时折叠面板，鼠标移出时不会折叠</p>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="p-4 border-t border-zinc-700/50 bg-zinc-900/20 flex justify-end">
            <button
              onClick={handleClose}
              className="px-6 py-2 bg-[#007eff] hover:bg-[#006add] text-white shadow-lg shadow-blue-500/20 hover:shadow-blue-500/30 rounded-lg transition-all duration-300 font-medium text-sm"
            >
              确定
            </button>
          </div>
        </div>
      </div>

      {/* 通用提示弹窗 */}
      {showAlertDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" data-dialog="true">
          <div
            className="absolute inset-0 bg-black/70 backdrop-blur-sm"
            style={{ opacity: dialogOpacity, transition: 'opacity 180ms ease' }}
            onClick={() => closeDialog(setShowAlertDialog)}
          />
          <div
            className="relative bg-[#131313]/80 border border-zinc-700/50 rounded-xl p-4 w-[400px] shadow-2xl"
            style={{ opacity: dialogOpacity, transform: `scale(${0.97 + 0.03 * dialogOpacity})`, transition: 'opacity 180ms ease, transform 180ms ease' }}
          >
            <div className="text-white text-base">{alertType === 'success' ? '操作成功' : alertType === 'error' ? '操作失败' : '提示'}</div>
            <div className="text-zinc-300 text-sm mt-2">{alertMessage}</div>
            <div className="mt-4 flex justify-end">
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); closeDialog(setShowAlertDialog); }}
                className={`h-9 px-3 inline-flex items-center justify-center rounded-md text-white text-sm transition-colors ${
                  alertType === 'success' ? 'bg-green-600/70 hover:bg-green-600' :
                  alertType === 'error' ? 'bg-red-600/70 hover:bg-red-600' :
                  'bg-yellow-600/70 hover:bg-yellow-600'
                }`}
              >
                确定
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 确认恢复默认弹窗 */}
      {showConfirmResetDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" data-dialog="true">
          <div
            className="absolute inset-0 bg-black/70 backdrop-blur-sm"
            style={{ opacity: dialogOpacity, transition: 'opacity 180ms ease' }}
            onClick={() => closeDialog(setShowConfirmResetDialog)}
          />
          <div
            className="relative bg-[#131313]/80 border border-zinc-700/50 rounded-xl p-4 w-[400px] shadow-2xl"
            style={{ opacity: dialogOpacity, transform: `scale(${0.97 + 0.03 * dialogOpacity})`, transition: 'opacity 180ms ease, transform 180ms ease' }}
          >
            <div className="text-white text-base">恢复默认数据目录</div>
            <div className="text-zinc-300 text-sm mt-2">确定要恢复到默认数据目录吗？现有数据将被迁移回默认位置。</div>
            <div className="mt-4 flex gap-2 justify-end">
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); closeDialog(setShowConfirmResetDialog); }}
                className="h-9 px-3 inline-flex items-center justify-center rounded-md bg-zinc-700/50 hover:bg-zinc-600/50 text-white text-sm transition-colors"
              >
                取消
              </button>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); confirmResetToDefault(); }}
                className="h-9 px-3 inline-flex items-center justify-center rounded-md bg-[#007eff]/70 hover:bg-[#007eff] text-white text-sm transition-colors"
              >
                确定
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 冲突处理对话框 */}
      {showConflictDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" data-dialog="true">
          <div
            className="absolute inset-0 bg-black/70 backdrop-blur-sm"
            style={{ opacity: dialogOpacity, transition: 'opacity 180ms ease' }}
            onClick={() => closeDialog(setShowConflictDialog)}
          />
          <div
            className="relative bg-[#131313]/80 border border-zinc-700/50 rounded-xl p-4 w-[400px] shadow-2xl"
            style={{ opacity: dialogOpacity, transform: `scale(${0.97 + 0.03 * dialogOpacity})`, transition: 'opacity 180ms ease, transform 180ms ease' }}
          >
            <div className="text-white text-base">目录冲突</div>
            <div className="text-zinc-300 text-sm mt-2">所选目录中已存在 Henji-AI 数据，请选择处理方式：</div>
            <div className="mt-4 flex flex-col gap-2">
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); handleConflictResolution('merge'); }}
                className="h-9 px-3 inline-flex items-center justify-center rounded-md bg-[#007eff]/70 hover:bg-[#007eff] text-white text-sm transition-colors"
              >
                合并数据
              </button>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); handleConflictResolution('overwrite'); }}
                className="h-9 px-3 inline-flex items-center justify-center rounded-md bg-orange-600/70 hover:bg-orange-600 text-white text-sm transition-colors"
              >
                覆盖数据
              </button>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); handleConflictResolution('cancel'); }}
                className="h-9 px-3 inline-flex items-center justify-center rounded-md bg-zinc-700/50 hover:bg-zinc-600/50 text-white text-sm transition-colors"
              >
                取消
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 迁移进度对话框 */}
      {showMigrationDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" data-dialog="true">
          <div
            className="absolute inset-0 bg-black/70 backdrop-blur-sm"
            style={{ opacity: dialogOpacity, transition: 'opacity 180ms ease' }}
          />
          <div
            className="relative bg-[#131313]/80 border border-zinc-700/50 rounded-xl p-4 w-[400px] shadow-2xl"
            style={{ opacity: dialogOpacity, transform: `scale(${0.97 + 0.03 * dialogOpacity})`, transition: 'opacity 180ms ease, transform 180ms ease' }}
          >
            <div className="text-white text-base">正在迁移数据...</div>
            <div className="mt-4">
              <div className="text-sm text-zinc-300 mb-2 truncate">
                {migrationProgress.file}
              </div>
              <div className="text-xs text-zinc-400 mb-2">
                {migrationProgress.current} / {migrationProgress.total}
              </div>
              <div className="w-full bg-zinc-800 rounded-full h-2">
                <div
                  className="bg-[#007eff] h-2 rounded-full transition-all duration-300"
                  style={{ width: `${migrationProgress.total > 0 ? (migrationProgress.current / migrationProgress.total) * 100 : 0}%` }}
                />
              </div>
            </div>
            <div className="text-xs text-zinc-400 mt-4">请勿关闭应用</div>
          </div>
        </div>
      )}
    </div>
  )
}

export default SettingsModal
