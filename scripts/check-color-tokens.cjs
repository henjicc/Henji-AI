const fs = require('fs');
const path = require('path');

const projectRoot = process.cwd();
const srcRoot = path.join(projectRoot, 'src');
// 颜色令牌的唯一定义处，允许写字面量
const allowLiteralFiles = new Set(
  [
    path.join(srcRoot, 'core', 'theme', 'colorTokens.ts'),
    path.join(srcRoot, 'index.css'),
  ].map((file) => path.normalize(file))
);

// .css 也要扫：此前只扫 .ts/.tsx，导致 7 个样式表里累计 70 处硬编码颜色长期不被发现，
// 其中包含 8 处 `#007eff`（一个和应用强调色 #3b82f6 不同的蓝）和一组亮色主题回退值
// （`--color-*` 变量从未定义，回退到 #ffffff/#18181b，在深色应用里就是白底黑字）。
const targetExtensions = new Set(['.ts', '.tsx', '.css']);
// CSS 里的 rgb()/rgba() 字面量：只有 rgb(var(--x-rgb) / a) 形式才允许
const cssRawRgbPattern = /\brgba?\(\s*[0-9]/g;
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

const files = collectSourceFiles(srcRoot).filter((file) => !allowLiteralFiles.has(path.normalize(file)));
/** @type {string[]} */
const violations = [];

for (const file of files) {
  const raw = fs.readFileSync(file, 'utf8');
  const lines = raw.split(/\r?\n/);

  for (let index = 0; index < lines.length; index += 1) {
    const lineNo = index + 1;
    const line = lines[index];

    // 纯注释行放过：记录"原先硬编码的是哪个值、为什么改掉"是有用的文档，
    // 而一整行都是注释时不可能存在真实的颜色使用。
    // 只放过整行注释，不放过 `color: #fff; /* ... */` 这种行尾注释。
    if (/^\s*(\/\/|\/\*|\*)/.test(line)) {
      continue;
    }

    if (arbitraryTailwindHexPattern.test(line)) {
      violations.push(formatViolation(file, lineNo, line, '禁止使用 Tailwind 任意十六进制颜色类'));
    }
    arbitraryTailwindHexPattern.lastIndex = 0;

    if (hexColorPattern.test(line)) {
      violations.push(formatViolation(file, lineNo, line, '禁止直接写十六进制颜色'));
    }
    hexColorPattern.lastIndex = 0;

    // CSS 额外查 rgb()/rgba() 字面量；注释行放过（历史值常写在注释里说明来由）
    if (path.extname(file) === '.css' && !/^\s*(\/\*|\*)/.test(line) && cssRawRgbPattern.test(line)) {
      violations.push(
        formatViolation(file, lineNo, line, '禁止 rgb/rgba 字面量，请写 rgb(var(--xxx-rgb) / a)')
      );
    }
    cssRawRgbPattern.lastIndex = 0;

    // CSS 文件额外查 rgb()/rgba() 字面量；注释行放过（历史值常写在注释里说明来由）
    if (path.extname(file) === '.css' && !/^\s*(\/\*|\*)/.test(line) && cssRawRgbPattern.test(line)) {
      violations.push(formatViolation(file, lineNo, line, '禁止 rgb/rgba 字面量，请写 rgb(var(--xxx-rgb) / a)'));
    }
    cssRawRgbPattern.lastIndex = 0;
  }
}

if (violations.length > 0) {
  console.error('\n[check-color-tokens] 检测到颜色规范违规：\n');
  for (const item of violations) {
    console.error(item);
  }
  console.error(`\n共 ${violations.length} 处违规。颜色只允许在 src/index.css / tailwind.config.js / src/core/theme/colorTokens.ts 三处定义；
其余位置请用语义化 Tailwind 类或 rgb(var(--xxx-rgb) / a)。\n`);
  process.exit(1);
}

console.log('[check-color-tokens] 通过：ts/tsx/css 均未检测到硬编码颜色。');
