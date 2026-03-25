import { useEffect, useState } from 'react'
import { fileToBlobSrc } from '@/utils/save'
import { toDisplayAudioSrc } from './utils'

export function useAudioPreviewSource(file: File | null, filePath: string): string {
  const [source, setSource] = useState('')

  useEffect(() => {
    if (file) {
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

    let revoked = false
    let objectUrl = ''
    void (async () => {
      try {
        objectUrl = await fileToBlobSrc(normalized)
        if (!revoked) {
          setSource(objectUrl)
          return
        }
        URL.revokeObjectURL(objectUrl)
      } catch {
        if (!revoked) {
          setSource(toDisplayAudioSrc(normalized))
        }
      }
    })()
    return () => {
      revoked = true
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl)
      }
    }
  }, [file, filePath])

  return source
}
