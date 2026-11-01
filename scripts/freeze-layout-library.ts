/**
 * 显式发行：node scripts/freeze-layout-library.ts <新版本号>。
 * 仅创建尚不存在的版本目录；日常构建调用 build-author-libraries.ts，只复制并核对冻结产物。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import esbuild from 'esbuild-wasm'
import ts from 'typescript'
import { execFileSync } from 'node:child_process'
import { generateDtsBundle } from 'dts-bundle-generator'
import { AUTHOR_LIBRARIES } from '../src/core/videoEdit/codeMaterial/authorLibraries.ts'
import { assertNewFrozenAuthorRelease, sha256, type FrozenAuthorManifest } from './lib/frozenAuthorLibraries.ts'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const version = process.argv[2]
const release = AUTHOR_LIBRARIES['henji-layout'][version]
if (process.argv.length !== (process.argv.includes('--refreeze-unreleased') ? 4 : 3) || !release?.frozen) throw new Error('请先登记 henji-layout 的新版本，再传入该版本号。')
const destination = path.resolve(root, release.frozen)
if (process.argv.includes('--refreeze-unreleased')) {
  if (execFileSync('git', ['ls-tree', '-r', '--name-only', 'main', '--', release.frozen], { cwd: root, encoding: 'utf8' }).trim()) throw new Error('main 已发布此版本，禁止重冻')
  if (!destination.startsWith(path.join(root, 'resources/video-edit-author/frozen') + path.sep)) throw new Error('冻结目标越界')
  fs.rmSync(destination, { recursive: true, force: true })
} else assertNewFrozenAuthorRelease(root, release.frozen)
const entryRoot = 'src/features/videoEdit/authorLibraries'
const names = Object.keys(release.modules).map(specifier => specifier.split('/')[1])
const entries = names.map(name => `${entryRoot}/${name}.ts`)
const inputs: Record<string, string> = {}
const outputs: Record<string, string | Uint8Array> = {}
const files: Record<string, string> = {}
const config = { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler, strict: true, skipLibCheck: true, esModuleInterop: true, baseUrl: root, paths: { '@/*': ['src/*'] }, types: [], lib: ['lib.esnext.d.ts', 'lib.webworker.d.ts', 'lib.webworker.iterable.d.ts'], declaration: true }
const program = ts.createProgram(entries.map(entry => path.join(root, entry)), config)
const checker = program.getTypeChecker()
const styleFile = program.getSourceFile(path.join(root, 'src/core/imaging/vectorContent/text.ts'))!
const textFile = program.getSourceFile(path.join(root, entryRoot, 'shapedText.ts'))!
const resolveAlias = (source: ts.SourceFile, name: string): string => {
  const node = source.statements.find((statement): statement is ts.TypeAliasDeclaration => ts.isTypeAliasDeclaration(statement) && statement.name.text === name)!
  return checker.typeToString(checker.getTypeAtLocation(node), node, ts.TypeFormatFlags.NoTruncation | ts.TypeFormatFlags.InTypeAlias)
}
const aliases = { TextStyle: resolveAlias(styleFile, 'TextStyle'), TextStyleInput: resolveAlias(textFile, 'TextStyleInput') }
// 声明由 TypeScript 与既有权威类型生成；Zod 只用于构建期推导，不要求作者安装应用内部依赖。
const configFile = path.join(root, '.tmp', `layout-types-${process.pid}.json`)
const ambientFile = path.join(root, '.tmp', `layout-ambient-${process.pid}.d.ts`)
fs.mkdirSync(path.dirname(configFile), { recursive: true })
// HarfBuzz 的上游声明引用可选的 Emscripten 全局；它不是作者契约，不向作者输出。
fs.writeFileSync(ambientFile, 'interface EmscriptenModule {}\n')
fs.writeFileSync(configFile, JSON.stringify({ compilerOptions: { target: 'ES2022', module: 'ESNext', moduleResolution: 'Bundler', strict: true, skipLibCheck: true, esModuleInterop: true, baseUrl: root, paths: { '@/*': ['src/*'] }, types: [ambientFile], lib: ['ESNext', 'WebWorker', 'WebWorker.Iterable'] }, files: [...entries.map(entry => path.join(root, entry)), ambientFile] }))
let declarations: string[]
try { declarations = generateDtsBundle(entries.map(filePath => ({ filePath: path.join(root, filePath), output: { noBanner: true, exportReferencedTypes: false }, libraries: { allowedTypesLibraries: [] } })), { preferredConfigPath: configFile }) }
finally { fs.unlinkSync(configFile); fs.unlinkSync(ambientFile) }
for (const [index, declaration] of declarations.entries()) {
  const ast = ts.createSourceFile('types.d.ts', declaration, ts.ScriptTarget.Latest, true)
  let text = declaration
  for (const node of [...ast.statements].reverse()) {
    let replacement: string | undefined
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier) && node.moduleSpecifier.text === 'zod') replacement = ''
    if (ts.isVariableStatement(node) && node.declarationList.declarations.some(item => ['textStyleSchema', 'ready'].includes(item.name.getText(ast)))) replacement = ''
    if (ts.isTypeAliasDeclaration(node) && Object.hasOwn(aliases, node.name.text)) replacement = `${node.modifiers?.some(item => item.kind === ts.SyntaxKind.ExportKeyword) ? 'export ' : ''}type ${node.name.text} = ${aliases[node.name.text as keyof typeof aliases]};`
    if (replacement !== undefined) text = text.slice(0, node.getStart(ast)) + replacement + text.slice(node.end)
  }
  if (/\bimport\b|\bz\.(?:infer|input|Zod)|\b(?:EmscriptenModule|HarfBuzzModule|TextShaper)\b/.test(text)) throw new Error('作者声明仍依赖未发行的类型模块。')
  files[`${names[index]}.d.ts`] = text
}
files['package.json'] = JSON.stringify({ name: 'henji-layout', version, exports: Object.fromEntries(names.map(name => [`./${name}`, { types: `./${name}.d.ts` }])) })
outputs['types.json'] = JSON.stringify({ mount: 'henji-layout', modules: Object.values(release.modules), files })
const bundled = await esbuild.build({ absWorkingDir: root, entryPoints: { ...Object.fromEntries(names.map((name, index) => [name === 'flex' ? 'flex-runtime' : name, entries[index]])), 'font-session': 'src/core/imaging/vectorContent/shaping/fontPolicy.ts' }, bundle: true, splitting: true, format: 'esm', platform: 'browser', target: 'es2022', outdir: destination, outExtension: { '.js': '.mjs' }, write: false, metafile: true, minify: true, legalComments: 'inline', plugins: [{ name: 'frozen-harfbuzz', setup(build) {
  build.onResolve({ filter: /harfbuzzjs\/1\.6\.4\/index\.mjs$/ }, () => ({ path: './harfbuzz/index.mjs', external: true }))
} }] })
for (const file of bundled.outputFiles) outputs[path.relative(destination, file.path).split(path.sep).join('/')] = file.contents
// 分块名由构建器决定，许可登记必须指向实际包含 Pretext 的产物。
const pretextFiles = Object.entries(bundled.metafile!.outputs).filter(([, output]) => Object.keys(output.inputs).some(input => input.includes('/vendor/pretext/'))).map(([file]) => path.relative(destination, path.resolve(root, file)).split(path.sep).join('/'))
if (pretextFiles.length) {
  const componentsPath = path.join(root, 'scripts/third-party-licenses/author-libs/components.json')
  const text = fs.readFileSync(componentsPath, 'utf8').replace(/\r\n/g, '\n')
  let matched = false
  const next = text.replace(/^[ \t]*\{[^\r\n]+"name":\s*"Pretext"[^\r\n]+$/gm, line => {
    const component = JSON.parse(line.trim().replace(/,$/, ''))
    if (component.library !== `henji-layout@${version}`) return line
    matched = true
    return `    ${JSON.stringify({ ...component, files: pretextFiles.sort() })},`
  })
  if (!matched) throw new Error('缺少 Pretext 许可登记')
  fs.writeFileSync(componentsPath, next)
}
// 顶层 await 只在独立 ESM 发行外壳执行，ES2020 bundle 使用 /load 显式初始化，不打包 Yoga 默认入口。
outputs['flex.mjs'] = "import { ready, layoutBoxes } from './flex-runtime.mjs';\nawait ready;\nexport { layoutBoxes };\n"
outputs.LICENSE = fs.readFileSync(path.join(root, 'LICENSE'), 'utf8')
outputs['NOTICE.txt'] = `Yoga 3.2.1 (MIT)\n${fs.readFileSync(path.join(root, 'scripts/third-party-licenses/author-libs/yoga-MIT.txt'), 'utf8')}\nZod\n${fs.readFileSync(path.join(root, 'node_modules/zod/LICENSE'), 'utf8')}`
for (const [library, vendorVersion] of [['harfbuzzjs', '1.6.4'], ['pretext', '1.0.0']]) {
  const directory = `resources/video-edit-author/vendor/${library}/${vendorVersion}`
  const source = JSON.parse(fs.readFileSync(path.join(root, directory, 'source.json'), 'utf8')) as { files: Record<string, unknown>; localArtifacts: Record<string, unknown> }
  for (const file of [...Object.keys(source.files), ...Object.keys(source.localArtifacts), 'source.json']) {
    const relative = `${directory}/${file}`, bytes = fs.readFileSync(path.join(root, relative))
    inputs[relative] = sha256(bytes)
    if (library === 'harfbuzzjs' && ['index.mjs', 'harfbuzz.mjs', 'harfbuzz.wasm'].includes(file)) outputs[`harfbuzz/${file}`] = bytes
    if (/LICENSE|NOTICE|source\.json$|henji\.patch$/.test(file)) outputs[`sources/${library}/${file}`] = bytes
  }
  outputs['NOTICE.txt'] += `\n${library} ${vendorVersion}：来源、许可与补丁见 sources/${library}/。\n`
}
for (const file of [...Object.keys(bundled.metafile.inputs), ...program.getSourceFiles().filter(file => !file.isDeclarationFile).map(file => path.relative(root, file.fileName).split(path.sep).join('/')), 'scripts/freeze-layout-library.ts', 'package-lock.json']) {
  const absolute = path.resolve(root, file), modules = path.resolve(root, 'node_modules'), realModules = fs.realpathSync(modules)
  const logical = absolute.startsWith(realModules + path.sep) ? path.join(modules, path.relative(realModules, absolute)) : absolute
  inputs[path.relative(root, logical).split(path.sep).join('/')] = sha256(fs.readFileSync(absolute))
}
const manifest: FrozenAuthorManifest = { library: 'henji-layout', version, inputs, outputs: Object.fromEntries(Object.entries(outputs).map(([file, text]) => [file, sha256(text)])) }
fs.mkdirSync(destination, { recursive: true })
for (const [file, text] of Object.entries(outputs)) { fs.mkdirSync(path.dirname(path.join(destination, file)), { recursive: true }); fs.writeFileSync(path.join(destination, file), text, { flag: 'wx' }) }
fs.writeFileSync(path.join(destination, 'release.json'), `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx' })
process.stdout.write(`已冻结 henji-layout@${version}：${Object.keys(outputs).length} 个产物。\n`)
