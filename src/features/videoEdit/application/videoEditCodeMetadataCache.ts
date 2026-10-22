import type { CodeAuthorProgram } from '@/core/videoEdit/codeAuthorProgram'
import { getPlatform } from '@/platform/runtime'
import { sha256HexString } from '@/utils/save/hash'
import { createLogger } from '@/core/logging'

type Metadata = Omit<CodeAuthorProgram, 'bundle'>
const logger = createLogger('features.videoEdit.codeMetadata')
const prefix = 'cache.video-edit.code-metadata.v1:'

/** 可重建的参数缓存复用配置数据库；不把模块 URL、源码或执行结果写入项目。 */
export async function readCodeMetadataCache(contentKey: string, apiVersion = 4, languageVersion = 4): Promise<Metadata | undefined> {
  try {
    const key = prefix + await sha256HexString(JSON.stringify([contentKey, apiVersion, languageVersion]))
    const entry = await getPlatform().settings.get(key)
    if (!entry) return undefined
    const envelope = JSON.parse(entry.value) as { json?: unknown; hash?: unknown }
    if (typeof envelope.json !== 'string' || await sha256HexString(envelope.json) !== envelope.hash) return undefined
    const metadata = JSON.parse(envelope.json) as Metadata
    if (metadata.apiVersion !== apiVersion || metadata.languageVersion !== languageVersion || !Array.isArray(metadata.parameters) || !Array.isArray(metadata.frames) || !Array.isArray(metadata.hexColors)) return undefined
    return metadata
  } catch (error) { logger.debug('参数缓存未命中，将读取源码', { event: 'video_edit.code.metadata.cache_miss', error }); return undefined }
}

export async function writeCodeMetadataCache(contentKey: string, program: Metadata): Promise<void> {
  try {
    const { bundle: _bundle, ...metadata } = program as CodeAuthorProgram
    const key = prefix + await sha256HexString(JSON.stringify([contentKey, program.apiVersion, program.languageVersion]))
    const json = JSON.stringify(metadata)
    await getPlatform().settings.set(key, JSON.stringify({ json, hash: await sha256HexString(json) }), 'json')
  } catch (error) { logger.debug('参数缓存写入失败，下次按需重读', { event: 'video_edit.code.metadata.cache_write_failed', error }) }
}
