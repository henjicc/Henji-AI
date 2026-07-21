import { toDisplaySrc } from '@/platform/desktopApi'
import { fileToBlobSrc } from '@/utils/save'

export async function toAudioDisplayUrl(audioPath: string): Promise<string> {
  try {
    return await fileToBlobSrc(audioPath)
  } catch {
    return toDisplaySrc(audioPath.replace(/\\/g, '/'))
  }
}
