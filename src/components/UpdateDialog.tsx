/**
 * 更新提示对话框组件
 * 当检测到新版本时显示，提供更新、忽略或取消选项
 */

import React, { useState, useEffect } from 'react'
import { open } from '@tauri-apps/plugin-shell'
import { ReleaseInfo, formatReleaseDate } from '../services/updateChecker'
import { addIgnoredVersion } from '../utils/updateConfig'
import { logError } from '../utils/errorLogger'

interface UpdateDialogProps {
  releaseInfo: ReleaseInfo
  currentVersion: string
  onClose: () => void
}

const UpdateDialog: React.FC<UpdateDialogProps> = ({ releaseInfo, currentVersion, onClose }) => {
  const [dialogOpacity, setDialogOpacity] = useState(0)

  useEffect(() => {
    requestAnimationFrame(() => setDialogOpacity(1))
  }, [])

  const handleClose = () => {
    setDialogOpacity(0)
    setTimeout(() => {
      onClose()
    }, 180)
  }

  const handleUpdate = async () => {
    try {
      // 打开 GitHub Release 页面
      await open(releaseInfo.htmlUrl)
      handleClose()
    } catch (error) {
      logError('打开更新页面失败:', error)
    }
  }

  const handleIgnore = () => {
    // 将此版本添加到忽略列表
    addIgnoredVersion(releaseInfo.version)
    handleClose()
  }

  // 解析更新说明（Markdown 格式）
  const renderReleaseNotes = () => {
    if (!releaseInfo.body) {
      return <p className="text-zinc-400 text-sm">暂无更新说明</p>
    }

    // 简单的 Markdown 解析（支持标题、列表、粗体）
    const lines = releaseInfo.body.split('\n')
    return (
      <div className="space-y-2 text-sm">
        {lines.map((line, index) => {
          // 标题
          if (line.startsWith('### ')) {
            return (
              <h4 key={index} className="text-white font-semibold mt-3 mb-1">
                {line.replace('### ', '')}
              </h4>
            )
          }
          if (line.startsWith('## ')) {
            return (
              <h3 key={index} className="text-white font-bold text-base mt-4 mb-2">
                {line.replace('## ', '')}
              </h3>
            )
          }
          // 列表项
          if (line.startsWith('- ') || line.startsWith('* ')) {
            return (
              <div key={index} className="flex items-start gap-2 text-zinc-300 ml-2">
                <span className="text-[#007eff] mt-1">•</span>
                <span>{line.replace(/^[-*] /, '')}</span>
              </div>
            )
          }
          // 空行
          if (line.trim() === '') {
            return <div key={index} className="h-1" />
          }
          // 普通文本
          return (
            <p key={index} className="text-zinc-300">
              {line}
            </p>
          )
        })}
      </div>
    )
  }

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4"
      data-dialog="true"
    >
      {/* 背景遮罩 */}
      <div
        className="absolute inset-0 bg-black/80 backdrop-blur-sm"
        style={{
          opacity: dialogOpacity,
          transition: 'opacity 180ms ease'
        }}
        onClick={handleClose}
      />

      {/* 对话框内容 */}
      <div
        className="relative bg-[#131313]/95 backdrop-blur-xl border border-zinc-700/50 rounded-2xl w-full max-w-2xl shadow-2xl overflow-hidden"
        style={{
          opacity: dialogOpacity,
          transform: `scale(${0.97 + 0.03 * dialogOpacity})`,
          transition: 'opacity 180ms ease, transform 180ms ease'
        }}
      >
        {/* 头部 */}
        <div className="bg-gradient-to-r from-[#007eff]/10 to-transparent p-6 border-b border-zinc-700/50">
          <div className="flex items-start justify-between">
            <div className="flex-1">
              <div className="flex items-center gap-3 mb-2">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  className="h-8 w-8 text-[#007eff]"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
                  />
                </svg>
                <div>
                  <h2 className="text-xl font-bold text-white">发现新版本</h2>
                  <p className="text-sm text-zinc-400 mt-1">
                    {releaseInfo.name || `版本 ${releaseInfo.version}`}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-4 text-xs text-zinc-500 mt-3">
                <span className="flex items-center gap-1">
                  <span className="text-zinc-400">当前版本:</span>
                  <span className="font-mono text-zinc-300">{currentVersion}</span>
                </span>
                <span className="text-zinc-600">→</span>
                <span className="flex items-center gap-1">
                  <span className="text-zinc-400">最新版本:</span>
                  <span className="font-mono text-[#007eff]">{releaseInfo.version}</span>
                </span>
                <span className="text-zinc-600">•</span>
                <span>{formatReleaseDate(releaseInfo.publishedAt)}</span>
              </div>
            </div>
            <button
              onClick={handleClose}
              className="text-zinc-400 hover:text-white transition-colors p-1 rounded-full hover:bg-zinc-800/50"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="h-5 w-5"
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
        </div>

        {/* 更新说明 */}
        <div className="p-6 max-h-[400px] overflow-y-auto custom-scrollbar">
          <h3 className="text-sm font-semibold text-zinc-400 uppercase tracking-wider mb-3">
            更新内容
          </h3>
          {renderReleaseNotes()}
        </div>

        {/* 底部按钮 */}
        <div className="p-6 border-t border-zinc-700/50 bg-zinc-900/20 flex items-center justify-end gap-3">
          <button
            onClick={handleIgnore}
            className="px-5 py-2.5 bg-zinc-700/50 hover:bg-zinc-600/50 text-white rounded-lg transition-all duration-300 text-sm font-medium"
          >
            跳过此版本
          </button>
          <button
            onClick={handleClose}
            className="px-5 py-2.5 bg-zinc-700/50 hover:bg-zinc-600/50 text-white rounded-lg transition-all duration-300 text-sm font-medium"
          >
            稍后提醒
          </button>
          <button
            onClick={handleUpdate}
            className="px-5 py-2.5 bg-[#007eff] hover:bg-[#006add] text-white rounded-lg transition-all duration-300 text-sm font-medium shadow-lg shadow-blue-500/20 hover:shadow-blue-500/30"
          >
            立即更新
          </button>
        </div>
      </div>

      <style>{`
        .custom-scrollbar::-webkit-scrollbar {
          width: 8px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: rgba(39, 39, 42, 0.3);
          border-radius: 4px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: rgba(113, 113, 122, 0.5);
          border-radius: 4px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: rgba(113, 113, 122, 0.7);
        }
      `}</style>
    </div>
  )
}

export default UpdateDialog
