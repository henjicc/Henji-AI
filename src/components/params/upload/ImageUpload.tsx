/**
 * ImageUpload 组件
 *
 * 图片上传组件。这里只负责把文件安全导入本地并写回参数；
 * 供应商 CDN 上传统一由 Electron 生成运行时在提交请求前完成。
 */

import React from 'react'
import { useTranslation } from 'react-i18next'
import type { ImageUploadParamDef } from '@/core/types'
import FileUploader from '@/components/ui/FileUploader'
import { fileToBase64 } from '@/utils/fileConverter'
import { calculateAspectRatio } from '@/utils/smartMatch'
import { getI18nText } from '@/core/types/I18nText'
import { useNotification } from '@/contexts/NotificationContext'
import { importLocalMedia } from '@/services/localMediaImport'
import { resolveImageDisplayUrl } from '@/services/imageSource'
import { isUiInspectionReadOnly } from '@/platform/runtime'

interface ImageUploadProps {
  param: ImageUploadParamDef
  value: DynamicValue
  onChange: (value: string[]) => void
  onSmartMatch?: (metadata: ImageMetadata) => void
  disabled?: boolean
  showLabel?: boolean
}

interface ImageMetadata {
  width: number
  height: number
  aspectRatio: string
}

export const ImageUpload: React.FC<ImageUploadProps> = ({
  param,
  value,
  onChange,
  onSmartMatch,
  disabled = false,
  showLabel = true,
}) => {
  const { i18n, t } = useTranslation('ui')
  const { showNotification } = useNotification()
  const safeValue = Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : (typeof value === 'string' && value.trim() ? [value.trim()] : [])

  // 获取显示名称
  const displayName = getI18nText(param.name, i18n.language)

  // 处理上传
  const handleUpload = async (files: File[]) => {
    const maxCount = param.maxCount || 1
    if (safeValue.length >= maxCount) {
      showNotification(t('uploadArea.maxImages', { max: maxCount }), 'error')
      return
    }
    const acceptedTypes = param.accept ?? ['image/png', 'image/jpeg', 'image/webp', 'image/gif']
    const maxSize = param.maxSize ?? 20 * 1024 * 1024
    const nextValues = [...safeValue]
    for (const file of files.slice(0, maxCount - safeValue.length)) {
      if (!acceptedTypes.includes(file.type)) {
        showNotification(t('uploadArea.unsupportedType', { type: file.type }), 'error')
        continue
      }
      if (file.size > maxSize) {
        showNotification(t('uploadArea.tooLarge', { maxSize: Math.round(maxSize / 1024 / 1024) }), 'error')
        continue
      }

      let imageData: string
      let metadata: ImageMetadata
      if (param.format === 'base64' || isUiInspectionReadOnly()) {
        const img = await loadImage(file)
        const base64 = await fileToBase64(file)
        // 真实资料只读巡检不能把测试图片导入用户媒体目录；保留 data URL 仅用于本次内存态视觉检查。
        imageData = isUiInspectionReadOnly()
          ? base64
          : (param.base64Prefix ? base64 : base64.split(',')[1])
        metadata = {
          aspectRatio: calculateAspectRatio(img.width, img.height),
          width: img.width,
          height: img.height,
        }
      } else {
        const imported = await importLocalMedia(file, 'image')
        if (imported.kind !== 'image') continue
        imageData = imported.fullPath
        const [width = 1, height = 1] = imported.aspectRatio.split(':').map(Number)
        metadata = { aspectRatio: imported.aspectRatio, width, height }
      }

      nextValues.push(imageData)
      onSmartMatch?.(metadata)
    }
    onChange(nextValues)
  }

  // 处理删除
  const handleDelete = (index: number) => {
    const newValue = safeValue.filter((_, i) => i !== index)
    onChange(newValue)
  }

  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      {showLabel && (
        <label className="param-label">
          {displayName}
          {param.required && <span className="required-mark">*</span>}
        </label>
      )}

      <FileUploader
        density="compact"
        files={safeValue.map((source) => param.format === 'base64' && !param.base64Prefix
          ? `data:image/png;base64,${source}`
          : resolveImageDisplayUrl(source))}
        accept={(param.accept ?? ['image/png', 'image/jpeg', 'image/webp', 'image/gif']).join(',')}
        maxCount={param.maxCount ?? 1}
        multiple={(param.maxCount ?? 1) > 1}
        disabled={disabled}
        onUpload={handleUpload}
        onRemove={handleDelete}
      />

      {param.description && (
        <div className="param-description">{getI18nText(param.description, i18n.language)}</div>
      )}
    </div>
  )
}

// 辅助函数：加载图片并获取元数据
function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(img.src)
      resolve(img)
    }
    img.onerror = reject
    img.src = URL.createObjectURL(file)
  })
}
