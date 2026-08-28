import { FileText, Upload, X } from 'lucide-react'
import { useRef } from 'react'
import { useTranslation } from 'react-i18next'

import { UiButton, UiIconButton, UiInput } from '@/components/ui'
import type { FileUploadParamDef } from '@/core/types'
import { getI18nText } from '@/core/types/I18nText'
import { useNotification } from '@/contexts/NotificationContext'
import { getPathForFile } from '@/platform/desktopApi'
import { fileToBase64 } from '@/utils/fileConverter'
import { ParamLabel } from '../ParamLabel'

interface FileUploadProps {
  param: FileUploadParamDef
  value: DynamicValue
  onChange: (value: string[]) => void
  disabled?: boolean
  showLabel?: boolean
}

function displayFilename(source: string, index: number): string {
  if (source.startsWith('data:')) return `文件 ${index + 1}`
  return source.split(/[\\/]/).pop() || `文件 ${index + 1}`
}

export function FileUpload({
  param,
  value,
  onChange,
  disabled = false,
  showLabel = true,
}: FileUploadProps): JSX.Element {
  const inputRef = useRef<HTMLInputElement>(null)
  const { i18n, t } = useTranslation('ui')
  const { showNotification } = useNotification()
  const safeValue = Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : (typeof value === 'string' && value.trim() ? [value.trim()] : [])
  const maxCount = param.maxCount ?? 1
  const accept = param.accept ?? ['application/pdf']
  const maxSize = param.maxSize ?? 15 * 1024 * 1024
  const buttonText = getI18nText(param.uploadButtonText ?? { zh: '上传文件', en: 'Upload File' }, i18n.language)

  const handleFiles = async (files: FileList | null): Promise<void> => {
    if (!files) return
    const next = [...safeValue]
    for (const file of Array.from(files).slice(0, maxCount - safeValue.length)) {
      if (!accept.includes(file.type)) {
        showNotification(t('uploadArea.unsupportedType', { type: file.type }), 'error')
        continue
      }
      if (file.size > maxSize) {
        showNotification(t('uploadArea.tooLarge', { maxSize: Math.round(maxSize / 1024 / 1024) }), 'error')
        continue
      }
      const directPath = getPathForFile(file).trim()
      next.push(directPath || await fileToBase64(file))
    }
    onChange(next)
  }

  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      {showLabel && (
        <ParamLabel param={param} language={i18n.language} />
      )}
      <div className="flex flex-wrap items-center gap-2">
        {safeValue.map((source, index) => (
          <div key={`${source}-${index}`} className="flex h-9 min-w-0 items-center gap-1.5 rounded-lg bg-app/40 px-2">
            <FileText className="h-4 w-4 shrink-0 text-text-muted" />
            <span className="max-w-32 truncate text-xs text-text-soft">{displayFilename(source, index)}</span>
            <UiIconButton
              type="button"
              showBorder={false}
              appearance="hover-only"
              className="!h-6 !w-6 shrink-0"
              onClick={() => onChange(safeValue.filter((_, candidate) => candidate !== index))}
              disabled={disabled}
              aria-label={t('common:delete', '删除')}
            >
              <X className="h-3.5 w-3.5" />
            </UiIconButton>
          </div>
        ))}
        {safeValue.length < maxCount && (
          <UiButton
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => inputRef.current?.click()}
            disabled={disabled}
          >
            <Upload className="h-4 w-4" />
            {buttonText}
          </UiButton>
        )}
        <UiInput
          ref={inputRef}
          type="file"
          accept={accept.join(',')}
          multiple={maxCount > 1}
          className="hidden"
          disabled={disabled}
          onChange={(event) => {
            void handleFiles(event.target.files)
            event.target.value = ''
          }}
        />
      </div>
    </div>
  )
}
