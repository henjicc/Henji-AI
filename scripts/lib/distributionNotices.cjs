/**
 * 随安装包分发的许可说明文件（任务 3.3，纯逻辑，供 scripts/generate-third-party-licenses.cjs、
 * scripts/build-source-package.cjs、打包后核对与测试共用）。
 *
 * resources/licenses/ 下的分发文件（electron-builder.yml extraResources → 安装目录 resources/resources/licenses/）：
 *   README.txt                       许可概要、FFmpeg 与原生服务说明、对应源码获取方式、专利说明（中英）
 *   LICENSE.txt                      本项目 Apache-2.0 全文
 *   THIRD-PARTY-NOTICES.txt          第三方组件清单与许可全文（与“设置 → 关于”同一份数据）
 *   ffmpeg/COPYING.GPLv3.txt         FFmpeg GPLv3 全文（BtbN 包内 LICENSE.txt 原样）              仅 Windows
 *   ffmpeg/BUILD-INFO.txt            BtbN 构建信息：版本、来源、SHA256、configure 输出、随包文件哈希 仅 Windows
 *   henji-video-decoder/NOTICE.txt   原生视频解码服务许可声明（链接 GPL 库，整体按 GPL-3.0-or-later 分发） 仅 Windows
 * third-party-licenses.json 与 .inputs.sha256 只供构建/界面使用，不随包。
 *
 * 许可口径以重要记录 014 为准：Windows 统一 BtbN FFmpeg 9.0 win64-gpl-shared（GPLv3、无 nonfree），
 * 原生解码服务与 CLI 同包，按 GPL 分发；项目其余部分 Apache-2.0。
 */

const PROJECT_REPOSITORY = 'https://github.com/henjicc/Henji-AI'
const COPYRIGHT = 'Copyright © 2026 Henji AI'

const DISTRIBUTED_LICENSE_FILES = Object.freeze({
  readme: 'README.txt',
  projectLicense: 'LICENSE.txt',
  notices: 'THIRD-PARTY-NOTICES.txt',
  ffmpegLicense: 'ffmpeg/COPYING.GPLv3.txt',
  ffmpegBuildInfo: 'ffmpeg/BUILD-INFO.txt',
  videoDecoderNotice: 'henji-video-decoder/NOTICE.txt',
})
/** 仅在 Windows 分发（原生解码服务与统一 FFmpeg 只在 Windows，重要记录 005/014）。 */
const WINDOWS_ONLY_LICENSE_FILES = Object.freeze([
  DISTRIBUTED_LICENSE_FILES.ffmpegLicense,
  DISTRIBUTED_LICENSE_FILES.ffmpegBuildInfo,
  DISTRIBUTED_LICENSE_FILES.videoDecoderNotice,
])
/** resources/licenses 下只供构建与界面使用、不进安装包的文件。 */
const BUILD_ONLY_LICENSE_FILES = Object.freeze(['third-party-licenses.json', '.inputs.sha256'])

function expectedLicenseFiles(platform) {
  const all = Object.values(DISTRIBUTED_LICENSE_FILES)
  return platform === 'win32' ? all : all.filter((file) => !WINDOWS_ONLY_LICENSE_FILES.includes(file))
}

/** GitHub Release 附带的对应源码文件名（scripts/build-source-package.cjs 产出，README 引用同一组名字）。 */
function sourcePackageFileNames({ version, ffmpegBuild }) {
  const ffmpegVersion = ffmpegBuild.version.replace(/^n/, '')
  return {
    project: `henji-ai-${version}-src.tar.gz`,
    projectCargoVendor: `henji-ai-${version}-video-decoder-cargo-vendor.tar.gz`,
    ffmpeg: `ffmpeg-${ffmpegVersion}-src.tar.gz`,
    buildScripts: `ffmpeg-builds-${ffmpegBuild.releaseTag}-src.tar.gz`,
    dependencies: `ffmpeg-${ffmpegVersion}-dependencies.tsv`,
    // 外部库源码按 2GiB 附件上限分组：<前缀>.part1.tar、.part2.tar…；获取状态与逐阶段 SHA256 在 dependencyStatus。
    dependencySourcesPrefix: `ffmpeg-${ffmpegVersion}-dependency-sources`,
    dependencyStatus: `ffmpeg-${ffmpegVersion}-dependency-sources.tsv`,
    readme: `henji-ai-${version}-SOURCE-README.txt`,
    checksums: `henji-ai-${version}-SHA256SUMS.txt`,
  }
}

function releaseUrl(version) {
  return `${PROJECT_REPOSITORY}/releases/tag/v${version}`
}

function ffmpegSourceLinks(ffmpegBuild) {
  return {
    commit: `https://github.com/FFmpeg/FFmpeg/commit/${ffmpegBuild.sourceCommit}`,
    officialGit: 'https://git.ffmpeg.org/ffmpeg.git',
    buildScripts: `https://github.com/BtbN/FFmpeg-Builds/tree/${ffmpegBuild.releaseTag}`,
    buildScriptsCommit: `https://github.com/BtbN/FFmpeg-Builds/commit/${ffmpegBuild.buildScriptsCommit}`,
  }
}

/** 从 `ffmpeg -version` 输出取 configure 参数并核对许可：必须 --enable-gpl --enable-version3，不得 --enable-nonfree。 */
function inspectFfmpegConfiguration(versionOutput) {
  const configuration = String(versionOutput ?? '').match(/^configuration:\s*(.*)$/m)?.[1]?.trim() ?? null
  const flags = new Set((configuration ?? '').split(/\s+/).filter(Boolean))
  const libraryVersion = String(versionOutput ?? '').match(/^ffmpeg version (\S+)/m)?.[1] ?? null
  const problems = []
  if (!configuration) problems.push('ffmpeg -version 输出中没有 configuration 行')
  else {
    if (!flags.has('--enable-gpl')) problems.push('构建配置缺少 --enable-gpl（与重要记录 014 的 GPL 构建不符）')
    if (!flags.has('--enable-version3')) problems.push('构建配置缺少 --enable-version3（应为 GPL 第 3 版）')
    if (flags.has('--enable-nonfree')) problems.push('构建配置含 --enable-nonfree（不可再分发）')
  }
  return { configuration, libraryVersion, gpl: flags.has('--enable-gpl'), version3: flags.has('--enable-version3'), nonfree: flags.has('--enable-nonfree'), problems }
}

function formatBytes(bytes) {
  return bytes.toLocaleString('en-US')
}

function renderFfmpegBuildInfo({ ffmpegBuild, url, versionOutput, licenseOutput, files }) {
  const inspected = inspectFfmpegConfiguration(versionOutput)
  const links = ffmpegSourceLinks(ffmpegBuild)
  const width = Math.max(...files.map((file) => file.name.length), 10)
  const lines = [
    'FFmpeg build information / FFmpeg 构建信息',
    '='.repeat(80),
    '',
    `Version:         ${ffmpegBuild.version}${inspected.libraryVersion ? ` (library reports ${inspected.libraryVersion})` : ''}`,
    `License:         GPL-3.0-or-later (--enable-gpl --enable-version3${inspected.nonfree ? ', --enable-nonfree PRESENT' : ', no --enable-nonfree'})`,
    `Source commit:   ${ffmpegBuild.sourceCommit}`,
    `                 ${links.commit}`,
    `                 ${links.officialGit}`,
    `Built by:        BtbN/FFmpeg-Builds, variant ${ffmpegBuild.variant}`,
    `Build scripts:   tag ${ffmpegBuild.releaseTag}, commit ${ffmpegBuild.buildScriptsCommit}`,
    `                 ${links.buildScripts}`,
    `Package:         ${ffmpegBuild.asset}`,
    `Download:        ${url}`,
    `Package size:    ${formatBytes(ffmpegBuild.size)} bytes`,
    `Package SHA256:  ${ffmpegBuild.sha256}`,
    '',
    'Distributed files (resources/video-decoder/ in the installation directory):',
    ...files.map((file) => `  ${file.name.padEnd(width)}  ${formatBytes(file.size).padStart(13)} bytes  sha256 ${file.sha256}`),
    '',
    '-'.repeat(80),
    '$ ffmpeg -version',
    '-'.repeat(80),
    String(versionOutput ?? '').trimEnd(),
    '',
    '-'.repeat(80),
    '$ ffmpeg -L',
    '-'.repeat(80),
    String(licenseOutput ?? '').trimEnd(),
    '',
  ]
  return { text: `${lines.join('\n')}\n`, inspected }
}

function renderVideoDecoderNotice({ appVersion, ffmpegBuild }) {
  const ffmpegVersion = ffmpegBuild.version.replace(/^n/, '')
  return `henji-video-decoder — 痕迹AI 原生视频解码服务 / Henji-AI native video decoding service
Version ${appVersion}
${COPYRIGHT}

【中文】
henji-video-decoder.exe 的源代码是痕迹AI项目的一部分（${PROJECT_REPOSITORY} ，目录 native/video-decoder），
按 Apache License 2.0 发布。

本程序动态链接 FFmpeg ${ffmpegVersion} 的 GPL 构建（libavcodec、libavformat、libavutil、libswscale、libswresample，
BtbN/FFmpeg-Builds ${ffmpegBuild.variant}），因此本可执行文件作为一个整体，按 GNU 通用公共许可证第 3 版
或（由您选择）任何更新版本（GPL-3.0-or-later）分发。Apache License 2.0 与 GPLv3 兼容。
GPL 全文见 ../ffmpeg/COPYING.GPLv3.txt；FFmpeg 构建信息见 ../ffmpeg/BUILD-INFO.txt；
本程序与 FFmpeg 的对应源码获取方式见 ../README.txt 第四节。

本程序按“原样”提供，不附带任何担保；在适用法律允许的范围内，不提供适销性或特定用途适用性的默示担保。
详见 GPL 第 15、16 条。

本程序使用的 Rust 依赖（ffmpeg-sys-next、windows、serde、serde_json 等）的许可见 ../THIRD-PARTY-NOTICES.txt。

[English]
The source code of henji-video-decoder.exe is part of the Henji-AI project (${PROJECT_REPOSITORY},
directory native/video-decoder) and is released under the Apache License 2.0.

This program dynamically links a GPL build of FFmpeg ${ffmpegVersion} (libavcodec, libavformat, libavutil,
libswscale, libswresample; BtbN/FFmpeg-Builds ${ffmpegBuild.variant}). The executable as a whole is
therefore distributed under the GNU General Public License version 3 or (at your option) any later
version (GPL-3.0-or-later). The Apache License 2.0 is compatible with GPLv3.
See ../ffmpeg/COPYING.GPLv3.txt for the GPL text, ../ffmpeg/BUILD-INFO.txt for the FFmpeg build,
and section 4 of ../README.txt for how to obtain the Corresponding Source.

This program is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY; without even
the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See sections 15 and 16 of
the GNU General Public License for more details.

Licenses of the Rust dependencies (ffmpeg-sys-next, windows, serde, serde_json, ...) are listed in
../THIRD-PARTY-NOTICES.txt.
`
}

function renderLicenseReadme({ productName, appVersion, platform, ffmpegBuild }) {
  const windows = platform === 'win32' && ffmpegBuild
  const header = `${productName} ${appVersion} — 许可与源码说明 / License and Source Code Information
${COPYRIGHT}
`
  const zhProject = `【中文】

一、本软件
${productName}（Henji-AI）以 Apache License 2.0 开源，全文见 LICENSE.txt。
项目源码：${PROJECT_REPOSITORY}

二、第三方组件
THIRD-PARTY-NOTICES.txt 列出随本软件分发的第三方组件、版本、许可证与许可全文，
与软件内“设置 → 关于 → 第三方组件”为同一份清单。Chromium 与 Node.js 的许可见安装目录下的
LICENSES.chromium.html。
`
  if (!windows) {
    return `${header}
${zhProject}
[English]

1. This software
${productName} (Henji-AI) is open source under the Apache License 2.0; see LICENSE.txt.
Source code: ${PROJECT_REPOSITORY}

2. Third-party components
THIRD-PARTY-NOTICES.txt lists the bundled third-party components with their versions, licenses and
license texts (the same list as Settings → About → Third-party components). Chromium and Node.js
licenses are in LICENSES.chromium.html in the installation directory.
`
  }
  const ffmpegVersion = ffmpegBuild.version.replace(/^n/, '')
  const links = ffmpegSourceLinks(ffmpegBuild)
  const names = sourcePackageFileNames({ version: appVersion, ffmpegBuild })
  const release = releaseUrl(appVersion)
  return `${header}
${zhProject}
三、FFmpeg 与原生视频解码服务（Windows）
- 安装目录 resources/resources/video-decoder/ 内的 FFmpeg 库（avcodec、avformat、avutil、avfilter、avdevice、
  swscale、swresample）与 ffmpeg.exe、ffprobe.exe，是 BtbN/FFmpeg-Builds 预编译的 FFmpeg ${ffmpegVersion}
  （${ffmpegBuild.variant}），未经修改，按 GNU 通用公共许可证第 3 版或任何更新版本（GPL-3.0-or-later）授权；
  构建配置为 --enable-gpl --enable-version3，未启用 --enable-nonfree。
  许可全文：ffmpeg/COPYING.GPLv3.txt；构建信息（版本、来源、SHA256、configure 输出）：ffmpeg/BUILD-INFO.txt。
- henji-video-decoder.exe（原生视频解码服务）的源码属于本项目、按 Apache-2.0 发布；因其动态链接上述 GPL
  FFmpeg 库，该可执行文件整体按 GPL-3.0-or-later 分发，见 henji-video-decoder/NOTICE.txt。
- 本软件其他部分以独立进程方式启动 ffmpeg.exe、ffprobe.exe 与原生视频解码服务，通过命令行与进程间消息通信，
  不链接 FFmpeg 库，仍按 Apache-2.0 授权。

四、对应源码获取方式
1. FFmpeg 源码：FFmpeg 官方仓库提交 ${ffmpegBuild.sourceCommit}（${ffmpegBuild.version}，release/9.0 分支）
   ${links.commit}
   ${links.officialGit}
2. FFmpeg 构建脚本与外部库版本：BtbN/FFmpeg-Builds 标签 ${ffmpegBuild.releaseTag}
   （提交 ${ffmpegBuild.buildScriptsCommit}）
   ${links.buildScripts}
   其中 scripts.d 固定了每个外部库（x264、x265、dav1d 等）的源码仓库与提交，download.sh 可下载全部外部库源码。
3. 本项目源码（含原生视频解码服务 native/video-decoder）：${PROJECT_REPOSITORY}/tree/v${appVersion}
4. 本版本的 GitHub Release（${release}）附带上述源码的打包文件：
   ${names.project}、${names.projectCargoVendor}、${names.ffmpeg}、
   ${names.buildScripts}、${names.dependencies}、
   ${names.dependencySourcesPrefix}.part*.tar（各外部库源码）、${names.dependencyStatus}、
   ${names.readme}、${names.checksums}。

五、专利说明
FFmpeg 实现的部分音视频格式（如 H.264/AVC、HEVC/H.265、AAC、AC-3 等）在部分国家或地区可能受专利保护。
本软件与 FFmpeg 的许可证不授予第三方（如专利池许可方）所持有专利的许可。

[English]

1. This software
${productName} (Henji-AI) is open source under the Apache License 2.0; see LICENSE.txt.
Source code: ${PROJECT_REPOSITORY}

2. Third-party components
THIRD-PARTY-NOTICES.txt lists the bundled third-party components with their versions, licenses and
license texts (the same list as Settings → About → Third-party components). Chromium and Node.js
licenses are in LICENSES.chromium.html in the installation directory.

3. FFmpeg and the native video decoding service (Windows)
- The FFmpeg libraries (avcodec, avformat, avutil, avfilter, avdevice, swscale, swresample), ffmpeg.exe and
  ffprobe.exe in resources/resources/video-decoder/ are the unmodified BtbN/FFmpeg-Builds FFmpeg
  ${ffmpegVersion} (${ffmpegBuild.variant}) build, licensed under the GNU General Public License version 3
  or any later version (GPL-3.0-or-later); configured with --enable-gpl --enable-version3 and without
  --enable-nonfree. License text: ffmpeg/COPYING.GPLv3.txt. Build information (version, origin, SHA256,
  configure output): ffmpeg/BUILD-INFO.txt.
- The source code of henji-video-decoder.exe is part of this project (Apache-2.0). Because it dynamically
  links the GPL FFmpeg libraries above, the executable as a whole is distributed under GPL-3.0-or-later;
  see henji-video-decoder/NOTICE.txt.
- The rest of this software runs ffmpeg.exe, ffprobe.exe and the native video decoding service as
  separate processes, communicating through command lines and inter-process messages without linking the
  FFmpeg libraries, and remains licensed under Apache-2.0.

4. Obtaining the Corresponding Source
1. FFmpeg source: official FFmpeg commit ${ffmpegBuild.sourceCommit} (${ffmpegBuild.version}, release/9.0)
   ${links.commit}
   ${links.officialGit}
2. FFmpeg build scripts and external library versions: BtbN/FFmpeg-Builds tag ${ffmpegBuild.releaseTag}
   (commit ${ffmpegBuild.buildScriptsCommit})
   ${links.buildScripts}
   scripts.d pins the source repository and commit of every external library (x264, x265, dav1d, ...);
   download.sh fetches all of their sources.
3. Source of this project, including the native video decoding service (native/video-decoder):
   ${PROJECT_REPOSITORY}/tree/v${appVersion}
4. The GitHub Release of this version (${release}) carries archives of the sources above:
   ${names.project}, ${names.projectCargoVendor}, ${names.ffmpeg},
   ${names.buildScripts}, ${names.dependencies},
   ${names.dependencySourcesPrefix}.part*.tar (external library sources), ${names.dependencyStatus},
   ${names.readme}, ${names.checksums}.

5. Patents
Some audio and video formats implemented by FFmpeg (such as H.264/AVC, HEVC/H.265, AAC and AC-3) may be
covered by patents in some countries or regions. Neither the license of this software nor the FFmpeg
license grants a license under patents held by third parties (such as patent pool licensors).
`
}

module.exports = {
  BUILD_ONLY_LICENSE_FILES,
  COPYRIGHT,
  DISTRIBUTED_LICENSE_FILES,
  PROJECT_REPOSITORY,
  WINDOWS_ONLY_LICENSE_FILES,
  expectedLicenseFiles,
  ffmpegSourceLinks,
  inspectFfmpegConfiguration,
  releaseUrl,
  renderFfmpegBuildInfo,
  renderLicenseReadme,
  renderVideoDecoderNotice,
  sourcePackageFileNames,
}
