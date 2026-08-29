const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')

const SDK_INPUTS = Object.freeze([
  'package-lock.json',
  'packages/ai-sdk/package.json',
  'packages/ai-sdk/tsconfig.build.json',
  'packages/ai-sdk/scripts',
  'packages/ai-sdk/src',
])

function listFiles(target, output = []) {
  const stat = fs.statSync(target)
  if (stat.isFile()) {
    output.push(target)
    return output
  }
  for (const entry of fs.readdirSync(target, { withFileTypes: true })) {
    const absolute = path.join(target, entry.name)
    if (entry.isDirectory()) listFiles(absolute, output)
    else if (entry.isFile()) output.push(absolute)
  }
  return output
}

function calculateSdkInputDigest(root, inputs = SDK_INPUTS) {
  const files = inputs
    .flatMap((input) => listFiles(path.join(root, input)))
    .sort((left, right) => left.localeCompare(right, 'en'))
  const hash = crypto.createHash('sha256')
  for (const file of files) {
    hash.update(path.relative(root, file).split(path.sep).join('/'))
    hash.update('\0')
    hash.update(fs.readFileSync(file))
    hash.update('\0')
  }
  return hash.digest('hex')
}

function sdkBuildStampPath(root) {
  return path.join(root, 'node_modules', '.henji-ai-sdk-input-digest')
}

function readSdkBuildStamp(root) {
  try {
    return fs.readFileSync(sdkBuildStampPath(root), 'utf8').trim()
  } catch {
    return null
  }
}

function isSdkBuildCurrent(root, digest = calculateSdkInputDigest(root)) {
  const entry = path.join(root, 'packages', 'ai-sdk', 'dist', 'index.js')
  return fs.existsSync(entry) && readSdkBuildStamp(root) === digest
}

function writeSdkBuildStamp(root, digest) {
  fs.writeFileSync(sdkBuildStampPath(root), `${digest}\n`)
}

module.exports = {
  SDK_INPUTS,
  calculateSdkInputDigest,
  isSdkBuildCurrent,
  readSdkBuildStamp,
  sdkBuildStampPath,
  writeSdkBuildStamp,
}
