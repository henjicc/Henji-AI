import { mkdir, readFile, remove, writeFile } from '@tauri-apps/plugin-fs'
import * as path from '@tauri-apps/api/path'
import { getWaveformsPath } from '@/utils/dataPath'
import { logWarning } from '@/utils/errorLogger'
import { sha256HexString } from './hash'

async function waveformCachePaths(audioFullPath: string): Promise<{ full: string }> {
  const hash = await sha256HexString(audioFullPath)
  const name = `${hash}.json`
  const waveformsPath = await getWaveformsPath()
  const full = await path.join(waveformsPath, name)
  return { full }
}

export async function readWaveformCacheForAudio(audioFullPath: string): Promise<number[] | null> {
  try {
    const { full } = await waveformCachePaths(audioFullPath)
    const bytes = await readFile(full)
    const text = new TextDecoder().decode(bytes as any)
    const data = JSON.parse(text)
    if (Array.isArray(data)) return data as number[]
    if (Array.isArray(data?.samples)) return data.samples as number[]
    return null
  } catch {
    return null
  }
}

export async function writeWaveformCacheForAudio(audioFullPath: string, samples: number[]): Promise<string> {
  const { full } = await waveformCachePaths(audioFullPath)
  const waveformsPath = await getWaveformsPath()
  await mkdir(waveformsPath, { recursive: true })
  const payload = JSON.stringify(samples)
  await writeFile(full, new TextEncoder().encode(payload))
  return full
}

export async function deleteWaveformCacheForAudio(audioFullPath: string): Promise<void> {
  try {
    const { full } = await waveformCachePaths(audioFullPath)
    await remove(full)
  } catch (e) {
    logWarning('[save] delete waveform cache failed', e)
  }
}

