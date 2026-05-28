import { createLogger } from '@/core/logging'
import { useCallback } from 'react'
import { saveUploadAudio } from '@/utils/save'

const logger = createLogger('components.MediaGenerator.hooks.useAudioUpload')

export const useAudioUpload = (
  setUploadedAudios: React.Dispatch<React.SetStateAction<string[]>>,
  setUploadedAudioFilePaths: React.Dispatch<React.SetStateAction<string[]>>,
  onError?: (title: string, message: string) => void
) => {
  const handleAudioUpload = useCallback(async (files: File[]): Promise<void> => {
    const audioFile = files.find((file) => file.type.startsWith('audio/'))
    if (!audioFile) return

    try {
      const saved = await saveUploadAudio(audioFile, 'persist')
      setUploadedAudios([saved.fullPath])
      setUploadedAudioFilePaths([saved.fullPath])
    } catch (error) {
      logger.error('[useAudioUpload] 音频处理失败:', error)
      onError?.('音频处理失败', '请确认音频格式正确后重试')
    }
  }, [onError, setUploadedAudioFilePaths, setUploadedAudios])

  const handleAudioRemove = useCallback((_index: number): void => {
    setUploadedAudios([])
    setUploadedAudioFilePaths([])
  }, [setUploadedAudioFilePaths, setUploadedAudios])

  const handleAudioReplace = useCallback(async (index: number, file: File): Promise<void> => {
    handleAudioRemove(index)
    await handleAudioUpload([file])
  }, [handleAudioRemove, handleAudioUpload])

  return {
    handleAudioUpload,
    handleAudioRemove,
    handleAudioReplace,
  }
}
