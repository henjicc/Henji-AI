import React from 'react'
import FileUploader from '@/components/ui/FileUploader'
import { getMaxImageCount } from '../utils/constants'

interface InputAreaProps {
  input: string
  setInput: (value: string) => void
  currentModel: any
  selectedModel: string
  uploadedImages: string[]
  isLoading: boolean
  isGenerating?: boolean

  // Vidu/Veo 模式（用于计算最大图片数）
  viduMode?: string
  veoMode?: string

  // 图片处理回调
  onImageUpload: (files: File[]) => void
  onImageRemove: (index: number) => void
  onImageReplace: (index: number, file: File) => void
  onImageReorder: (from: number, to: number) => void
  onImageClick?: (imageUrl: string, imageList: string[]) => void
  onPaste: (e: React.ClipboardEvent) => void
  onImageDrop: (files: File[]) => void
  onDragStateChange: (isDragging: boolean) => void

  // 生成回调
  onGenerate: () => void
}

/**
 * 输入区域组件
 * 包含图片上传和文本输入
 */
const InputArea: React.FC<InputAreaProps> = ({
  input,
  setInput,
  currentModel,
  selectedModel,
  uploadedImages,
  isLoading,
  isGenerating,
  viduMode,
  veoMode,
  onImageUpload,
  onImageRemove,
  onImageReplace,
  onImageReorder,
  onImageClick,
  onPaste,
  onImageDrop,
  onDragStateChange,
  onGenerate
}) => {
  // 计算最大图片数
  const maxImageCount = getMaxImageCount(
    selectedModel,
    selectedModel === 'vidu-q1' ? viduMode : selectedModel === 'veo3.1' ? veoMode : undefined
  )

  // 是否允许多选
  const isMultiple =
    (selectedModel === 'vidu-q1' && viduMode === 'reference-to-video') ||
    selectedModel === 'minimax-hailuo-02' ||
    (selectedModel === 'veo3.1' && veoMode === 'reference-to-video') ||
    (selectedModel !== 'kling-2.5-turbo' &&
     selectedModel !== 'minimax-hailuo-2.3' &&
     selectedModel !== 'wan-2.5-preview')

  return (
    <div className="relative bg-[#131313]/70 rounded-xl border border-zinc-700/50 p-4">
      {/* 图片上传和预览区域 */}
      {currentModel?.type !== 'audio' && (
        <div className="mb-3">
          <FileUploader
            files={uploadedImages}
            onUpload={onImageUpload}
            onRemove={onImageRemove}
            onReplace={onImageReplace}
            onReorder={onImageReorder}
            onImageClick={onImageClick}
            accept="image/*"
            multiple={isMultiple}
            maxCount={maxImageCount}
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
          onDrop={(e) => {
            e.preventDefault()
            e.stopPropagation()
            const files = Array.from(e.dataTransfer.files).filter(file => file.type.startsWith('image/'))
            if (files.length > 0) {
              onImageDrop(files)
            }
          }}
          onDragOver={(e) => {
            e.preventDefault()
            e.stopPropagation()
          }}
          onKeyDown={(e) => {
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
          }}
          placeholder={currentModel?.type === 'audio' ? '输入要合成的文本' : '描述想要生成的内容'}
          className={`w-full bg-transparent backdrop-blur-lg rounded-xl p-4 pr-14 ${currentModel?.type === 'audio' ? 'min-h-[140px]' : 'min-h-[100px]'} resize-none focus:outline-none focus:ring-2 focus:ring-white/20 transition-shadow duration-300 ease-in-out text-white placeholder-zinc-400`}
          disabled={isLoading}
        />

        {/* 生成按钮 */}
        <button
          onClick={onGenerate}
          disabled={isLoading || (!input.trim() && (currentModel?.type !== 'audio' && uploadedImages.length === 0))}
          title={isGenerating ? '加入队列' : '开始生成'}
          className={`absolute bottom-3 right-3 w-10 h-10 rounded-full flex items-center justify-center transition-all duration-300 ${
            isLoading || (!input.trim() && uploadedImages.length === 0)
              ? 'bg-zinc-700/50 text-zinc-500 cursor-not-allowed'
              : isGenerating
                ? 'bg-[#007eff] hover:brightness-110 text-white shadow-lg hover:shadow-xl transform hover:scale-105'
                : 'bg-[#007eff] hover:brightness-110 text-white shadow-lg hover:shadow-xl transform hover:scale-105'
          }`}
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
    </div>
  )
}

export default InputArea
