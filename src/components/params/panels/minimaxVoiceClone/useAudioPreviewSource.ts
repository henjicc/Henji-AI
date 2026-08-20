import { useEffect, useState } from 'react'
import { toDisplayAudioSrc } from './utils'
import { getPathForFile } from '@/platform/desktopApi'

export function useAudioPreviewSource(file: File | null, filePath: string): string {
  const [source, setSource] = useState('')

  useEffect(() => {
    if (file) {
      const fullPath = getPathForFile(file).trim()
      if (fullPath) {
        setSource(toDisplayAudioSrc(fullPath))
        return undefined
      }
      const objectUrl = URL.createObjectURL(file)
      setSource(objectUrl)
      return () => {
        URL.revokeObjectURL(objectUrl)
      }
    }

    const normalized = filePath.trim()
    if (!normalized) {
      setSource('')
      return undefined
    }
    if (
      normalized.startsWith('http://') ||
      normalized.startsWith('https://') ||
      normalized.startsWith('blob:') ||
      normalized.startsWith('data:')
    ) {
      setSource(normalized)
      return undefined
    }

    setSource(toDisplayAudioSrc(normalized))
    return undefined
  }, [file, filePath])

  return source
}
