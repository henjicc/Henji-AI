const fs = require('node:fs')
const path = require('node:path')

// Scope follows the managed-root resolver and published media deletion entry points.
// Exception: a preceding media-recycle-allow comment must explain unpublished temp
// cleanup or explicitly user-owned files. It never exempts an entire directory.
const owners = /getGeneratedMediaDir|getUploadsDir|getProgramStoreDir\(['"]thumbnails['"]\)|EditStates|media-recycle\/queue/
const excludedCacheOwners = /electron\/main\/services\/(?:image-editor-v3\/resource-store|audio-edit\/(?:media|explanation-audio|export|processors)|media\/content-disk-cache|documents\/(?:covers|session-state))\.ts$/
const rendererOwners = /src\/utils\/(?:save\/uploads|editStatePersistence|imageConversion\/thumbnailCacheCleanup)\.ts$/
function violations(file, text) {
  if (/\.test\.|media-recycle\/collector\.ts$/.test(file)) return []
  if (!owners.test(text) && !rendererOwners.test(file) && !excludedCacheOwners.test(file)) return []
  const lines = text.split(/\r?\n/)
  return lines.flatMap((line, index) => {
    if (/^\s*(?:async\s+)?remove\([^)]*\)\s*[:{]/.test(line)) return []
    if (!/(?:\b(?:fs|fsp)(?:\.promises)?\.(?:rm|unlink)(?:Sync)?|\bremove)\s*\(/.test(line)) return []
    const reason = lines.slice(Math.max(0, index - 1), index + 1).join('\n').match(/media-recycle-allow:\s*(.+)/)?.[1]
    return reason && reason.trim().length >= 16 ? [] : [`${file}:${index + 1}: published managed media must use the collector`]
  })
}
function check(root) {
  const errors = []
  function walk(dir) {
    for (const entry of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
      const file = `${dir}/${entry.name}`
      if (entry.isDirectory()) walk(file)
      else if (/\.tsx?$/.test(file)) {
        const text = fs.readFileSync(path.join(root, file), 'utf8')
        errors.push(...violations(file, text))

      }
    }
  }
  walk('electron/main/services'); walk('src/utils'); walk('src/features')
  const startup = fs.readFileSync(path.join(root, 'electron/main/index.ts'), 'utf8')
  if (!startup.includes('configureCacheDeletionBoundary(managedMediaRoots)')) errors.push('Missing managed cache deletion boundary at startup')
  const providers = fs.readFileSync(path.join(root, 'electron/main/services/media-recycle/providers.ts'), 'utf8')
  // The document provider must derive its scan from every registered kind (any readable extension), not a hand list.
  if (!/DOCUMENT_KINDS\.(?:flatMap|map)\(/.test(providers) || !providers.includes("'session-state'")) errors.push('Missing registered documents/saved-session provider')
  return errors
}
if (require.main === module) {
  const errors = check(path.resolve(__dirname, '..'))
  for (const error of errors) console.error(error)
  if (errors.length) process.exitCode = 1
  else console.log('媒体回收入口与引用提供者门禁通过')
}
module.exports = { violations, check }
