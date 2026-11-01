import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import esbuild, { type Plugin } from 'esbuild-wasm'

// 用法：prepare-text-layout-preflight.ts [基线提交，默认 main]
const root = process.cwd(), out = path.resolve('.tmp/text-layout-preflight')
fs.mkdirSync(out, { recursive: true })
const commit = execFileSync('git', ['rev-parse', process.argv[2] ?? 'main'], { cwd: root, encoding: 'utf8' }).trim()
const baseline = path.join(out, `baseline-${commit.slice(0, 9)}`)
if (!fs.existsSync(path.join(baseline, 'src'))) {
  const archive = path.join(out, 'baseline.tar')
  execFileSync('git', ['archive', '--format=tar', '-o', archive, commit, 'src', 'resources/video-edit-author'], { cwd: root })
  fs.mkdirSync(baseline, { recursive: true })
  execFileSync('tar', ['-xf', 'baseline.tar', '-C', path.basename(baseline)], { cwd: out })
  fs.unlinkSync(archive)
}
// 文字工程在每侧按该侧最新的作者接口与 henji-layout 编写；旧工程两侧都固定为接口 7 与 1.2.0。
const latestText = (sourceRoot: string): { apiVersion: number; library: string } => {
  const constants = Object.fromEntries(['codeAuthorVersions.ts', 'codeMaterialPersistence.ts'].flatMap(file => {
    const source = path.join(sourceRoot, 'src/core/videoEdit', file)
    return fs.existsSync(source) ? [...fs.readFileSync(source, 'utf8').matchAll(/export const (CODE_AUTHOR_\w+) = (\w+)/g)].map(match => [match[1], match[2]]) : []
  }))
  let value = constants.CODE_AUTHOR_API_VERSION
  while (value && !/^\d+$/.test(value)) value = constants[value]
  const library = fs.readdirSync(path.join(sourceRoot, 'resources/video-edit-author/frozen/henji-layout')).sort((a, b) => a.localeCompare(b, 'en', { numeric: true })).at(-1)!
  return { apiVersion: Number(value), library }
}
fs.writeFileSync(path.join(out, 'sides.json'), JSON.stringify({ baseline: commit, before: latestText(baseline), after: latestText(root) }))
for (const [name, sourceRoot] of [['before', baseline], ['after', root]]) {
  const directory = path.join(out, name)
  fs.mkdirSync(directory, { recursive: true })
  fs.cpSync(path.join(sourceRoot, 'resources/video-edit-author/frozen/henji-layout'), path.join(directory, 'layout'), { recursive: true })
  const boundary: Plugin = { name: 'preflight-fixture-boundaries', setup(build) {
    build.onLoad({ filter: /platform[\\/]runtime\.ts$/ }, () => ({ contents: 'export function getPlatform(){return globalThis.preflightPlatform} export function isDesktopRuntime(){return false}', loader: 'js' }))
    build.onResolve({ filter: /videoEditSharedCompiler$/ }, () => ({ path: 'compiler', namespace: 'fixture' }))
    build.onResolve({ filter: /platform\/runtime$/ }, () => ({ path: 'platform', namespace: 'fixture' }))
    build.onResolve({ filter: /services\/contentTrust$/ }, () => ({ path: 'trust', namespace: 'fixture' }))
    build.onResolve({ filter: /videoEditMediaContent$/ }, () => ({ path: 'media', namespace: 'fixture' }))
    build.onResolve({ filter: /core\/logging$/ }, () => ({ path: 'logger', namespace: 'fixture' }))
    build.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ loader: 'js', contents: {
      compiler: 'export async function prepareVideoEditAuthorBundle(files){return globalThis.preflightBundles[files.apiVersion]}',
      platform: 'export function getPlatform(){return globalThis.preflightPlatform} export function isDesktopRuntime(){return false}',
      trust: 'export function subscribeContentTrust(){return ()=>{}} export async function ensureContentTrust(q){if(q.contents?.length)throw Error("专项不运行外来代码")} export async function executeContentTrust(){return {records:[]}}',
      media: 'export class VideoEditMediaContentVerifier {async check(){} dispose(){}}',
      logger: 'export function createLogger(){return Object.fromEntries(["debug","info","warn","error","trace"].map(level=>[level,(message,meta)=>globalThis.preflightLogs?.push({level,message,...meta})]))}',
    }[args.path]! }))
    build.onLoad({ filter: /videoEditRenderTransport\.ts$/ }, args => ({ loader: 'ts', contents: fs.readFileSync(args.path, 'utf8').replace("new URL('./videoEditWorker.ts', import.meta.url)", "new URL('./worker.mjs', import.meta.url)") }))
    build.onLoad({ filter: /codeMaterial[\\/]authorLibraries\.ts$/ }, args => ({ loader: 'ts', contents: fs.readFileSync(args.path, 'utf8').replace('return `henji-media://${AUTHOR_LIBRARY_HOST}/${library}/${version}/${path}`', 'return new URL(`./layout/${version}/${path}`, import.meta.url).href') }))
    build.onLoad({ filter: /\?raw$/ }, args => ({ loader: 'text', contents: fs.readFileSync(args.path.replace(/\?raw$/, ''), 'utf8') }))
  } }
  await esbuild.build({ stdin: { contents: `export {VideoEditRenderTransport} from './src/features/videoEdit/engine/videoEditRenderTransport'; export {createVideoEditDocument,createVideoEditSequence,videoEditComposition} from './src/core/videoEdit/document'; export {rememberTransientCodeSource} from './src/core/videoEdit/codeMaterial/sources'; export {makeVideoEditItemClip} from './src/core/videoEdit/projectItems';`, resolveDir: sourceRoot }, outfile: path.join(directory, 'host.mjs'), bundle: true, minify: true, format: 'esm', platform: 'browser', target: 'es2022', alias: { '@': path.join(sourceRoot, 'src') }, plugins: [boundary], define: { 'import.meta.env': '{}' }, loader: { '.wgsl': 'text', '.wasm': 'file' }, external: ['node:*', 'fs', 'path', 'url', 'module'] })
  await esbuild.build({ entryPoints: [path.join(sourceRoot, 'src/features/videoEdit/engine/videoEditWorker.ts')], outfile: path.join(directory, 'worker.mjs'), bundle: true, minify: true, format: 'esm', platform: 'browser', target: 'es2022', alias: { '@': path.join(sourceRoot, 'src') }, plugins: [boundary], define: { 'import.meta.env': '{}' }, loader: { '.wgsl': 'text', '.wasm': 'file' }, external: ['node:*', 'fs', 'path', 'url', 'module'] })
}
await esbuild.build({ entryPoints: ['scripts/text-layout-preflight-experiment.ts'], outfile: path.join(out, 'experiment.mjs'), bundle: true, format: 'esm', platform: 'browser', target: 'es2022' })
fs.writeFileSync(path.join(out, 'index.html'), '<!doctype html><meta charset="utf-8"><script type="module" src="experiment.mjs"></script>')
const fonts = path.join(out, 'fonts'); fs.mkdirSync(fonts, { recursive: true })
const sourceFonts = path.resolve('.tmp/text-layout-acceptance')
fs.copyFileSync(path.join(sourceFonts, 'fonts.json'), path.join(fonts, 'fonts.json'))
for (const font of JSON.parse(fs.readFileSync(path.join(sourceFonts, 'fonts.json'), 'utf8'))) if (!fs.existsSync(path.join(fonts, font.file))) fs.linkSync(path.join(sourceFonts, font.file), path.join(fonts, font.file))
console.log(out)
