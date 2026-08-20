import { toDisplaySrc } from '@/platform/desktopApi'

export async function toAudioDisplayUrl(audioPath: string): Promise<string> {
  return toDisplaySrc(audioPath.replace(/\\/g, '/'))
}
