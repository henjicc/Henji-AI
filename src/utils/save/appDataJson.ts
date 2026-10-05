import { dirname, join, mkdir, readFile, writeFile } from '@/platform/desktopApi'
import { getProgramDataRoot } from '@/utils/dataPath'

// 预设、旧版历史 JSON 属于程序内部数据，固定在程序目录（重要记录 002）。

export async function writeJsonToAppData(relPath: string, data: DynamicValue): Promise<void> {
  const dataRoot = await getProgramDataRoot()
  const fullPath = await join(dataRoot, relPath.replace(/^Henji-AI[/\\]?/, ''))
  const dirPath = await dirname(fullPath)
  await mkdir(dirPath, { recursive: true })
  const json = JSON.stringify(data)
  const bytes = new TextEncoder().encode(json)
  await writeFile(fullPath, bytes)
}

export async function readJsonFromAppData<T = DynamicValue>(relPath: string): Promise<T | null> {
  try {
    const dataRoot = await getProgramDataRoot()
    const fullPath = await join(dataRoot, relPath.replace(/^Henji-AI[/\\]?/, ''))
    const bytes = await readFile(fullPath)
    const json = new TextDecoder().decode(bytes)
    return JSON.parse(json) as T
  } catch {
    return null
  }
}
