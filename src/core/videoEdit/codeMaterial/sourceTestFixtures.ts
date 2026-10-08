import { createHash } from 'node:crypto'
import type { CodeFileReference, CodeSource } from './sources'
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
export function testCodeAssetSource(source: string, languageVersion: 1 | 2 | 3): { codeSources: CodeSource[]; sourceVersion: { apiVersion: 1; languageVersion: 1 | 2 | 3; entry: string; files: CodeFileReference[] } } {
  const manifest = testCodeManifest(source, {})
  return { sourceVersion: { apiVersion: 1, languageVersion, ...manifest, files: manifest.files.map(file => ({...file, location: `asset:${file.hash}`})) }, codeSources: [{ hash: createHash('sha256').update(source).digest('hex'), source }] }
}
export function testFilesSource(input: string | CodeMaterialFiles): string { return typeof input === 'string' ? input : input.files[input.entry] }
