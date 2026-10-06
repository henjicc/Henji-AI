const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')
const {
  DISTRIBUTED_LICENSE_FILES,
  expectedLicenseFiles,
  inspectFfmpegConfiguration,
  renderFfmpegBuildInfo,
  renderLicenseReadme,
  renderVideoDecoderNotice,
  sourcePackageFileNames,
} = require('./distributionNotices.cjs')
const { btbnVariantArgs, parseStageListing, renderDependencyTsv, renderSourceReadme, sourcesOfCommand } = require('./sourcePackage.cjs')
const { verifyPackagedResources } = require('./packagedResources.cjs')

const FFMPEG_BUILD = {
  version: 'n9.0.2-17-g2a571b6068',
  releaseTag: 'autobuild-2026-09-30-13-08',
  asset: 'ffmpeg-n9.0.2-17-g2a571b6068-win64-gpl-shared-9.0.zip',
  sha256: '3da6c7b60bb9ccd73ec5b5e815ba804a0879eb362ba0e3beebce50174c022696',
  size: 86321582,
  variant: 'win64-gpl-shared-9.0',
  sourceCommit: '2a571b606854520cf89804d8030c8b328e621689',
  buildScriptsCommit: '6c9aec5fc9a72ec3abedd1fa84db141fa18cf52b',
}
const VERSION_OUTPUT = `ffmpeg version n9.0.2-17-g2a571b6068-20260930 Copyright (c) 2000-2026 the FFmpeg developers
built with gcc 16.2.0
configuration: --prefix=/ffbuild/prefix --enable-gpl --enable-version3 --disable-debug --enable-shared --disable-libfdk-aac --enable-libx264
libavutil      61.  1.102 / 61.  1.102
`

test('FFmpeg 构建配置核对：GPLv3 通过，缺 version3 或含 nonfree 报错', () => {
  const ok = inspectFfmpegConfiguration(VERSION_OUTPUT)
  assert.deepEqual([ok.gpl, ok.version3, ok.nonfree, ok.problems], [true, true, false, []])
  assert.equal(ok.libraryVersion, 'n9.0.2-17-g2a571b6068-20260930')
  // --disable-libfdk-aac 不是 nonfree
  assert.equal(inspectFfmpegConfiguration(VERSION_OUTPUT.replace(' --enable-version3', '')).problems.length, 1)
  assert.match(inspectFfmpegConfiguration(VERSION_OUTPUT.replace('--enable-gpl', '--enable-gpl --enable-nonfree')).problems.join(), /nonfree/)
  assert.match(inspectFfmpegConfiguration('garbage').problems.join(), /configuration/)
})

test('随包许可文件：Windows 含 FFmpeg 与原生服务声明，其他平台不含', () => {
  assert.equal(expectedLicenseFiles('win32').length, 6)
  assert.deepEqual(expectedLicenseFiles('darwin'), ['README.txt', 'LICENSE.txt', 'THIRD-PARTY-NOTICES.txt'])
})

test('README 写明 FFmpeg 源码提交、BtbN 标签、项目仓库与 Release 源码包文件名', () => {
  const readme = renderLicenseReadme({ productName: '痕迹AI', appVersion: '2.0.0', platform: 'win32', ffmpegBuild: FFMPEG_BUILD })
  const names = sourcePackageFileNames({ version: '2.0.0', ffmpegBuild: FFMPEG_BUILD })
  for (const expected of [FFMPEG_BUILD.sourceCommit, FFMPEG_BUILD.releaseTag, FFMPEG_BUILD.buildScriptsCommit, 'https://github.com/henjicc/Henji-AI/tree/v2.0.0', 'releases/tag/v2.0.0', 'GPL-3.0-or-later', '--enable-nonfree', ...Object.values(names)]) {
    assert.ok(readme.includes(expected), `README 缺少 ${expected}`)
  }
  const mac = renderLicenseReadme({ productName: '痕迹AI', appVersion: '2.0.0', platform: 'darwin', ffmpegBuild: null })
  assert.doesNotMatch(mac, /FFmpeg|GPL/)
})

test('原生服务声明：源码 Apache-2.0，可执行文件整体 GPL-3.0-or-later', () => {
  const notice = renderVideoDecoderNotice({ appVersion: '2.0.0', ffmpegBuild: FFMPEG_BUILD })
  assert.match(notice, /Apache License 2\.0/)
  assert.match(notice, /GPL-3\.0-or-later/)
  assert.match(notice, /WITHOUT ANY WARRANTY/)
})

test('BUILD-INFO 记录版本、包哈希、configure 输出与随包文件哈希', () => {
  const { text, inspected } = renderFfmpegBuildInfo({
    ffmpegBuild: FFMPEG_BUILD, url: 'https://example.invalid/pkg.zip', versionOutput: VERSION_OUTPUT, licenseOutput: 'ffmpeg is free software',
    files: [{ name: 'avcodec-63.dll', size: 119112704, sha256: 'a'.repeat(64) }],
  })
  assert.deepEqual(inspected.problems, [])
  for (const expected of [FFMPEG_BUILD.version, FFMPEG_BUILD.sha256, 'configuration: --prefix', 'a'.repeat(64), '119,112,704', 'ffmpeg is free software']) {
    assert.ok(text.includes(expected), `BUILD-INFO 缺少 ${expected}`)
  }
})

test('BtbN 变体参数与阶段下载命令解析', () => {
  assert.deepEqual(btbnVariantArgs('win64-gpl-shared-9.0'), ['win64', 'gpl-shared', '9.0'])
  assert.deepEqual(btbnVariantArgs('linux64-lgpl'), ['linux64', 'lgpl', ''])
  assert.throws(() => btbnVariantArgs('weird'))
  assert.deepEqual(sourcesOfCommand('git-mini-clone "https://code.videolan.org/videolan/x264.git" "0480cb05" "."'), [
    { kind: 'git', repo: 'https://code.videolan.org/videolan/x264.git', ref: '0480cb05' },
  ])
  assert.deepEqual(sourcesOfCommand('git clone --filter=blob:none "https://github.com/Multicorewareinc/x265.git" . && git checkout "020d7054"'), [
    { kind: 'git', repo: 'https://github.com/Multicorewareinc/x265.git', ref: '020d7054' },
  ])
  assert.deepEqual(sourcesOfCommand(`retry-tool sh -c "rm -rf iconv && git clone 'git://git.git.savannah.gnu.org/libiconv.git' iconv" && git -C iconv checkout "1df3087b"`), [
    { kind: 'git', repo: 'git://git.git.savannah.gnu.org/libiconv.git', ref: '1df3087b' },
  ])
  assert.deepEqual(sourcesOfCommand(`retry-tool sh -c "rm -rf xvid && svn --non-interactive checkout --username 'anonymous' --password '' 'https://svn.xvid.org/trunk/xvidcore@2204' xvid" && cd xvid`), [
    { kind: 'svn', repo: 'https://svn.xvid.org/trunk/xvidcore', ref: '2204' },
  ])
  const stages = parseStageListing('scripts.d/15-base.sh\t\nscripts.d/50-x264.sh\tgit-mini-clone "https://code.videolan.org/videolan/x264.git" "0480cb05" ".";\n')
  assert.equal(stages.length, 2)
  assert.equal(stages[0].command, '')
  const tsv = renderDependencyTsv(stages, FFMPEG_BUILD)
  assert.match(tsv, /scripts\.d\/50-x264\.sh\tgit\thttps:\/\/code\.videolan\.org\/videolan\/x264\.git\t0480cb05\t/)
  assert.doesNotMatch(tsv, /15-base/)
  const readme = renderSourceReadme({ appVersion: '2.0.0', commit: 'c0ffee', ref: 'v2.0.0', ffmpegBuild: FFMPEG_BUILD, names: sourcePackageFileNames({ version: '2.0.0', ffmpegBuild: FFMPEG_BUILD }), stageCount: 101 })
  assert.match(readme, /\.\/build\.sh win64 gpl-shared 9\.0/)
})

function writeFile(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, content)
}

function windowsLayout() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'henji-packaged-'))
  const appOutDir = path.join(dir, 'win-unpacked')
  const sourceDir = path.join(dir, 'source')
  const bundled = path.join(appOutDir, 'resources', 'resources')
  const sources = []
  for (const name of ['henji-video-decoder.exe', 'avcodec-63.dll', 'ffmpeg.exe', 'ffprobe.exe']) {
    writeFile(path.join(sourceDir, name), `bytes:${name}`)
    writeFile(path.join(bundled, 'video-decoder', name), `bytes:${name}`)
    sources.push({ name, source: path.join(sourceDir, name) })
  }
  const crypto = require('node:crypto')
  const hashes = sources.filter((item) => item.name !== 'henji-video-decoder.exe')
    .map((item) => crypto.createHash('sha256').update(`bytes:${item.name}`).digest('hex'))
  for (const file of expectedLicenseFiles('win32')) {
    writeFile(path.join(bundled, 'licenses', file), file === DISTRIBUTED_LICENSE_FILES.ffmpegBuildInfo ? `Version: ${FFMPEG_BUILD.version}\n${hashes.join('\n')}` : 'text')
  }
  writeFile(path.join(bundled, 'henji-audio-worker.exe'), 'worker')
  writeFile(path.join(appOutDir, 'LICENSES.chromium.html'), '<html>')
  writeFile(path.join(appOutDir, 'resources', 'app.asar'), 'asar')
  for (const name of ['onnxruntime_binding.node', 'onnxruntime.dll', 'DirectML.dll']) writeFile(path.join(appOutDir, 'resources', 'app.asar.unpacked', 'node_modules', 'onnxruntime-node', 'bin', 'napi-v6', 'win32', 'x64', name), 'native')
  return { dir, appOutDir, bundled, sources }
}

test('打包核对：完整 Windows 布局通过，各类偏差逐项报出', () => {
  const layout = windowsLayout()
  try {
    const verify = (asarEntries = ['\\node_modules\\sharp\\package.json']) => verifyPackagedResources({
      appOutDir: layout.appOutDir, platform: 'win32', videoDecoderSources: layout.sources, ffmpegVersion: FFMPEG_BUILD.version, listAsar: () => asarEntries,
    })
    assert.deepEqual(verify(), [])
    // 本平台二进制包不算混入（@esbuild/win32-x64、clipboard-win32-x64-msvc）
    assert.deepEqual(verify(['/node_modules/@esbuild/win32-x64/esbuild.exe', '\\node_modules\\@mariozechner\\clipboard-win32-x64-msvc\\c.node']), [])

    writeFile(path.join(layout.bundled, 'henji-audio-worker.exe'), 'MZ...KERNEL32.dll\0VCRUNTIME140.dll\0')
    writeFile(path.join(layout.bundled, 'video-decoder', 'henji_video_decoder.pdb'), 'pdb')
    writeFile(path.join(layout.bundled, 'video-decoder', 'avcodec-63.dll'), 'stale')
    writeFile(path.join(layout.bundled, 'licenses', 'third-party-licenses.json'), '{}')
    fs.rmSync(path.join(layout.bundled, 'licenses', 'ffmpeg', 'COPYING.GPLv3.txt'))
    writeFile(path.join(layout.appOutDir, 'resources', 'app.asar.unpacked', 'node_modules', 'ffmpeg-ffprobe-static', 'ffmpeg.exe'), 'old')
    const onnxBin = path.join(layout.appOutDir, 'resources', 'app.asar.unpacked', 'node_modules', 'onnxruntime-node', 'bin', 'napi-v6')
    fs.rmSync(path.join(onnxBin, 'win32', 'x64', 'DirectML.dll'))
    writeFile(path.join(onnxBin, 'linux', 'x64', 'libonnxruntime.so.1'), 'foreign')
    const problems = verify(['\\out\\main\\index.cjs', '\\node_modules\\@esbuild\\linux-x64\\bin\\esbuild', '\\node_modules\\x\\node_modules\\@esbuild\\win32-arm64\\esbuild.exe', '\\node_modules\\@mariozechner\\clipboard-darwin-universal\\c.node','\\node_modules\\ffmpeg-ffprobe-static\\index.js', '\\docs\\ref\\a.mp4', '\\native\\video-decoder\\Cargo.toml']).join('\n')
    for (const expected of ['henji-audio-worker.exe 动态依赖 VCRUNTIME140.dll', '其他平台的二进制包（在 electron-builder.yml win.files 排除）：@esbuild/linux-x64, @esbuild/win32-arm64, @mariozechner/clipboard-darwin-universal','混入了 files 包含项之外的内容（文件匹配规则退化成整个仓库？）：docs, native', 'henji_video_decoder.pdb', 'avcodec-63.dll 与构建来源不一致', 'BUILD-INFO 未记录随包 avcodec-63.dll', 'third-party-licenses.json', 'COPYING.GPLv3.txt', 'app.asar.unpacked', 'app.asar 中存在', 'win32/x64/DirectML.dll', 'onnxruntime-node 混入了其他平台的原生库：linux/x64']) {
      assert.ok(problems.includes(expected), `未报出：${expected}\n${problems}`)
    }
  } finally {
    fs.rmSync(layout.dir, { recursive: true, force: true })
  }
})

test('静态 CRT：Windows 追加 +crt-static 并保留已有 rustflags，其他平台不变；导入表识别 VC 运行库', () => {
  const { WINDOWS_MSVC_RUSTFLAGS_ENV, dynamicMsvcRuntimeOf, withStaticMsvcCrt } = require('./nativeCrt.cjs')
  assert.equal(withStaticMsvcCrt({}, 'win32')[WINDOWS_MSVC_RUSTFLAGS_ENV], '-C target-feature=+crt-static')
  assert.equal(withStaticMsvcCrt({ [WINDOWS_MSVC_RUSTFLAGS_ENV]: '-C opt-level=3' }, 'win32')[WINDOWS_MSVC_RUSTFLAGS_ENV], '-C opt-level=3 -C target-feature=+crt-static')
  assert.deepEqual(withStaticMsvcCrt({ A: '1' }, 'darwin'), { A: '1' })
  assert.equal(dynamicMsvcRuntimeOf(Buffer.from('xx\0VCRUNTIME140.dll\0')), 'VCRUNTIME140.dll')
  assert.equal(dynamicMsvcRuntimeOf(Buffer.from('xx\0msvcp140_1.dll\0')), 'msvcp140_1.dll')
  assert.equal(dynamicMsvcRuntimeOf(Buffer.from('KERNEL32.dll\0api-ms-win-crt-heap-l1-1-0.dll\0')), null)
})

test('打包核对：非 Windows 只要求通用许可文件', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'henji-packaged-mac-'))
  try {
    const licenses = path.join(dir, '痕迹AI.app', 'Contents', 'Resources', 'resources', 'licenses')
    for (const file of expectedLicenseFiles('darwin')) writeFile(path.join(licenses, file), 'text')
    assert.deepEqual(verifyPackagedResources({ appOutDir: dir, platform: 'darwin', productFilename: '痕迹AI' }), [])
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('外部库获取脚本：原样执行 BtbN 下载步骤，只跳过生成/补历史步骤，git-sync-deps 改用 $PYTHON 且不吞失败', () => {
  const { buildStageFetchScript, groupIntoParts, renderDependencyFetchStatus, stageArchiveBase } = require('./sourcePackage.cjs')
  const { script, skipped } = buildStageFetchScript([
    'git-mini-clone "https://github.com/xiph/opus.git" "503d81b1" "."',
    './autogen.sh',
    'git fetch --unshallow --filter=blob:none',
    './utils/git-sync-deps || exit 0',
    'meson subprojects download proxy-libintl',
  ])
  assert.deepEqual(skipped.map((item) => item.step), ['./autogen.sh', 'git fetch --unshallow --filter=blob:none'])
  assert.match(script, /^set -e -o pipefail/)
  assert.match(script, /\ngit-mini-clone "https:\/\/github\.com\/xiph\/opus\.git" "503d81b1" "\."\n/)
  assert.match(script, /\n"\$PYTHON" \.\/utils\/git-sync-deps\n/)
  assert.doesNotMatch(script, /exit 0/)
  assert.doesNotMatch(script, /\n\.\/autogen\.sh\n/)
  assert.match(script, /export -f retry-tool git-mini-clone svn-last-changed svn wrap-get meson/)
  assert.equal(stageArchiveBase('scripts.d/50-librsvg/10-glib.sh'), '50-librsvg_10-glib')
  const parts = groupIntoParts([{ name: 'a', size: 6 }, { name: 'b', size: 5 }, { name: 'c', size: 4 }, { name: 'd', size: 1 }], 10)
  assert.deepEqual(parts.map((part) => part.entries.map((entry) => entry.name)), [['a', 'c'], ['b', 'd']])
  assert.throws(() => groupIntoParts([{ name: 'huge', size: 11 }], 10), /超过附件上限/)
  assert.match(renderDependencyFetchStatus([{ stage: 's', status: 'failed', seconds: 1.25, note: '退出码 1' }]), /\ns\tfailed\t\t\t\t1\.3\t退出码 1\n/)
})
