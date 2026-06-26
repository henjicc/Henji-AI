import { dirname, join, mkdir, readFile, writeFile } from '@/platform/desktopApi'
import { getDataRoot } from '@/utils/dataPath'

export async function writeJsonToAppData(relPath: string, data: unknown): Promise<void> {
  const dataRoot = await getDataRoot()
  const fullPath = await join(dataRoot, relPath.replace(/^Henji-AI[/\\]?/, ''))
  const dirPath = await dirname(fullPath)
  await mkdir(dirPath, { recursive: true })
  const json = JSON.stringify(data)
  const bytes = new TextEncoder().encode(json)
  await writeFile(fullPath, bytes)
}

export async function readJsonFromAppData<T = unknown>(relPath: string): Promise<T | null> {
  try {
    const dataRoot = await getDataRoot()
    const fullPath = await join(dataRoot, relPath.replace(/^Henji-AI[/\\]?/, ''))
    const bytes = await readFile(fullPath)
    const json = new TextDecoder().decode(bytes)
    return JSON.parse(json) as T
  } catch {
    return null
  }
}
