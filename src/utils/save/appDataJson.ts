import { join, readFile, writeTextFile } from '@/platform/desktopApi'
import { getProgramDataRoot } from '@/utils/dataPath'

// 内部 JSON 读失败必须抛出；只有明确不存在才能当作首次使用。

export async function writeJsonToAppData(relPath: string, data: DynamicValue): Promise<void> {
  const dataRoot = await getProgramDataRoot()
  const fullPath = await join(dataRoot, relPath.replace(/^Henji-AI[/\\]?/, ''))
  const json = JSON.stringify(data)
  await writeTextFile(fullPath, json)
}

export async function readJsonFromAppData<T = DynamicValue>(relPath: string): Promise<T | null> {
  const dataRoot = await getProgramDataRoot()
  const fullPath = await join(dataRoot, relPath.replace(/^Henji-AI[/\\]?/, ''))
  let bytes: Uint8Array
  try {
    bytes = await readFile(fullPath)
  } catch (error) {
    if (error instanceof Error && (('code' in error && error.code === 'ENOENT')
      || error.message.startsWith('ENOENT:'))) return null
    throw error
  }
  return JSON.parse(new TextDecoder().decode(bytes)) as T
}
