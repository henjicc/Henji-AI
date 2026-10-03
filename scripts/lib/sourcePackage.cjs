/**
 * GPL 对应源码包（任务 3.3）的纯逻辑：BtbN 构建阶段清单解析、源码包说明与校验和渲染。
 * 由 scripts/build-source-package.cjs 使用；文件名与 resources/licenses/README.txt 共用
 * scripts/lib/distributionNotices.cjs 的 sourcePackageFileNames。
 */

const { PROJECT_REPOSITORY, ffmpegSourceLinks, releaseUrl } = require('./distributionNotices.cjs')

/**
 * 在 BtbN FFmpeg-Builds 源码目录里用 bash 执行：按与发布构建相同的 target/variant/addin 加载 util/vars.sh，
 * 逐个阶段脚本调用 BtbN 自己的 ffbuild_enabled / ffbuild_dockerdl，输出“阶段\t下载命令”（命令各行以 \x1f 分隔）。
 * 只读取 BtbN 自己的判定与下载定义，不复刻其逻辑；下载命令原样记录并执行（见 buildStageFetchScript）。
 */
const BTBN_STAGE_LISTING_SCRIPT = `set -e
source util/vars.sh "$1" "$2" "$3" >/dev/null 2>&1
shopt -s globstar
for STAGE in scripts.d/**/*.sh; do
  (
    SELF="$STAGE"
    STAGENAME="$(basename "$STAGE" | sed 's/.sh$//')"
    source util/dl_functions.sh
    source "$STAGE"
    ffbuild_enabled >/dev/null 2>&1 || exit 0
    printf '%s\\t%s\\n' "$STAGE" "$(ffbuild_dockerdl | tr '\\n' '\\037')"
  )
done
`

/** BtbN 变体名（如 win64-gpl-shared-9.0）拆成 vars.sh 的 target、variant、addin 参数。 */
function btbnVariantArgs(variant) {
  const match = String(variant).match(/^([a-z0-9]+)-((?:gpl|lgpl|nonfree)(?:-shared)?)(?:-(.+))?$/)
  if (!match) throw new Error(`无法识别的 BtbN 变体：${variant}`)
  return [match[1], match[2], match[3] ?? '']
}

function stripQuotes(value) {
  return value.replace(/^(['"])(.*)\1$/, '$2')
}

/** 从一条阶段下载命令中提取源码来源（git-mini-clone / git clone + checkout / svn checkout）。 */
function sourcesOfCommand(command) {
  const sources = []
  for (const match of command.matchAll(/git-mini-clone\s+("[^"]*"|'[^']*'|\S+)\s+("[^"]*"|'[^']*'|\S+)/g)) {
    sources.push({ kind: 'git', repo: stripQuotes(match[1]), ref: stripQuotes(match[2]) })
  }
  for (const match of command.matchAll(/git clone(?:\s+--\S+)*\s+("[^"]*"|'[^']*'|\S+)[^;&]*?(?:&&|;)\s*(?:cd \S+ && |)git(?:\s+-C\s+\S+)?\s+checkout\s+("[^"]*"|'[^']*'|\S+)/g)) {
    sources.push({ kind: 'git', repo: stripQuotes(match[1]), ref: stripQuotes(match[2]) })
  }
  for (const match of command.matchAll(/svn[^;]*?\scheckout[^;]*?['"]?((?:https?|svn):\/\/[^'"\s]+)/g)) {
    const url = match[1]
    const at = url.lastIndexOf('@')
    sources.push({ kind: 'svn', repo: at > 0 ? url.slice(0, at) : url, ref: at > 0 ? url.slice(at + 1) : '' })
  }
  return sources
}

/** 解析 BTBN_STAGE_LISTING_SCRIPT 的输出；没有下载命令的阶段（如 base、finalize）保留但 sources 为空。 */
function parseStageListing(text) {
  return String(text)
    .split(/\r?\n/)
    .filter((line) => line.trim())
    .map((line) => {
      const tab = line.indexOf('\t')
      const stage = (tab >= 0 ? line.slice(0, tab) : line).trim()
      const steps = (tab >= 0 ? line.slice(tab + 1) : '').split(/[\x1f;]/).map((step) => step.trim()).filter(Boolean)
      const command = steps.join(';')
      return { stage, command, steps, sources: sourcesOfCommand(command) }
    })
}

function renderDependencyTsv(stages, { variant, buildScriptsCommit }) {
  const lines = [
    `# BtbN/FFmpeg-Builds ${buildScriptsCommit} — stages enabled for ${variant}`,
    '# stage\tkind\trepository\tref\tdownload command (as defined by the stage script; newlines replaced by ";")',
  ]
  for (const stage of stages) {
    if (!stage.command) continue
    const sources = stage.sources.length ? stage.sources : [{ kind: '', repo: '', ref: '' }]
    for (const source of sources) lines.push([stage.stage, source.kind, source.repo, source.ref, stage.command].join('\t'))
  }
  return `${lines.join('\n')}\n`
}

/**
 * 外部库源码获取（不依赖 Docker）：在 Git for Windows 的 bash 里逐行执行 BtbN 阶段自己的下载命令，
 * 只替换 BtbN 基础镜像里的工具：
 *   - git-mini-clone / retry-tool：与 BtbN images/base 同语义（浅拉取固定提交；退避重试）；
 *   - svn checkout URL@REV：本机无 svn，改用 Git 自带的 git svn clone -r REV（同一修订版内容）；
 *   - meson subprojects download NAME：按 subprojects/NAME.wrap 的 [wrap-git] url/revision 或
 *     [wrap-file] source_url/source_hash（下载后校验 SHA256）获取，不需要安装 meson；
 *   - ./utils/git-sync-deps（Python 脚本）用 $PYTHON 运行，失败如实报告（不沿用 BtbN 的 `|| exit 0`）。
 * 不执行的步骤（只生成构建文件或补历史，不影响源码内容）：./autogen.sh、autoreconf、git fetch --unshallow。
 */
const SKIPPED_STEP_PATTERNS = Object.freeze([
  { pattern: /^\.\/autogen\.sh\b/, reason: '生成构建脚本（非源码）' },
  { pattern: /^autoreconf\b/, reason: '生成构建脚本（非源码）' },
  { pattern: /^git fetch --unshallow\b/, reason: '补全提交历史（不改变源码内容）' },
])

const STAGE_FETCH_PRELUDE = `set -e -o pipefail
export GIT_TERMINAL_PROMPT=0
retry-tool() {
  local delays=(2 5 10 30 60) attempt=0
  until "$@"; do
    if [ $attempt -ge \${#delays[@]} ]; then echo "[fetch] 重试 \${#delays[@]} 次仍失败：$*" >&2; return 1; fi
    echo "[fetch] 失败，\${delays[$attempt]}s 后重试：$*" >&2
    sleep "\${delays[$attempt]}"; attempt=$((attempt + 1))
  done
}
git-mini-clone() {
  local repo="$1" ref="$2" dest="$3"
  git init -q "$dest"
  git -C "$dest" remote add origin "$repo"
  retry-tool git -C "$dest" fetch -q --depth=1 origin "$ref"
  git -C "$dest" -c advice.detachedHead=false checkout -q FETCH_HEAD
}
svn-last-changed() {
  local url="$1" rev="$2" auth=() headers root stub origin path
  [ -n "$3" ] && auth=(-u "$3:")
  headers="$(curl -sS -i -m 60 "\${auth[@]}" -X OPTIONS -H 'Content-Type: text/xml' \\
    --data '<?xml version="1.0" encoding="utf-8"?><D:options xmlns:D="DAV:"><D:activity-collection-set/></D:options>' "$url" | tr -d '\\r')" || return 1
  root="$(printf '%s\\n' "$headers" | sed -n 's/^SVN-Repository-Root: *//Ip' | head -n 1)"
  stub="$(printf '%s\\n' "$headers" | sed -n 's/^SVN-Rev-Root-Stub: *//Ip' | head -n 1)"
  [ -n "$stub" ] || return 1
  origin="$(printf '%s' "$url" | sed -E 's#^(https?://[^/]+).*#\\1#')"
  path="\${url#"$origin"}"; path="\${path#"$root"}"
  curl -sS -m 60 "\${auth[@]}" -X PROPFIND -H 'Depth: 0' -H 'Content-Type: text/xml' \\
    --data '<?xml version="1.0" encoding="utf-8"?><D:propfind xmlns:D="DAV:"><D:prop><D:version-name/></D:prop></D:propfind>' \\
    "$origin$stub/$rev$path" | sed -n 's/.*version-name>\\([0-9][0-9]*\\)<.*/\\1/p' | head -n 1
}
svn() {
  local url="" dest="" user=""
  while [ $# -gt 0 ]; do
    case "$1" in
      --username) user="$2"; shift 2 ;;
      --password) shift 2 ;;
      --non-interactive|-q) shift ;;
      checkout|co) shift ;;
      *) if [ -z "$url" ]; then url="$1"; else dest="$1"; fi; shift ;;
    esac
  done
  local rev="\${url##*@}"; url="\${url%@*}"; dest="\${dest:-.}"
  # git svn clone -r REV 只在该路径于 REV 有改动时才取到内容。先经 Subversion 的 HTTP 协议查出该路径在 REV 时
  # 的最后修改修订版（内容与 REV 相同），只取那一个修订版；查不到再试 REV，最后才从头取到 REV（慢，只多取历史）。
  local fetch_rev changed
  changed="$(svn-last-changed "$url" "$rev" "$user" || true)"
  fetch_rev="\${changed:-$rev}"
  echo "[fetch] svn checkout $url@$rev → git svn clone -r $fetch_rev" >&2
  git svn clone -q \${user:+--username "$user"} -r "$fetch_rev" "$url" "$dest" < /dev/null
  if ! git -C "$dest" rev-parse -q --verify HEAD >/dev/null; then
    rm -rf "$dest"
    git svn clone -q \${user:+--username "$user"} -r "0:$rev" "$url" "$dest" < /dev/null
  fi
  git -C "$dest" rev-parse -q --verify HEAD >/dev/null || { echo "[fetch] svn 修订版 $rev 没有取到内容：$url" >&2; return 1; }
}
wrap-get() {
  awk -v section="[$1]" -v key="$2" '
    /^[[:space:]]*\\[/ { current = $0; gsub(/[[:space:]]/, "", current); next }
    current == section {
      line = $0; name = line; sub(/=.*/, "", name); gsub(/[[:space:]]/, "", name)
      if (name == key) { sub(/^[^=]*=[[:space:]]*/, "", line); sub(/[[:space:]]+$/, "", line); print line; exit }
    }' "$3"
}
meson() {
  if [ "$1 $2" != "subprojects download" ] || [ -z "$3" ]; then echo "[fetch] 不支持的 meson 调用：meson $*" >&2; return 1; fi
  local name="$3" wrap="subprojects/$3.wrap"
  local url rev dir
  url="$(wrap-get wrap-git url "$wrap")"
  if [ -n "$url" ]; then
    rev="$(wrap-get wrap-git revision "$wrap")"
    dir="$(wrap-get wrap-git directory "$wrap")"; dir="\${dir:-$name}"
    git-mini-clone "$url" "$rev" "subprojects/$dir"
    return
  fi
  local source_url source_hash source_name
  source_url="$(wrap-get wrap-file source_url "$wrap")"
  source_hash="$(wrap-get wrap-file source_hash "$wrap")"
  source_name="$(wrap-get wrap-file source_filename "$wrap")"
  if [ -z "$source_url" ] || [ -z "$source_hash" ] || [ -z "$source_name" ]; then echo "[fetch] $wrap 缺少 wrap-git 或完整的 wrap-file 定义" >&2; return 1; fi
  mkdir -p subprojects/packagecache
  retry-tool curl -fsSL -o "subprojects/packagecache/$source_name" "$source_url"
  echo "$source_hash  subprojects/packagecache/$source_name" | sha256sum -c -
}
export -f retry-tool git-mini-clone svn-last-changed svn wrap-get meson
`

/** 把一个阶段的下载步骤变成可在 Git for Windows bash 里执行的脚本；返回脚本与被跳过的步骤。 */
function buildStageFetchScript(steps) {
  const skipped = []
  const lines = [STAGE_FETCH_PRELUDE]
  for (const raw of steps) {
    const skip = SKIPPED_STEP_PATTERNS.find((item) => item.pattern.test(raw))
    if (skip) {
      skipped.push({ step: raw, reason: skip.reason })
      continue
    }
    const step = /^\.\/utils\/git-sync-deps\b/.test(raw)
      ? raw.replace(/^\.\/utils\/git-sync-deps/, '"$PYTHON" ./utils/git-sync-deps').replace(/\s*\|\|\s*exit 0\s*$/, '')
      : raw
    lines.push(`echo ${JSON.stringify(`[fetch] ${step}`).replace(/\$/g, '\\$')} >&2`, step)
  }
  return { script: `${lines.join('\n')}\n`, skipped }
}

/** 安全的阶段归档名：scripts.d/50-librsvg/10-glib.sh → 50-librsvg_10-glib */
function stageArchiveBase(stage) {
  return stage.replace(/^scripts\.d\//, '').replace(/\.sh$/, '').replace(/[\\/]/g, '_')
}

/** GitHub Release 单个附件上限 2GiB；按体积把各阶段归档分组，每组打成一个 tar 附件。 */
function groupIntoParts(entries, limitBytes) {
  const parts = []
  for (const entry of [...entries].sort((left, right) => right.size - left.size)) {
    if (entry.size > limitBytes) throw new Error(`${entry.name} 单个就超过附件上限（${entry.size} 字节）`)
    const part = parts.find((candidate) => candidate.size + entry.size <= limitBytes)
    if (part) {
      part.entries.push(entry)
      part.size += entry.size
    } else parts.push({ entries: [entry], size: entry.size })
  }
  for (const part of parts) part.entries.sort((left, right) => left.name.localeCompare(right.name))
  return parts
}

function renderDependencyFetchStatus(results) {
  const lines = ['# stage\tstatus\tarchive\tbytes\tsha256\tseconds\tnote']
  for (const result of results) {
    lines.push([result.stage, result.status, result.archive ?? '', result.size ?? '', result.sha256 ?? '', result.seconds?.toFixed(1) ?? '', result.note ?? ''].join('\t'))
  }
  return `${lines.join('\n')}\n`
}

function renderChecksums(entries) {
  return `${entries.map((entry) => `${entry.sha256}  ${entry.name}`).join('\n')}\n`
}

function renderSourceReadme({ appVersion, commit, ref, ffmpegBuild, names, stageCount, dependencyParts = [], dependencyFailures = [] }) {
  const links = ffmpegSourceLinks(ffmpegBuild)
  const ffmpegVersion = ffmpegBuild.version.replace(/^n/, '')
  return `痕迹AI ${appVersion} — 对应源码 / Corresponding Source
${releaseUrl(appVersion)}

本目录（GitHub Release 附件）提供痕迹AI ${appVersion} Windows 安装包中 GPL 部分（FFmpeg ${ffmpegVersion} 与
原生视频解码服务 henji-video-decoder.exe）的对应源码，以及本项目全部源码。
This directory (attached to the GitHub Release) provides the Corresponding Source for the GPL parts of the
痕迹AI ${appVersion} Windows installer (FFmpeg ${ffmpegVersion} and henji-video-decoder.exe), plus the full
source of this project.

${names.project}
  本项目源码（git archive，提交 ${commit}${ref && ref !== commit ? `，引用 ${ref}` : ''}），含 native/video-decoder。
  Project source (git archive of ${commit}), including native/video-decoder.
  ${PROJECT_REPOSITORY}/tree/${commit}

${names.projectCargoVendor}
  native/video-decoder 按 Cargo.lock 锁定的全部 Rust 依赖源码（cargo vendor --locked --versioned-dirs）。
  All Rust dependency sources of native/video-decoder as locked by Cargo.lock (cargo vendor).
  使用 / Usage: 解压到 native/video-decoder/vendor，并按 cargo vendor 输出配置 source replacement。

${names.ffmpeg}
  FFmpeg 源码，官方提交 ${ffmpegBuild.sourceCommit}（${ffmpegBuild.version}，release/9.0）。
  FFmpeg source at official commit ${ffmpegBuild.sourceCommit}.
  ${links.commit}

${names.buildScripts}
  BtbN/FFmpeg-Builds 构建脚本，标签 ${ffmpegBuild.releaseTag}（提交 ${ffmpegBuild.buildScriptsCommit}）；
  安装包内的 FFmpeg 预编译包 ${ffmpegBuild.asset}（SHA256 ${ffmpegBuild.sha256}）
  即由该版本脚本构建：./build.sh ${btbnVariantArgs(ffmpegBuild.variant).filter(Boolean).join(' ')}（需要 Docker）。
  scripts.d 下每个阶段脚本固定了外部库的源码仓库与提交；./download.sh 会按这些定义下载全部外部库源码。
  BtbN/FFmpeg-Builds build scripts that produced the bundled FFmpeg package; scripts.d pins every external
  library, and ./download.sh downloads all of their sources (requires Docker).
  ${links.buildScripts}

${names.dependencies}
  由上述构建脚本对 ${ffmpegBuild.variant} 启用的 ${stageCount} 个构建阶段及其源码仓库、提交与原始下载命令
  （用 BtbN 自己的 ffbuild_enabled / ffbuild_dockerdl 求值得到）。
  The ${stageCount} build stages enabled for ${ffmpegBuild.variant}, with their source repository, commit and
  download command, evaluated with BtbN's own ffbuild_enabled / ffbuild_dockerdl.

${dependencyParts.length ? dependencyParts.join('\n') : `${names.dependencySourcesPrefix}*.tar（未生成 / not generated）`}
  上述各阶段外部库的源码：每个阶段一个 <阶段>.tar.gz（按 BtbN 该阶段的下载命令取得，不含 .git），按 GitHub 附件
  2GiB 上限分组打成 tar。获取状态与每个归档的 SHA256 见 ${names.dependencyStatus}。
  Sources of the external libraries of the stages above, one <stage>.tar.gz per stage (fetched with the stage's
  own BtbN download command, without .git), grouped into tar parts below the 2 GiB asset limit. Fetch status and
  per-archive SHA256: ${names.dependencyStatus}.
${dependencyFailures.length ? `  未能取得 / Not fetched:\n${dependencyFailures.map((item) => `    ${item.stage}: ${item.note}`).join('\n')}\n` : ''}
${names.checksums}
  以上文件的 SHA256。 / SHA256 of the files above.
`
}

module.exports = {
  BTBN_STAGE_LISTING_SCRIPT,
  btbnVariantArgs,
  buildStageFetchScript,
  groupIntoParts,
  parseStageListing,
  renderDependencyFetchStatus,
  stageArchiveBase,
  renderChecksums,
  renderDependencyTsv,
  renderSourceReadme,
  sourcesOfCommand,
}
