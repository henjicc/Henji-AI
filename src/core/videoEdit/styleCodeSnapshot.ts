import { z } from 'zod'
import { codeMaterialVersionSchema } from './codeMaterialPersistence'
import { codeSourcesSchema, componentFileReferences, type CodeSourceResolver } from './codeMaterial/sources'
import { parseCodeMaterialTypes, parseCodeMaterialV3Parameters, codeParameterMetadata } from './codeMaterial/parameterTypes'
import type { CodeMaterialMetadata } from './codeMaterialDocument'
import { codeMediaDependencySchema } from './codeMediaDependency'
import { videoEditSceneSchema } from './scene/sceneSchema'

// 声明沿用作者声明解析器；读库时只校验数据，绝不运行源码。
export const videoEditStyleCodeSnapshotSchema = z.object({
  version: codeMaterialVersionSchema,
  codeSources: codeSourcesSchema,
  params: z.record(z.string(), z.json()),
  types: z.record(z.string(), z.json()).optional(),
  media: z.array(codeMediaDependencySchema).refine(media => new Set(media.map(media => media.id)).size === media.length, '风格件媒体依赖标识重复。').optional(),
  scenes: z.array(videoEditSceneSchema).refine(scenes => new Set(scenes.map(scene => scene.id)).size === scenes.length, '风格件片子数据标识重复。').optional(),
}).strict().superRefine((snapshot, context) => {
  const hashes = new Set(snapshot.codeSources.map(source => source.hash))
  if ([...snapshot.version.files, ...componentFileReferences(snapshot.version.imports)].some(file => !hashes.has(file.hash))) context.addIssue({ code: 'custom', message: '风格件的代码快照缺少源码或固定组件依赖。' })
  try { styleCodeParameters(snapshot) } catch (error) { context.addIssue({ code: 'custom', message: error instanceof Error ? error.message : String(error) }) }
})
export type VideoEditStyleCodeSnapshot = z.infer<typeof videoEditStyleCodeSnapshotSchema>
export function styleCodeParameters(snapshot: Pick<VideoEditStyleCodeSnapshot, 'version' | 'params' | 'types'>): CodeMaterialMetadata['parameters'] {
  return parseCodeMaterialV3Parameters(snapshot.params, parseCodeMaterialTypes(snapshot.types ?? {}, snapshot.version.apiVersion), snapshot.version.apiVersion)
}
export function styleCodeDeclarations(metadata: CodeMaterialMetadata): Pick<VideoEditStyleCodeSnapshot, 'params' | 'types'> {
  const raw = (parameter: CodeMaterialMetadata['parameters'][number]): Record<string, unknown> => {
    const { key: _key, optionLabels: _labels, fields: _fields, ...value } = codeParameterMetadata(parameter)
    if (parameter.type === 'table') value.fields = Object.fromEntries(Object.entries(parameter.fields).map(([key, field]) => [key, raw(field)]))
    return value
  }
  return JSON.parse(JSON.stringify({ params: Object.fromEntries(metadata.parameters.map(parameter => [parameter.key, raw(parameter)])), ...(metadata.types ? { types: Object.fromEntries(Object.entries(metadata.types).map(([name, type]) => [name, { ...type, fields: Object.fromEntries(Object.entries(type.fields).map(([key, field]) => [key, raw(field)])) }])) } : {}) })) as Pick<VideoEditStyleCodeSnapshot, 'params' | 'types'>
}
export function styleCodeSourceResolver(snapshot: VideoEditStyleCodeSnapshot): CodeSourceResolver {
  const sources = new Map(snapshot.codeSources.map(source => [source.hash, source.source]))
  return { read(hash, _location, path): string { const source = sources.get(hash); if (source === undefined) throw new Error(`风格件缺少 ${path ?? '代码文件'} 的源码。`); return source } }
}
