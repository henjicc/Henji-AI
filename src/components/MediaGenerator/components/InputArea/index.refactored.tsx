import React from 'react'
import FileUploader from '@/components/ui/FileUploader'
import AlertDialog from '@/components/ui/AlertDialog'
import { useMixedFileUpload, FileOrderItem } from './hooks/useMixedFileUpload'
import { useModelConfig } from './hooks/useModelConfig'
import { useGenerateButton } from './hooks/useGenerateButton'
import { useAlertDialog } from './hooks/useAlertDialog'

interface InputAreaProps {
  input: string
  setInput: (value: string) => void
  currentModel: any
  selectedModel: string
  uploadedImages: string[]
  isLoading: boolean
  isGenerating?: boolean

  // 模式参数
  viduMode?: string
  veoMode?: string
  klingMode?: string
  mode?: string
  seedanceMode?: string
  viduQ2Mode?: string
  hailuo02FastMode?: boolean
  kieSeedanceV3Version?: string
  ppioKlingO1Mode?: string
  ppioKling26Mode?: string
  kieKlingV26Mode?: string
  falKlingV26ProMode?: string
  ppioWan26Mode?: string
  modelscopeCustomModel?: string

  // 图片处理回调
  onImageUpload: (files: File[]) => void
  onImageRemove: (index: number) => void
  onImageReplace: (index: number, file: File) => void
  onImageReorder: (from: number, to: number) => void
  onImageClick?: (imageUrl: string, imageList: string[]) => void
  onPaste: (e: React.ClipboardEvent) => void
  onImageDrop: (files: File[]) => void
  onDragStateChange: (isDragging: boolean) => void

  // 视频处理回调
  uploadedVideos?: string[]
  onVideoUpload?: (files: File[]) => void
  onVideoRemove?: (index: number) => void
  onVideoReplace?: (index: number, file: File) => void
  onVideoClick?: (videoUrl: string) => void

  // 混合文件顺序
  fileOrder?: FileOrderItem[]
  onFileOrderChange?: (order: FileOrderItem[]) => void

  // 生成回调
  onGenerate: () => void
}

/**
 * 输入区域组件（重构版）
 * 使用自定义 Hooks 管理状态和逻辑
 */
const InputAreaRefactored: React.FC<InputAreaProps> = ({
  input,
  setInput,
  currentModel,
  selectedModel,
  uploadedImages,
  isLoading,
  isGenerating,
  viduMode,
  veoMode,
  klingMode,
  mode,
  seedanceMode,
  viduQ2Mode,
  hailuo02FastMode,
  kieSeedanceV3Version,
  ppioKlingO1Mode,
  ppioKling26Mode,
  kieKlingV26Mode,
  falKlingV26ProMode,
  ppioWan26Mode,
  modelscopeCustomModel,
  onImageUpload,
  onImageRemove,
  onImageReplace,
  onImageReorder,
  onImageClick,
  onPaste,
  onImageDrop,
  onDragStateChange,
  uploadedVideos = [],
  onVideoUpload,
  onVideoRemove,
  onVideoReplace,
  onVideoClick,
  fileOrder,
  onFileOrderChange,
  onGenerate
}) => {
  // Alert 对话框
  const { alertDialog, showAlert, closeAlert } = useAlertDialog()

  // 模型配置
  const {
    maxImageCount,
    isMultiple,
    isQwenImageEdit,
    shouldShowImageUpload,
    placeholder,
    textareaHeight
  } = useModelConfig({
    selectedModel,
    currentModel,
    viduMode,
    veoMode,
    klingMode,
    mode,
    seedanceMode,
    viduQ2Mode,
    hailuo02FastMode,
    kieSeedanceV3Version,
    ppioKlingO1Mode,
    ppioKling26Mode,
    kieKlingV26Mode,
    falKlingV26ProMode,
    ppioWan26Mode,
    modelscopeCustomModel
  })

  // 混合文件上传
  const {
    needsVideoUpload,
    needsVideoOnly,
    isMotionControlMode,
    currentFileOrder,
    mixedFiles,
    mixedMaxCount,
    shouldHideUploadButton,
    handleMixedFileUpload,
    handleMixedFileRemove,
    handleMixedFileReplace,
    handleMixedFileReorder
  } = useMixedFileUpload({
    uploadedImages,
    uploadedVideos,
    selectedModel,
    maxImageCount,
    klingMode,
    ppioKlingO1Mode,
    ppioKling26Mode,
    kieKlingV26Mode,
    falKlingV26ProMode,
    mode,
    viduQ2Mode,
    ppioWan26Mode,
    onImageUpload,
    onVideoUpload,
    onImageRemove,
    onVideoRemove,
    onImageReplace,
    onVideoReplace,
    onImageReorder,
    fileOrder,
    onFileOrderChange,
    onAlert: showAlert
  })

  // 生成按钮
  const {
    isGenerateDisabled,
    buttonTitle,
    buttonClassName
  } = useGenerateButton({
    input,
    uploadedImages,
    isLoading,
    isGenerating,
    currentModel,
    selectedModel,
    isQwenImageEdit
  })

  // 处理混合文件点击
  const handleMixedFileClick = (fileUrl: string, fileList: string[]) => {
    const index = fileList.indexOf(fileUrl)
    if (index === -1) return

    if (!needsVideoUpload || currentFileOrder.length === 0) {
      if (onImageClick) {
        onImageClick(fileUrl, fileList)
      }
      return
    }

    const item = currentFileOrder[index]
    if (!item) return

    if (item.type === 'video' && onVideoClick) {
      onVideoClick(fileUrl)
    } else if (item.type === 'image' && onImageClick) {
      const allImages = currentFileOrder
        .filter(f => f.type === 'image')
        .map(f => uploadedImages[f.index])
      onImageClick(fileUrl, allImages)
    }
  }

  // 处理键盘事件
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      if (e.ctrlKey) {
        // Ctrl+Enter 换行
        return
      } else {
        // Enter 生成
        e.preventDefault()
        onGenerate()
      }
    }
  }

  // 处理拖放
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    const files = Array.from(e.dataTransfer.files).filter(file => file.type.startsWith('image/'))
    if (files.length > 0) {
      onImageDrop(files)
    }
  }

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
  }

  return (
    <div className="relative bg-[#131313]/70 rounded-xl border border-zinc-700/50 p-4">
      {/* 文件上传区域 */}
      {shouldShowImageUpload && (
        <div className="mb-3">
          {needsVideoUpload && (
            <div className="text-xs text-zinc-400 mb-2">
              {needsVideoOnly
                ? '上传视频（仅支持1个视频）'
                : isMotionControlMode
                  ? '上传1个视频 + 1张图片（不能多也不能少）'
                  : `上传视频和图片（视频1个 + 图片最多${maxImageCount}张）`}
            </div>
          )}
          <FileUploader
            files={mixedFiles}
            onUpload={needsVideoUpload ? handleMixedFileUpload : onImageUpload}
            onRemove={needsVideoUpload ? handleMixedFileRemove : onImageRemove}
            onReplace={needsVideoUpload ? handleMixedFileReplace : onImageReplace}
            onReorder={needsVideoUpload ? handleMixedFileReorder : onImageReorder}
            onImageClick={needsVideoUpload ? handleMixedFileClick : onImageClick}
            accept={needsVideoOnly ? "video/*" : (needsVideoUpload ? "video/*,image/*" : "image/*")}
            multiple={needsVideoOnly ? false : (needsVideoUpload ? true : isMultiple)}
            maxCount={mixedMaxCount}
            hideUploadButton={shouldHideUploadButton}
            fileTypes={needsVideoUpload && currentFileOrder.length > 0
              ? currentFileOrder.map(item => item.type)
              : undefined}
            {...{ onDragStateChange } as any}
          />
        </div>
      )}

      {/* 文本输入框 */}
      <div className="relative">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onPaste={onPaste}
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          className={`w-full bg-transparent backdrop-blur-lg rounded-xl p-4 pr-14 ${textareaHeight} resize-none focus:outline-none focus:ring-2 focus:ring-white/20 transition-shadow duration-300 ease-in-out text-white placeholder-zinc-400`}
          disabled={isLoading}
        />

        {/* 生成按钮 */}
        <button
          onClick={onGenerate}
          disabled={isGenerateDisabled}
          title={buttonTitle}
          className={buttonClassName}
        >
          {isLoading ? (
            <svg className="animate-spin h-5 w-5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
          ) : isGenerating ? (
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
          ) : (
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 10l7-7m0 0l7 7m-7-7v18" />
            </svg>
          )}
        </button>
      </div>

      {/* Alert Dialog */}
      <AlertDialog
        isOpen={alertDialog.isOpen}
        title={alertDialog.title}
        message={alertDialog.message}
        type={alertDialog.type}
        onClose={closeAlert}
      />
    </div>
  )
}

export default InputAreaRefactored
