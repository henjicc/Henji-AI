import { convertFileSrc } from '@tauri-apps/api/core'
import { fileToBlobSrc } from '@/utils/save'

export async function toAudioDisplayUrl(audioPath: string): Promise<string> {
  try {
    return await fileToBlobSrc(audioPath)
  } catch {
    return convertFileSrc(audioPath.replace(/\\/g, '/'))
  }
}
