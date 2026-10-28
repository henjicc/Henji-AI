import { createHash } from 'node:crypto'
import type { CodeFileReference, CodeSource } from './sources'
import type { CodeMaterialMetadata } from '../codeMaterialDocument'
import { parseCodeMaterialTypes, parseCodeMaterialV3Parameters } from './parameterTypes'
import { documentCodeSourceResolver, resolveCodeMaterialFiles, rememberTransientCodeSource, type CodeMaterialFiles } from './sources'
/** Explicit new-format fixtures; never imported by production code. */
export function testCodeManifest(source: string, _document: unknown): { entry: string; files: CodeFileReference[] } {
  const hash = createHash('sha256').update(source, 'utf8').digest('hex')
  const location = rememberTransientCodeSource(hash, source)
  return { entry: 'main.ts', files: [{ path: 'main.ts', location, hash }] }
}
export function testCodeSource(document: unknown, version: { entry: string; files: CodeFileReference[] }): string {
  const contents = resolveCodeMaterialFiles(version, documentCodeSourceResolver(document)); return contents.files[contents.entry]
}
export function testSetCodeSource(document: unknown, version: { entry: string; files: CodeFileReference[] }, source: string): void { Object.assign(version, testCodeManifest(source, document)) }
export function testCodeAssetSource(source: string): { codeSources: CodeSource[]; sourceVersion: { apiVersion: 4; languageVersion: 4; entry: string; files: CodeFileReference[] } } {
  const manifest = testCodeManifest(source, {})
  return { sourceVersion: { apiVersion: 4, languageVersion: 4, ...manifest, files: manifest.files.map(file => ({...file, location: `asset:${file.hash}`})) }, codeSources: [{ hash: createHash('sha256').update(source).digest('hex'), source }] }
}
export function testFilesSource(input: string | CodeMaterialFiles): string { return typeof input === 'string' ? input : input.files[input.entry] }
/** Control metadata exactly as the author host normalizes declarations; drawing code is irrelevant here. */
export function testCodeMetadata(input: { name?: string; kind?: 'generator' | 'filter'; mode?: 'static' | 'dynamic'; width?: number; height?: number; durationSeconds?: number; parameters?: Record<string, unknown>; types?: Record<string, unknown>; apiVersion?: number }): CodeMaterialMetadata {
  const types = parseCodeMaterialTypes(input.types ?? {}, input.apiVersion)
  return { name: input.name ?? '测试效果', kind: input.kind ?? 'generator', mode: input.mode ?? 'dynamic', seed: 0, width: input.width, height: input.height, durationSeconds: input.durationSeconds, types, parameters: parseCodeMaterialV3Parameters(input.parameters ?? {}, types, input.apiVersion) }
}
