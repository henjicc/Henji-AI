import { createLogger } from '@/core/logging'

const logger = createLogger('components.params.upload.ImageUpload')
/**
 * ImageUpload 组件
 *
 * 图片上传组件，支持拖拽、预览、编辑和智能匹配
 */

import React from 'react'
import { useTranslation } from 'react-i18next'
import type { ImageUploadParamDef } from '@/core/types'
import { UploadArea } from './UploadArea'
import { FilePreview } from './FilePreview'
import { fileToBase64 } from '@/utils/fileConverter'
import { calculateAspectRatio } from '@/utils/smartMatch'
import { getI18nText } from '@/core/types/I18nText'

interface ImageUploadProps {
  param: ImageUploadParamDef
  value: string[]
  onChange: (value: string[]) => void
  onSmartMatch?: (metadata: ImageMetadata) => void
  disabled?: boolean
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
  disabled = false
}) => {
  const { i18n, t } = useTranslation('ui')
  // const [editingIndex, setEditingIndex] = useState<number | null>(null)

  // 获取显示名称
  const displayName = getI18nText(param.name, i18n.language)

  // 处理上传
  const handleUpload = async (file: File) => {
    const maxCount = param.maxCount || 1
    if (value.length >= maxCount) {
      alert(t('uploadArea.maxImages', { max: maxCount }))
      return
    }

    // 读取图片元数据
    const img = await loadImage(file)
    const aspectRatio = calculateAspectRatio(img.width, img.height)

    // 转换格式
    let imageData: string
    if (param.format === 'base64') {
      const base64 = await fileToBase64(file)
      imageData = param.base64Prefix ? base64 : base64.split(',')[1]
    } else {
      // URL 格式：创建 Object URL
      imageData = URL.createObjectURL(file)
    }

    onChange([...value, imageData])

    // 触发智能匹配
    if (onSmartMatch) {
      onSmartMatch({
        aspectRatio,
        width: img.width,
        height: img.height
      })
    }
  }

  // 处理删除
  const handleDelete = (index: number) => {
    const newValue = value.filter((_, i) => i !== index)
    onChange(newValue)
  }

  // 处理编辑
  const handleEdit = (index: number) => {
    // setEditingIndex(index)
    // TODO: 集成 ImageEditor
    logger.info('Edit image at index:', index)
  }

  return (
    <div className="image-upload-wrapper">
      <label className="param-label">
        {displayName}
        {param.required && <span className="required-mark">*</span>}
      </label>

      <div className="upload-container">
        {value.map((url, index) => {
          const displayUrl = param.format === 'base64' && !param.base64Prefix
            ? `data:image/png;base64,${url}`

            : url

          return (
            <FilePreview
              key={index}
              type="image"
              url={displayUrl}
              onDelete={() => handleDelete(index)}
              onEdit={() => handleEdit(index)}
            />
          )
        })}

        {value.length < (param.maxCount || 1) && (
          <UploadArea
            accept={['image/png', 'image/jpeg', 'image/webp', 'image/jpg']}
            maxSize={10}
            onUpload={handleUpload}
            disabled={disabled}
          />
        )}
      </div>

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
