/**
 * 第三方许可清单的收集与渲染（纯逻辑，供 scripts/generate-third-party-licenses.cjs 与测试共用）。
 *
 * 数据来源全部取自实际随包内容，不手工维护名单：
 *   - npm：`npm ls --omit=dev --all --json --long`（npm 自带的 Arborist 依赖树，含 workspace 与嵌套版本）；
 *   - Rust：`cargo metadata --filter-platform <目标三元组>` 的解析结果，只沿普通依赖（不含 dev/build 依赖）；
 *   - 随包二进制：Electron（含 Chromium、Node.js）、FFmpeg（BtbN 包内 LICENSE.txt 与构建配置）、
 *     libvips（sharp 平台包的 versions.json）、SQLite（better-sqlite3 内置源码头）。
 * 许可全文优先取组件自带文件；组件未附带时才回退为标准文本，并在数据里标明来源。
 */

const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')

const FORMAT_VERSION = 1
const MAX_LICENSE_FILE_BYTES = 512 * 1024
/** LICENSE、LICENSE.md、LICENSE-MIT、license-apache-2.0、COPYING、NOTICE、UNLICENSE 等 */
const LICENSE_FILE_PATTERN = /^(licen[cs]e|copying|notice|unlicense)([-._ ].*)?$/i
const COPYLEFT_PATTERN = /(^|[^A-Za-z])(A?GPL|LGPL|MPL|EPL|CDDL|EUPL)([^A-Za-z]|$)/

/** 与 electron-builder.yml 保持一致：这些 npm 包在对应平台不随安装包分发。 */
const PLATFORM_EXCLUDED_NPM_PACKAGES = Object.freeze({
  win32: ['ffmpeg-ffprobe-static'],
})
/** 第一方包（本仓库 workspace 发布的 SDK）不算第三方，但其依赖照常收录。 */
const FIRST_PARTY_SCOPES = ['@henjicc/']

/** 与 electron-builder.yml 保持一致：原生服务及其随包平台。 */
const NATIVE_CRATES = Object.freeze([
  { dir: 'native/audio-worker', platforms: null },
  { dir: 'native/video-decoder', platforms: ['win32'] },
])

const RUST_TARGETS = Object.freeze({
  'win32-x64': 'x86_64-pc-windows-msvc',
  'win32-arm64': 'aarch64-pc-windows-msvc',
  'darwin-x64': 'x86_64-apple-darwin',
  'darwin-arm64': 'aarch64-apple-darwin',
  'linux-x64': 'x86_64-unknown-linux-gnu',
  'linux-arm64': 'aarch64-unknown-linux-gnu',
})

const MIT_BODY = `Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.`

const ISC_BODY = `Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted, provided that the above
copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR
ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN
ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF
OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.`

const BSD_CONDITIONS_HEAD = `Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice, this
   list of conditions and the following disclaimer.

2. Redistributions in binary form must reproduce the above copyright notice,
   this list of conditions and the following disclaimer in the documentation
   and/or other materials provided with the distribution.`

const BSD_3_CLAUSE = `

3. Neither the name of the copyright holder nor the names of its
   contributors may be used to endorse or promote products derived from
   this software without specific prior written permission.`

const BSD_DISCLAIMER = `

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.`

const WTFPL_TEXT = `            DO WHAT THE FUCK YOU WANT TO PUBLIC LICENSE
                    Version 2, December 2004

 Copyright (C) 2004 Sam Hocevar <sam@hocevar.net>

 Everyone is permitted to copy and distribute verbatim or modified
 copies of this license document, and changing it is allowed as long
 as the name is changed.

            DO WHAT THE FUCK YOU WANT TO PUBLIC LICENSE
   TERMS AND CONDITIONS FOR COPYING, DISTRIBUTION AND MODIFICATION

  0. You just DO WHAT THE FUCK YOU WANT TO.`

function copyrightLine(author) {
  return author ? `Copyright (c) ${author}` : 'Copyright (c) the respective authors'
}

/**
 * 组件未附带许可文件时的标准文本。只覆盖条款固定、不需要额外信息的许可；
 * Apache-2.0 / LGPL-3.0 / GPL-3.0 由调用方传入实际文件内容（项目 LICENSE、参考文本、FFmpeg 包内文本）。
 */
function standardLicenseText(licenseId, author, referenceTexts) {
  switch (licenseId) {
    case 'MIT':
      return `MIT License\n\n${copyrightLine(author)}\n\n${MIT_BODY}`
    case 'ISC':
      return `ISC License\n\n${copyrightLine(author)}\n\n${ISC_BODY}`
    case '0BSD':
      return `Zero-Clause BSD\n\n${copyrightLine(author)}\n\n${ISC_BODY}`
    case 'BSD-2-Clause':
      return `BSD 2-Clause License\n\n${copyrightLine(author)}\n\n${BSD_CONDITIONS_HEAD}${BSD_DISCLAIMER}`
    case 'WTFPL':
      return WTFPL_TEXT
    case 'BSD-3-Clause':
      return `BSD 3-Clause License\n\n${copyrightLine(author)}\n\n${BSD_CONDITIONS_HEAD}${BSD_3_CLAUSE}${BSD_DISCLAIMER}`
    default: {
      const family = licenseId.replace(/-(only|or-later)$/, '').replace(/\+$/, '')
      return referenceTexts?.[family] ?? null
    }
  }
}

function licenseIdsOf(expression) {
  if (!expression) return []
  return expression
    .replace(/[()]/g, ' ')
    .split(/\s+(?:OR|AND|WITH)\s+|\s+/i)
    .map((part) => part.trim())
    .filter((part) => part && !/^(OR|AND|WITH)$/i.test(part))
}

/** 许可表达式是否要求随附源码获取方式（GPL/LGPL/AGPL/MPL 等）。存在宽松许可的 OR 选项时按宽松许可处理。 */
function isCopyleft(expression) {
  if (!expression || !COPYLEFT_PATTERN.test(expression)) return false
  if (/\sAND\s/i.test(expression)) return true
  const alternatives = expression.replace(/[()]/g, '').split(/\s+OR\s+/i)
  return alternatives.every((alternative) => COPYLEFT_PATTERN.test(alternative))
}

/** npm 旧写法（licenses 数组、{type}）与 Cargo 旧写法（MIT/Apache-2.0）统一为 SPDX 表达式。 */
function normalizeLicenseExpression(value) {
  if (!value) return null
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed) return null
    return /\//.test(trimmed) && !/\s/.test(trimmed) ? trimmed.split('/').join(' OR ') : trimmed
  }
  if (Array.isArray(value)) {
    const parts = value.map((item) => normalizeLicenseExpression(item)).filter(Boolean)
    if (parts.length === 0) return null
    return parts.length === 1 ? parts[0] : `(${parts.join(' OR ')})`
  }
  if (typeof value === 'object' && typeof value.type === 'string') return normalizeLicenseExpression(value.type)
  return null
}

function normalizeAuthor(author) {
  if (!author) return null
  if (typeof author === 'string') return author.replace(/\s*[<(].*$/, '').trim() || null
  if (typeof author === 'object' && typeof author.name === 'string') return author.name.trim() || null
  return null
}

/** 仓库地址统一成可点击的 https 链接；无法识别时返回 null，不拼猜测地址。 */
function normalizeRepositoryUrl(repository) {
  const raw = typeof repository === 'string'
    ? repository
    : repository && typeof repository === 'object' && typeof repository.url === 'string' ? repository.url : null
  if (!raw) return null
  let url = raw.trim()
  const shorthand = url.match(/^(github|gitlab|bitbucket):(.+)$/)
  if (shorthand) url = `https://${shorthand[1]}.${shorthand[1] === 'bitbucket' ? 'org' : 'com'}/${shorthand[2]}`
  else if (/^[\w.-]+\/[\w.-]+$/.test(url)) url = `https://github.com/${url}`
  url = url
    .replace(/^git\+/, '')
    .replace(/^git:\/\//, 'https://')
    .replace(/^ssh:\/\/git@/, 'https://')
    .replace(/^git@([^:]+):/, 'https://$1/')
    .replace(/\.git$/, '')
    .replace(/\/+$/, '')
  if (typeof repository === 'object' && repository && typeof repository.directory === 'string' && /github\.com/.test(url)) {
    url = `${url}/tree/HEAD/${repository.directory.replace(/^\/+/, '')}`
  }
  return /^https?:\/\//.test(url) ? url : null
}

function normalizeHomepage(value) {
  return typeof value === 'string' && /^https?:\/\//.test(value.trim()) ? value.trim().replace(/#readme$/, '') : null
}

function normalizeText(text) {
  return text.replace(/^﻿/, '').replace(/\r\n?/g, '\n').replace(/[ \t]+$/gm, '').trim()
}

/** 读取组件目录里的许可文件（按文件名排序，跳过目录与超大文件）。 */
function readLicenseFiles(dir) {
  let names = []
  try {
    names = fs.readdirSync(dir)
  } catch {
    return []
  }
  return names
    .filter((name) => LICENSE_FILE_PATTERN.test(name))
    .sort((left, right) => left.localeCompare(right))
    .flatMap((name) => {
      const file = path.join(dir, name)
      try {
        const stat = fs.statSync(file)
        if (!stat.isFile() || stat.size === 0 || stat.size > MAX_LICENSE_FILE_BYTES) return []
        const text = normalizeText(fs.readFileSync(file, 'utf8'))
        return text ? [text] : []
      } catch {
        return []
      }
    })
}

function readJsonFile(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return null
  }
}

/** npm `os` / `cpu` 字段语义：可含 `!xxx` 排除项；为空表示不限。 */
function matchesPlatformList(list, value) {
  if (!Array.isArray(list) || list.length === 0) return true
  const negated = list.filter((item) => typeof item === 'string' && item.startsWith('!')).map((item) => item.slice(1))
  if (negated.includes(value)) return false
  const positive = list.filter((item) => typeof item === 'string' && !item.startsWith('!'))
  return positive.length === 0 || positive.includes(value)
}

/**
 * 从 `npm ls --omit=dev --all --json --long` 的依赖树收集随包 npm 组件。
 * 跳过：未安装的可选依赖、目标平台不可用的平台包（os/cpu）、平台排除名单、第一方包本身。
 */
function collectNpmPackages(tree, { platform, arch, readPackageJson = (dir) => readJsonFile(path.join(dir, 'package.json')) }) {
  const excluded = new Set(PLATFORM_EXCLUDED_NPM_PACKAGES[platform] ?? [])
  const result = new Map()
  const visited = new Set()
  const walk = (node) => {
    for (const [name, child] of Object.entries(node?.dependencies ?? {})) {
      if (!child || typeof child !== 'object' || !child.version || !child.path) continue
      if (excluded.has(name)) continue
      const key = `${name}@${child.version}`
      if (visited.has(`${key}|${child.path}`)) continue
      visited.add(`${key}|${child.path}`)
      const pkg = readPackageJson(child.path) ?? {}
      if (!matchesPlatformList(child.os ?? pkg.os, platform) || !matchesPlatformList(child.cpu ?? pkg.cpu, arch)) continue
      const firstParty = FIRST_PARTY_SCOPES.some((scope) => name.startsWith(scope))
      if (!firstParty && !result.has(key)) {
        result.set(key, {
          name,
          version: child.version,
          license: normalizeLicenseExpression(pkg.license ?? pkg.licenses ?? child.license),
          author: normalizeAuthor(pkg.author),
          homepage: normalizeHomepage(pkg.homepage),
          repository: normalizeRepositoryUrl(pkg.repository ?? child.repository),
          dir: child.path,
        })
      }
      walk(child)
    }
  }
  walk(tree)
  return [...result.values()]
}

/** 从 `cargo metadata` 结果沿普通依赖收集随包 crate（排除工作区成员本身）。 */
function collectCargoPackages(metadata) {
  const packages = new Map(metadata.packages.map((pkg) => [pkg.id, pkg]))
  const nodes = new Map((metadata.resolve?.nodes ?? []).map((node) => [node.id, node]))
  const members = new Set(metadata.workspace_members ?? [])
  const seen = new Set()
  const queue = metadata.resolve?.root ? [metadata.resolve.root] : [...members]
  while (queue.length > 0) {
    const node = nodes.get(queue.pop())
    for (const dep of node?.deps ?? []) {
      const normal = (dep.dep_kinds ?? []).some((kind) => kind.kind === null || kind.kind === undefined)
      if (!normal || seen.has(dep.pkg)) continue
      seen.add(dep.pkg)
      queue.push(dep.pkg)
    }
  }
  return [...seen]
    .filter((id) => !members.has(id))
    .map((id) => packages.get(id))
    .filter(Boolean)
    .map((pkg) => {
      const dir = path.dirname(pkg.manifest_path)
      return {
        name: pkg.name,
        version: pkg.version,
        license: normalizeLicenseExpression(pkg.license),
        licenseFile: pkg.license_file ? path.resolve(dir, pkg.license_file) : null,
        author: Array.isArray(pkg.authors) && pkg.authors.length > 0 ? normalizeAuthor(pkg.authors.join(', ')) : null,
        homepage: normalizeHomepage(pkg.homepage),
        repository: normalizeRepositoryUrl(pkg.repository),
        dir,
      }
    })
}

/** FFmpeg 构建配置里启用的外部库（`--enable-libx264` → `x264`），按出现顺序去重。 */
function parseFfmpegExternalLibraries(versionOutput) {
  const names = [...String(versionOutput ?? '').matchAll(/--enable-lib([\w-]+)/g)].map((match) => match[1])
  return [...new Set(names)]
}

function sqliteVersionFromHeader(header) {
  return String(header ?? '').match(/#define\s+SQLITE_VERSION\s+"([^"]+)"/)?.[1] ?? null
}

/** sqlite3.h 开头那段“祝福”声明（SQLite 的公有领域声明原文）。 */
function sqliteBlessingFromHeader(header) {
  const block = String(header ?? '').match(/\/\*([\s\S]*?)\*{5,}/)?.[1]
  if (!block) return null
  const text = block.split('\n').map((line) => line.replace(/^\*\*\s?/, '')).join('\n')
  return normalizeText(text)
}

/** 许可全文去重表：同一段文本只存一份，组件按 id 引用。 */
function createTextTable() {
  const texts = {}
  return {
    texts,
    add(text) {
      const normalized = normalizeText(text)
      if (!normalized) return null
      const id = `t${crypto.createHash('sha256').update(normalized).digest('hex').slice(0, 12)}`
      texts[id] = normalized
      return id
    },
  }
}

/**
 * 普通依赖（npm / crate）→ 清单条目。许可文件优先；没有时按许可表达式回退标准文本。
 */
function toComponent(ecosystem, pkg, textTable, referenceTexts) {
  const fileTexts = readLicenseFiles(pkg.dir)
  // Cargo 的 license-file 可以指向不符合常见命名或不在包根目录的文件，单独补读。
  const declaredFile = pkg.licenseFile
  if (declaredFile && !(path.dirname(declaredFile) === pkg.dir && LICENSE_FILE_PATTERN.test(path.basename(declaredFile)))) {
    try {
      const text = normalizeText(fs.readFileSync(declaredFile, 'utf8'))
      if (text) fileTexts.push(text)
    } catch {
      // 声明了但文件缺失：按没有许可文件处理，回退标准文本。
    }
  }
  let textOrigin = 'package'
  let textIds = fileTexts.map((text) => textTable.add(text)).filter(Boolean)
  if (textIds.length === 0) {
    const standard = licenseIdsOf(pkg.license)
      .map((id) => standardLicenseText(id, pkg.author, referenceTexts))
      .find(Boolean)
    textIds = standard ? [textTable.add(standard)] : []
    textOrigin = standard ? 'standard' : 'none'
  }
  const homepage = pkg.homepage ?? pkg.repository ?? (ecosystem === 'cargo'
    ? `https://crates.io/crates/${pkg.name}`
    : `https://www.npmjs.com/package/${pkg.name}`)
  const component = {
    id: `${ecosystem}:${pkg.name}@${pkg.version}`,
    name: pkg.name,
    version: pkg.version,
    license: pkg.license,
    ecosystem,
    homepage,
    textIds,
    textOrigin,
  }
  if (isCopyleft(pkg.license)) {
    component.sources = [pkg.repository ?? homepage, ecosystem === 'cargo'
      ? `https://crates.io/crates/${pkg.name}/${pkg.version}`
      : `https://www.npmjs.com/package/${pkg.name}/v/${pkg.version}`]
  }
  return component
}

function sortComponents(components) {
  return [...components].sort((left, right) => (
    left.name.toLowerCase().localeCompare(right.name.toLowerCase())
    || left.version.localeCompare(right.version, undefined, { numeric: true })
    || left.ecosystem.localeCompare(right.ecosystem)
  ))
}

/**
 * 组装最终清单。`runtime` 为随包二进制条目（已含 textIds），会排在最前并登记为重点组件；
 * npm / crate 条目按名称排序，同名同版本的 crate 只保留一份。
 */
function buildNotices({ project, target, runtime, npmPackages, cargoPackages, textTable, referenceTexts }) {
  const cargoUnique = new Map()
  for (const pkg of cargoPackages) cargoUnique.set(`${pkg.name}@${pkg.version}`, pkg)
  const dependencies = sortComponents([
    ...npmPackages.map((pkg) => toComponent('npm', pkg, textTable, referenceTexts)),
    ...[...cargoUnique.values()].map((pkg) => toComponent('cargo', pkg, textTable, referenceTexts)),
  ])
  const components = [...runtime, ...dependencies]
  const used = new Set(components.flatMap((component) => component.textIds))
  used.add(project.licenseTextId)
  const texts = Object.fromEntries(Object.entries(textTable.texts).filter(([id]) => used.has(id)).sort(([a], [b]) => a.localeCompare(b)))
  return {
    formatVersion: FORMAT_VERSION,
    target,
    project,
    highlights: runtime.map((component) => component.id),
    components,
    texts,
  }
}

/** 随安装包分发的纯文本版本（与界面同一份数据渲染）。 */
function renderNoticesText(notices) {
  const lines = [
    'THIRD-PARTY SOFTWARE NOTICES AND INFORMATION',
    `${notices.project.name} ${notices.project.version} (${notices.target.platform}-${notices.target.arch})`,
    '',
    `${notices.project.name} is licensed under ${notices.project.license}. It includes the third-party components listed below.`,
    'For components licensed under the GPL, LGPL or MPL, the corresponding source code can be obtained from the locations listed under "Source".',
    '',
    '='.repeat(80),
  ]
  for (const component of notices.components) {
    lines.push('', `${component.name} ${component.version}`)
    lines.push(`  License: ${component.license ?? 'UNKNOWN'}`)
    if (component.homepage) lines.push(`  Homepage: ${component.homepage}`)
    for (const source of component.sources ?? []) lines.push(`  Source: ${source}`)
    if (component.includes?.length) lines.push(`  Includes: ${component.includes.join(', ')}`)
    if (component.licenseFileHint) lines.push(`  License texts: see ${component.licenseFileHint} in the installation directory`)
    if (component.textIds.length) lines.push(`  License text: ${component.textIds.map((id) => `[${id}]`).join(' ')}${component.textOrigin === 'standard' ? ' (standard text; the component does not ship a license file)' : ''}`)
  }
  lines.push('', '='.repeat(80), '', 'LICENSE TEXTS')
  for (const [id, text] of Object.entries(notices.texts)) {
    lines.push('', '-'.repeat(80), `[${id}]`, '-'.repeat(80), text)
  }
  return `${lines.join('\n')}\n`
}

module.exports = {
  FORMAT_VERSION,
  NATIVE_CRATES,
  PLATFORM_EXCLUDED_NPM_PACKAGES,
  RUST_TARGETS,
  buildNotices,
  collectCargoPackages,
  collectNpmPackages,
  createTextTable,
  isCopyleft,
  licenseIdsOf,
  matchesPlatformList,
  normalizeLicenseExpression,
  normalizeRepositoryUrl,
  normalizeText,
  parseFfmpegExternalLibraries,
  readLicenseFiles,
  renderNoticesText,
  sqliteBlessingFromHeader,
  sqliteVersionFromHeader,
  standardLicenseText,
}
