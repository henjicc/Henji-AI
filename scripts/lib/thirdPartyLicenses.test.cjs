const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')
const {
  buildNotices,
  collectCargoPackages,
  collectNpmPackages,
  createTextTable,
  isCopyleft,
  matchesPlatformList,
  normalizeLicenseExpression,
  normalizeRepositoryUrl,
  parseFfmpegExternalLibraries,
  renderNoticesText,
  sqliteBlessingFromHeader,
  sqliteVersionFromHeader,
} = require('./thirdPartyLicenses.cjs')

function tempPackage(root, name, files = {}) {
  const dir = path.join(root, ...name.split('/'))
  fs.mkdirSync(dir, { recursive: true })
  for (const [file, content] of Object.entries(files)) fs.writeFileSync(path.join(dir, file), content)
  return dir
}

test('GPL/LGPL/MPL 需要源码获取方式，存在宽松许可选项时不算', () => {
  assert.equal(isCopyleft('GPL-3.0-or-later'), true)
  assert.equal(isCopyleft('Apache-2.0 AND LGPL-3.0-or-later'), true)
  assert.equal(isCopyleft('MPL-2.0'), true)
  assert.equal(isCopyleft('(MIT OR GPL-3.0)'), false)
  assert.equal(isCopyleft('MIT OR Apache-2.0'), false)
  assert.equal(isCopyleft('BlueOak-1.0.0'), false)
  assert.equal(isCopyleft(null), false)
})

test('许可表达式与仓库地址规范化', () => {
  assert.equal(normalizeLicenseExpression('MIT/Apache-2.0'), 'MIT OR Apache-2.0')
  assert.equal(normalizeLicenseExpression([{ type: 'MIT' }, { type: 'Apache-2.0' }]), '(MIT OR Apache-2.0)')
  assert.equal(normalizeLicenseExpression({ type: 'ISC' }), 'ISC')
  assert.equal(normalizeLicenseExpression(''), null)
  assert.equal(normalizeRepositoryUrl('git+https://github.com/a/b.git'), 'https://github.com/a/b')
  assert.equal(normalizeRepositoryUrl('github:a/b'), 'https://github.com/a/b')
  assert.equal(normalizeRepositoryUrl('a/b'), 'https://github.com/a/b')
  assert.equal(normalizeRepositoryUrl('git@github.com:a/b.git'), 'https://github.com/a/b')
  assert.equal(normalizeRepositoryUrl({ url: 'git+https://github.com/a/b.git', directory: 'npm/x' }), 'https://github.com/a/b/tree/HEAD/npm/x')
  assert.equal(normalizeRepositoryUrl('not a url'), null)
})

test('npm 平台字段按 npm 语义匹配', () => {
  assert.equal(matchesPlatformList(undefined, 'win32'), true)
  assert.equal(matchesPlatformList(['win32'], 'win32'), true)
  assert.equal(matchesPlatformList(['darwin'], 'win32'), false)
  assert.equal(matchesPlatformList(['!win32'], 'win32'), false)
  assert.equal(matchesPlatformList(['!darwin'], 'win32'), true)
})

test('npm 组件只收随目标平台分发的包，第一方包本身不收但继续收其依赖', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'henji-licenses-npm-'))
  const react = tempPackage(root, 'react', { 'package.json': JSON.stringify({ license: 'MIT', author: 'Meta', repository: 'facebook/react' }), LICENSE: 'MIT react' })
  const darwinOnly = tempPackage(root, '@esbuild/darwin-arm64', { 'package.json': JSON.stringify({ license: 'MIT', os: ['darwin'] }) })
  const ffmpeg = tempPackage(root, 'ffmpeg-ffprobe-static', { 'package.json': JSON.stringify({ license: 'GPL-3.0-or-later' }) })
  const sdk = tempPackage(root, '@henjicc/ai-sdk', { 'package.json': JSON.stringify({ license: 'Apache-2.0' }) })
  const nested = tempPackage(root, 'nested', { 'package.json': JSON.stringify({ license: 'ISC' }) })
  const tree = {
    dependencies: {
      react: { version: '18.3.1', path: react, dependencies: { nested: { version: '1.0.0', path: nested } } },
      '@esbuild/darwin-arm64': { version: '0.28.1', path: darwinOnly },
      'ffmpeg-ffprobe-static': { version: '6.1.2', path: ffmpeg },
      '@henjicc/ai-sdk': { version: '0.9.0', path: sdk, dependencies: { nested: { version: '1.0.0', path: nested } } },
      missingOptional: { required: '^1.0.0' },
    },
  }
  const packages = collectNpmPackages(tree, { platform: 'win32', arch: 'x64' })
  assert.deepEqual(packages.map((pkg) => `${pkg.name}@${pkg.version}`).sort(), ['nested@1.0.0', 'react@18.3.1'])
  const reactPkg = packages.find((pkg) => pkg.name === 'react')
  assert.equal(reactPkg.repository, 'https://github.com/facebook/react')
  assert.equal(reactPkg.author, 'Meta')
  // macOS 仍随包 ffmpeg-ffprobe-static（electron-builder.yml 只在 Windows 排除）
  const mac = collectNpmPackages(tree, { platform: 'darwin', arch: 'arm64' })
  assert.ok(mac.some((pkg) => pkg.name === 'ffmpeg-ffprobe-static'))
  assert.ok(mac.some((pkg) => pkg.name === '@esbuild/darwin-arm64'))
})

test('Rust 依赖只沿普通依赖收集，排除工作区成员与 dev/build 依赖', () => {
  const metadata = {
    workspace_members: ['root'],
    packages: [
      { id: 'root', name: 'henji', version: '0.1.0', manifest_path: '/r/Cargo.toml' },
      { id: 'serde', name: 'serde', version: '1.0.0', license: 'MIT/Apache-2.0', repository: 'https://github.com/serde-rs/serde', manifest_path: '/c/serde/Cargo.toml' },
      { id: 'derive', name: 'serde_derive', version: '1.0.0', license: 'MIT OR Apache-2.0', manifest_path: '/c/derive/Cargo.toml' },
      { id: 'cc', name: 'cc', version: '1.0.0', license: 'MIT', manifest_path: '/c/cc/Cargo.toml' },
      { id: 'tempfile', name: 'tempfile', version: '3.0.0', license: 'MIT', manifest_path: '/c/tempfile/Cargo.toml' },
    ],
    resolve: {
      root: 'root',
      nodes: [
        { id: 'root', deps: [
          { pkg: 'serde', dep_kinds: [{ kind: null }] },
          { pkg: 'cc', dep_kinds: [{ kind: 'build' }] },
          { pkg: 'tempfile', dep_kinds: [{ kind: 'dev' }] },
        ] },
        { id: 'serde', deps: [{ pkg: 'derive', dep_kinds: [{ kind: null }] }] },
        { id: 'derive', deps: [] },
      ],
    },
  }
  const packages = collectCargoPackages(metadata)
  assert.deepEqual(packages.map((pkg) => pkg.name).sort(), ['serde', 'serde_derive'])
  assert.equal(packages.find((pkg) => pkg.name === 'serde').license, 'MIT OR Apache-2.0')
})

test('FFmpeg 外部库与 SQLite 版本、声明从实际产物解析', () => {
  assert.deepEqual(
    parseFfmpegExternalLibraries('configuration: --enable-gpl --enable-libx264 --enable-libdav1d --enable-libx264 --disable-libdrm'),
    ['x264', 'dav1d'],
  )
  const header = '/*\n** 2001-09-15\n**\n** The author disclaims copyright to this source code.\n**\n*************\n#define SQLITE_VERSION        "3.53.2"\n'
  assert.equal(sqliteVersionFromHeader(header), '3.53.2')
  assert.match(sqliteBlessingFromHeader(header), /^2001-09-15\n\nThe author disclaims copyright/)
})

test('清单：随包二进制排在最前并登记为重点组件，许可文本去重，缺文件时回退标准文本并标明', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'henji-licenses-build-'))
  const withFile = tempPackage(root, 'a', { LICENSE: 'Same MIT text\r\n' })
  const sameFile = tempPackage(root, 'b', { 'LICENSE.md': 'Same MIT text' })
  const noFile = tempPackage(root, 'c')
  const gpl = tempPackage(root, 'd', { COPYING: 'GPL text' })
  const textTable = createTextTable()
  const runtime = [{ id: 'runtime:ffmpeg', name: 'FFmpeg', version: '9.0.2', license: 'GPL-3.0-or-later', ecosystem: 'runtime', homepage: 'https://ffmpeg.org', textIds: [textTable.add('GPL text')], textOrigin: 'package' }]
  const notices = buildNotices({
    project: { name: '痕迹AI', version: '2.0.0', license: 'Apache-2.0', licenseTextId: textTable.add('Apache text') },
    target: { platform: 'win32', arch: 'x64' },
    runtime,
    npmPackages: [
      { name: 'b', version: '1.0.0', license: 'MIT', dir: sameFile },
      { name: 'a', version: '1.0.0', license: 'MIT', dir: withFile },
      { name: 'c', version: '2.0.0', license: 'MIT', author: 'Someone', dir: noFile },
      { name: 'd', version: '1.0.0', license: 'GPL-2.0-only', repository: 'https://github.com/x/d', dir: gpl },
      { name: 'e', version: '1.0.0', license: 'Custom', dir: noFile },
    ],
    cargoPackages: [
      { name: 'serde', version: '1.0.0', license: 'MIT', dir: withFile },
      { name: 'serde', version: '1.0.0', license: 'MIT', dir: withFile },
    ],
    textTable,
    referenceTexts: {},
  })
  assert.deepEqual(notices.highlights, ['runtime:ffmpeg'])
  assert.deepEqual(notices.components.map((item) => item.name), ['FFmpeg', 'a', 'b', 'c', 'd', 'e', 'serde'])
  const byName = Object.fromEntries(notices.components.map((item) => [item.name, item]))
  assert.deepEqual(byName.a.textIds, byName.b.textIds)
  assert.equal(byName.c.textOrigin, 'standard')
  assert.match(notices.texts[byName.c.textIds[0]], /Copyright \(c\) Someone/)
  assert.equal(byName.e.textOrigin, 'none')
  assert.deepEqual(byName.d.sources, ['https://github.com/x/d', 'https://www.npmjs.com/package/d/v/1.0.0'])
  assert.equal(byName.a.sources, undefined)
  assert.equal(byName.d.textIds[0], runtime[0].textIds[0])
  assert.ok(notices.texts[notices.project.licenseTextId])
  const text = renderNoticesText(notices)
  assert.match(text, /^THIRD-PARTY SOFTWARE NOTICES AND INFORMATION\n痕迹AI 2\.0\.0 \(win32-x64\)/)
  assert.match(text, /FFmpeg 9\.0\.2\n {2}License: GPL-3\.0-or-later/)
  assert.match(text, /Source: https:\/\/github\.com\/x\/d/)
  for (const id of Object.keys(notices.texts)) assert.match(text, new RegExp(`\\[${id}\\]\\n-{80}\\n`))
})
