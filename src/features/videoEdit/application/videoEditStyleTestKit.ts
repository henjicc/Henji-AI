import { registerHarnessRecycledFile } from '@/tests/harnessNativeStorage'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { VideoEditStyleLibraryIo } from './videoEditStyleLibrary'

/** 测试用风格库目录：真实文件读写落在临时目录，内置风格读仓库里随包分发的 resources/video-edit-styles。 */
export function createTestStyleLibraryIo(options: { builtin?: boolean } = {}): VideoEditStyleLibraryIo & { root: () => Promise<string>; dispose(): void } {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'henji-style-library-'))
  const root = path.join(temporary, 'video-edit-styles'); fs.mkdirSync(root)
  const preserve = async (target: string, name = path.basename(target), remove = false): Promise<void> => {
    if (!fs.existsSync(target)) return
    const backup = path.join(temporary, crypto.randomUUID())
    fs.cpSync(target, backup, { recursive: true })
    if (remove) fs.rmSync(target, { recursive: true, force: true })
    registerHarnessRecycledFile(target, name, async () => { fs.mkdirSync(path.dirname(target), { recursive: true }); fs.cpSync(backup, target, { recursive: true }); fs.rmSync(backup, { recursive: true, force: true }) })
  }
  const builtin = path.resolve('resources/video-edit-styles')
  return {
    root: async () => root,
    builtinRoot: async () => options.builtin === false ? null : builtin,
    join: async (...parts) => path.join(...parts),
    exists: async file => fs.existsSync(file),
    readText: async file => fs.readFileSync(file, 'utf8'),
    writeText: async (file, text) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text) },
    readBytes: async file => new Uint8Array(fs.readFileSync(file)),
    writeBytes: async (file, bytes) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, bytes) },
    list: async dir => fs.readdirSync(dir, { withFileTypes: true }).map(entry => ({ name: entry.name, isDirectory: entry.isDirectory() })),
    mkdir: async dir => { fs.mkdirSync(dir, { recursive: true }) },
    remove: (target, name) => preserve(target, name, true),
    preserve,
    removeCache: async target => { fs.rmSync(target, { recursive: true, force: true }) },
    dispose: () => fs.rmSync(temporary, { recursive: true, force: true }),
  }
}

/** 测试用：登记一个人名条原生模板并加到序列，返回片段 id（走正式的模板应用路径）。 */
export async function addTestTitleTemplate(projectId: string, sequenceId: string): Promise<string> {
  const { titleGraphic } = await import('@/core/videoEdit/titleGraphics')
  const { editVideoProject, requireVideoEditInstance } = await import('./videoEditService')
  const { applyVideoEditTemplate } = await import('./videoEditTemplates')
  const sequence = requireVideoEditInstance(projectId).document.sequences.find(value => value.id === sequenceId)!
  const graphic = titleGraphic('lower_third', { text: '姓名', subtitle: '职务' }, sequence.width, sequence.height, 119 / 30)
  const id = crypto.randomUUID()
  editVideoProject(projectId, document => ({ ...document, templates: [...(document.templates ?? []), { id, name: '人名条', description: '', version: 1, contentHash: '', updatedAt: new Date().toISOString(), style: null, origin: null, body: { kind: 'native' as const, content: { width: sequence.width, height: sequence.height, fps: 30, clips: [{ name: '人名条', kind: 'graphic' as const, graphic, track: 0, start: 0, duration: 120, sourceInUs: 0, sourceRemainder: { numerator: 0, denominator: 1 }, x: 0, y: 0, scale: 1, rotation: 0, opacity: 1, volume: 1, text: '' }] } } }] }))
  const { clipIds } = await applyVideoEditTemplate(projectId, sequenceId, 'project', id)
  return clipIds[0]
}
