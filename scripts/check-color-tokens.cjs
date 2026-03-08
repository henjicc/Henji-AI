const fs = require('fs');
const path = require('path');

const projectRoot = process.cwd();
const srcRoot = path.join(projectRoot, 'src');
const allowHexFile = path.join(srcRoot, 'core', 'theme', 'colorTokens.ts');

const targetExtensions = new Set(['.ts', '.tsx']);
const hexColorPattern = /#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})\b/g;
const arbitraryTailwindHexPattern = /(bg|text|border|ring|accent)-\[#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})\]/g;

/**
 * @param {string} dir
 * @returns {string[]}
 */
function collectSourceFiles(dir) {
  /** @type {string[]} */
  const result = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      result.push(...collectSourceFiles(fullPath));
      continue;
    }
    const ext = path.extname(entry.name);
    if (targetExtensions.has(ext)) {
      result.push(fullPath);
    }
  }

  return result;
}

/**
 * @param {string} fullPath
 * @param {number} lineNo
 * @param {string} line
 * @param {string} reason
 */
function formatViolation(fullPath, lineNo, line, reason) {
  const relativePath = path.relative(projectRoot, fullPath).replace(/\\/g, '/');
  return `${relativePath}:${lineNo} ${reason}\n  ${line.trim()}`;
}

const files = collectSourceFiles(srcRoot).filter((file) => path.normalize(file) !== path.normalize(allowHexFile));
/** @type {string[]} */
const violations = [];

for (const file of files) {
  const raw = fs.readFileSync(file, 'utf8');
  const lines = raw.split(/\r?\n/);

  for (let index = 0; index < lines.length; index += 1) {
    const lineNo = index + 1;
    const line = lines[index];

    if (arbitraryTailwindHexPattern.test(line)) {
      violations.push(formatViolation(file, lineNo, line, '禁止使用 Tailwind 任意十六进制颜色类'));
    }
    arbitraryTailwindHexPattern.lastIndex = 0;

    if (hexColorPattern.test(line)) {
      violations.push(formatViolation(file, lineNo, line, '禁止直接写十六进制颜色'));
    }
    hexColorPattern.lastIndex = 0;
  }
}

if (violations.length > 0) {
  console.error('\n[check-color-tokens] 检测到颜色规范违规：\n');
  for (const item of violations) {
    console.error(item);
  }
  console.error(`\n共 ${violations.length} 处违规。请改为使用 src/core/theme/colorTokens.ts 或语义化 Tailwind 类。\n`);
  process.exit(1);
}

console.log('[check-color-tokens] 通过：未检测到十六进制颜色直写或 Tailwind 任意十六进制颜色类。');
