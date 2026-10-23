#!/usr/bin/env node
/**
 * 把独立录音程序 henji-audio-capture 的完整对应源码（GPLv3）同步到公开仓库，并按应用版本打标签。
 * 公开仓库包含：本程序源码、构建脚本、Cargo.lock，以及构建时使用的 PortAudio 与 ASIO SDK 原始压缩包（固定版本与 SHA256）。
 * 第三方源码只进公开仓库，不进本仓库与安装包。
 *
 *   node scripts/publish-audio-capture-source.cjs            同步并打标签 v<package.json 版本>
 *   node scripts/publish-audio-capture-source.cjs --dry-run  只在临时目录准备，不推送
 * 需要已登录的 gh（git 走 https 凭据）。
 */
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const crypto = require('node:crypto')
const { spawnSync } = require('node:child_process')
const { SOURCES } = require('./build-audio-capture.cjs')
const { downloadWithRetry } = require('./video-decoder-ffmpeg.cjs')

const REPO = 'henjicc/henji-audio-capture'
const root = path.resolve(__dirname, '..')
const dryRun = process.argv.includes('--dry-run')
const version = require(path.join(root, 'package.json')).version
const tag = `v${version}`
const FILES = ['native/audio-capture/Cargo.toml', 'native/audio-capture/Cargo.lock', 'native/audio-capture/build.rs', 'native/audio-capture/LICENSE', 'native/audio-capture/src',
  'scripts/build-audio-capture.cjs', 'scripts/video-decoder-ffmpeg.cjs', 'scripts/lib/nativeCrt.cjs']

function run(command, args, cwd, capture = false) {
  const result = spawnSync(command, args, { cwd, stdio: capture ? ['ignore', 'pipe', 'inherit'] : 'inherit', encoding: 'utf8', windowsHide: true })
  if (result.error || result.status !== 0) throw result.error ?? new Error(`${command} ${args.join(' ')} 失败：${result.status}`)
  return capture ? result.stdout.trim() : ''
}
async function archive(source, target) {
  const local = path.join(root, 'native/audio-capture/vendor', source.file)
  if (fs.existsSync(local)) fs.copyFileSync(local, target)
  else await downloadWithRetry(source.url, target)
  if (crypto.createHash('sha256').update(fs.readFileSync(target)).digest('hex') !== source.sha256) throw new Error(`${source.file} SHA256 不匹配`)
}

async function main() {
  const commit = run('git', ['rev-parse', 'HEAD'], root, true)
  const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'henji-audio-capture-source-'))
  run('gh', ['repo', 'clone', REPO, stage, '--', '--quiet'], root)
  run('git', ['checkout', '-q', '-B', 'main'], stage)
  // 每次按本仓库当前内容整体替换，删除的文件也同步删除。
  for (const entry of fs.readdirSync(stage)) if (entry !== '.git') fs.rmSync(path.join(stage, entry), { recursive: true, force: true })
  for (const file of FILES) fs.cpSync(path.join(root, file), path.join(stage, file), { recursive: true })
  const vendor = path.join(stage, 'native/audio-capture/vendor')
  fs.mkdirSync(vendor, { recursive: true })
  for (const source of Object.values(SOURCES)) await archive(source, path.join(vendor, source.file))
  fs.writeFileSync(path.join(stage, '.gitignore'), 'native/audio-capture/target/\nnative/audio-capture/vendor/*\n!native/audio-capture/vendor/portaudio.tar.gz\n!native/audio-capture/vendor/asio.zip\n')
  fs.copyFileSync(path.join(root, 'native/audio-capture/LICENSE'), path.join(stage, 'LICENSE'))
  fs.writeFileSync(path.join(stage, 'README.md'), `# henji-audio-capture

痕迹AI（Henji AI）独立录音程序 \`henji-audio-capture\` 的完整对应源码，按 GNU GPL 第三版（GPL-3.0-only）发布。
痕迹AI 主程序通过进程间通信调用本程序，本程序单独分发、单独授权。

- 应用版本：${version}（标签 \`${tag}\`），同步自痕迹AI 源码提交 \`${commit}\`
- PortAudio ${SOURCES.portaudio.version}（MIT）：\`native/audio-capture/vendor/${SOURCES.portaudio.file}\`，原始地址 ${SOURCES.portaudio.url}，SHA256 \`${SOURCES.portaudio.sha256}\`
- Steinberg ASIO SDK ${SOURCES.asio.version}（选择 GPLv3 许可）：\`native/audio-capture/vendor/${SOURCES.asio.file}\`，原始地址 ${SOURCES.asio.url}，SHA256 \`${SOURCES.asio.sha256}\`

ASIO is a trademark of Steinberg Media Technologies GmbH.

## 构建

需要 Node.js、Rust（stable）、CMake；Windows 需要 MSVC 生成工具。支持 Windows x64 与 macOS arm64。

\`\`\`bash
node scripts/build-audio-capture.cjs
\`\`\`

产物：\`native/audio-capture/target/release/henji-audio-capture(.exe)\`。构建脚本直接使用 \`vendor\` 中随附的压缩包（校验 SHA256 后解压），无需联网。
`)
  run('git', ['add', '-A'], stage)
  const changed = spawnSync('git', ['diff', '--cached', '--quiet'], { cwd: stage }).status !== 0
  if (changed) run('git', ['commit', '-q', '-m', `源码同步：痕迹AI ${version}（${commit.slice(0, 9)}）`], stage)
  const tagged = run('git', ['tag', '--list', tag], stage, true)
  if (!tagged) run('git', ['tag', tag], stage)
  else if (run('git', ['rev-parse', `${tag}^{commit}`], stage, true) !== run('git', ['rev-parse', 'HEAD'], stage, true)) throw new Error(`公开仓库已有标签 ${tag} 且内容不同；请先提升应用版本再同步`)
  if (dryRun) { console.log(`[audio-capture-source] 已在 ${stage} 准备好，未推送`); return }
  run('git', ['push', '-q', 'origin', 'HEAD', '--tags'], stage)
  fs.rmSync(stage, { recursive: true, force: true })
  console.log(`[audio-capture-source] 已同步到 https://github.com/${REPO}（${tag}）`)
}
main().catch(error => { console.error(error); process.exitCode = 1 })
