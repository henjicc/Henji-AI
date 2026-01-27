import { mkdir, readFile, writeFile } from '@tauri-apps/plugin-fs'
import * as path from '@tauri-apps/api/path'
import { getDataRoot } from '@/utils/dataPath'

export async function writeJsonToAppData(relPath: string, data: any): Promise<void> {
  const dataRoot = await getDataRoot()
  const fullPath = await path.join(dataRoot, relPath.replace(/^Henji-AI[\/\\]?/, ''))
  const dirPath = await path.dirname(fullPath)
  await mkdir(dirPath, { recursive: true })
  const json = JSON.stringify(data)
  const bytes = new TextEncoder().encode(json)
  await writeFile(fullPath, bytes)
}

export async function readJsonFromAppData<T = any>(relPath: string): Promise<T | null> {
  try {
    const dataRoot = await getDataRoot()
    const fullPath = await path.join(dataRoot, relPath.replace(/^Henji-AI[\/\\]?/, ''))
    const bytes = await readFile(fullPath)
    const json = new TextDecoder().decode(bytes as any)
    return JSON.parse(json) as T
  } catch {
    return null
  }
}

