#!/usr/bin/env node

/**
 * 版本发布自动化脚本
 * 用法:
 *   node scripts/release.js           # 交互式模式
 *   node scripts/release.js <version> # 直接指定版本
 * 示例:
 *   node scripts/release.js
 *   node scripts/release.js 0.1.2
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const readline = require('readline');

// 颜色输出
const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m',
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function error(message) {
  log(`❌ ${message}`, 'red');
  process.exit(1);
}

function success(message) {
  log(`✓ ${message}`, 'green');
}

function info(message) {
  log(`ℹ ${message}`, 'blue');
}

function warning(message) {
  log(`⚠ ${message}`, 'yellow');
}

function exec(command, options = {}) {
  try {
    return execSync(command, { encoding: 'utf8', stdio: 'inherit', ...options });
  } catch (err) {
    error(`命令执行失败: ${command}`);
  }
}

function execSilent(command) {
  try {
    return execSync(command, { encoding: 'utf8', stdio: 'pipe' });
  } catch (err) {
    return null;
  }
}

function validateVersion(version) {
  const versionRegex = /^\d+\.\d+\.\d+$/;
  if (!versionRegex.test(version)) {
    error('版本号格式错误，应为 x.y.z 格式（例如: 0.1.2）');
  }
}

function getCurrentVersion() {
  const packageJsonPath = path.resolve(__dirname, '..', 'package.json');
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
  return packageJson.version;
}

function incrementVersion(version) {
  const parts = version.split('.');
  parts[2] = String(parseInt(parts[2]) + 1);
  return parts.join('.');
}

function question(query) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  return new Promise(resolve => {
    rl.question(query, answer => {
      rl.close();
      resolve(answer);
    });
  });
}

async function multilineInput(prompt) {
  console.log(prompt);
  log('提示: 输入多行内容，输入 "END" 或 "end" 单独一行表示结束', 'gray');
  log('提示: 直接输入 "END" 跳过此步骤', 'gray');
  console.log();

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  const lines = [];

  return new Promise(resolve => {
    rl.on('line', (line) => {
      if (line.trim().toUpperCase() === 'END') {
        rl.close();
        resolve(lines.join('\n'));
      } else {
        lines.push(line);
      }
    });
  });
}

function updateJsonFile(filePath, version) {
  const content = fs.readFileSync(filePath, 'utf8');
  const json = JSON.parse(content);
  json.version = version;
  fs.writeFileSync(filePath, JSON.stringify(json, null, 2) + '\n', 'utf8');
  success(`已更新 ${path.relative(process.cwd(), filePath)}`);
}

function updateCargoToml(filePath, version) {
  let content = fs.readFileSync(filePath, 'utf8');
  content = content.replace(/^version = ".*"$/m, `version = "${version}"`);
  fs.writeFileSync(filePath, content, 'utf8');
  success(`已更新 ${path.relative(process.cwd(), filePath)}`);
}

function updateUpdateChecker(filePath, version) {
  let content = fs.readFileSync(filePath, 'utf8');
  content = content.replace(/return '\d+\.\d+\.\d+'/, `return '${version}'`);
  fs.writeFileSync(filePath, content, 'utf8');
  success(`已更新 ${path.relative(process.cwd(), filePath)}`);
}

function updateNsisInstaller(filePath, version) {
  let content = fs.readFileSync(filePath, 'utf8');
  content = content.replace(/!define PRODUCT_VERSION ".*"/, `!define PRODUCT_VERSION "${version}"`);
  fs.writeFileSync(filePath, content, 'utf8');
  success(`已更新 ${path.relative(process.cwd(), filePath)}`);
}

async function checkGitStatus() {
  const status = execSilent('git status --porcelain');
  if (status && status.trim()) {
    warning('工作区有未提交的更改：');
    console.log(status);
    const answer = await question('是否继续？(y/n): ');
    if (answer.toLowerCase() !== 'y') {
      error('已取消发布');
    }
  }
}

async function runBuildCheck() {
  info('步骤 0/7: 运行完整构建测试...');
  console.log();

  log('正在运行 Tauri 完整构建（这可能需要几分钟）...', 'cyan');
  log('提示: 构建过程中会显示详细输出', 'gray');
  console.log();

  try {
    // 使用 tauri:build 包含 VS 环境设置
    exec('npm run tauri:build');
    console.log();
    success('Tauri 构建成功！');
  } catch (err) {
    console.log();
    error('Tauri 构建失败，请先修复错误后再发布');
  }

  console.log();
  success('构建测试通过，构建产物已生成！');
  log('构建产物位置: src-tauri/target/release/bundle/', 'gray');
  console.log();
}

async function promptVersion() {
  const currentVersion = getCurrentVersion();
  const suggestedVersion = incrementVersion(currentVersion);

  console.log();
  log(`当前版本: ${currentVersion}`, 'cyan');
  log(`建议版本: ${suggestedVersion}`, 'green');
  console.log();

  const answer = await question(`请输入新版本号 (直接回车使用 ${suggestedVersion}): `);

  if (!answer.trim()) {
    return suggestedVersion;
  }

  validateVersion(answer.trim());
  return answer.trim();
}

async function promptChangelog() {
  console.log();
  const changelog = await multilineInput('请输入更新日志 (可选，多行输入):');
  return changelog.trim();
}

async function confirmRelease(version, changelog) {
  console.log();
  log('═══════════════════════════════════════', 'cyan');
  log('发布信息确认', 'cyan');
  log('═══════════════════════════════════════', 'cyan');
  log(`版本号: ${version}`, 'green');
  if (changelog) {
    log('更新日志:', 'green');
    changelog.split('\n').forEach(line => {
      log(`  ${line}`, 'gray');
    });
  } else {
    log('更新日志: (无)', 'gray');
  }
  log('═══════════════════════════════════════', 'cyan');
  console.log();

  const answer = await question('确认发布？(y/n): ');
  if (answer.toLowerCase() !== 'y') {
    error('已取消发布');
  }
}

async function main() {
  const args = process.argv.slice(2);

  if (args[0] === '--help' || args[0] === '-h') {
    console.log(`
用法:
  npm run release              # 交互式模式（推荐）
  npm run release 0.1.2        # 直接指定版本

交互式模式会：
  0. 运行构建检查（TypeScript、ESLint、Vite、Cargo）
  1. 自动建议下一个版本号
  2. 允许输入更新日志
  3. 更新所有文件中的版本号
  4. 更新依赖锁文件
  5. 提交更改
  6. 创建 Git 标签
  7. 推送到远程仓库
    `);
    process.exit(0);
  }

  console.log();
  log('🚀 Henji-AI 版本发布工具', 'cyan');
  log('═══════════════════════════════════════', 'cyan');
  console.log();

  // 首先检查 Git 状态
  info('检查 Git 工作区状态...');
  await checkGitStatus();
  success('Git 工作区干净');
  console.log();

  // 运行构建检查
  await runBuildCheck();

  // 获取版本号
  let version;
  let changelog = '';

  if (args.length > 0) {
    // 命令行模式
    version = args[0];
    validateVersion(version);
    info(`使用指定版本: ${version}`);
  } else {
    // 交互式模式
    version = await promptVersion();
    changelog = await promptChangelog();
    await confirmRelease(version, changelog);
  }

  console.log();
  info(`开始发布版本 ${version}...`);
  console.log();

  // 更新所有版本号
  info('步骤 1/7: 更新版本号...');
  const rootDir = path.resolve(__dirname, '..');

  updateJsonFile(path.join(rootDir, 'package.json'), version);
  updateJsonFile(path.join(rootDir, 'src-tauri', 'tauri.conf.json'), version);
  updateCargoToml(path.join(rootDir, 'src-tauri', 'Cargo.toml'), version);
  updateUpdateChecker(path.join(rootDir, 'src', 'services', 'updateChecker.ts'), version);
  updateNsisInstaller(path.join(rootDir, 'src-tauri', 'nsis', 'installer.nsh'), version);
  console.log();

  // 保存更新日志
  if (changelog) {
    info('步骤 2/7: 保存更新日志...');
    const changelogPath = path.join(rootDir, 'CHANGELOG.md');
    let changelogContent = '';

    if (fs.existsSync(changelogPath)) {
      changelogContent = fs.readFileSync(changelogPath, 'utf8');
    } else {
      changelogContent = '# 更新日志\n\n';
    }

    const date = new Date().toISOString().split('T')[0];
    const newEntry = `## [${version}] - ${date}\n\n${changelog}\n\n`;

    // 在第一个 ## 之前插入新条目，或者在文件开头插入
    if (changelogContent.includes('## [')) {
      changelogContent = changelogContent.replace(/## \[/, newEntry + '## [');
    } else {
      changelogContent += newEntry;
    }

    fs.writeFileSync(changelogPath, changelogContent, 'utf8');
    success('更新日志已保存到 CHANGELOG.md');
    console.log();
  } else {
    info('步骤 2/7: 跳过更新日志（未提供）');
    console.log();
  }

  // 更新 Cargo.lock
  info('步骤 3/7: 更新 Cargo.lock...');
  process.chdir(path.join(rootDir, 'src-tauri'));
  exec('cargo update -p henji-ai');
  process.chdir(rootDir);
  success('Cargo.lock 已更新');
  console.log();

  // 更新 package-lock.json
  info('步骤 4/7: 更新 package-lock.json...');
  exec('npm install --package-lock-only');
  success('package-lock.json 已更新');
  console.log();

  // Git 提交
  info('步骤 5/7: 提交更改...');
  const filesToAdd = [
    'package.json',
    'package-lock.json',
    'src-tauri/tauri.conf.json',
    'src-tauri/Cargo.toml',
    'src-tauri/Cargo.lock',
    'src/services/updateChecker.ts',
    'src-tauri/nsis/installer.nsh'
  ];

  if (changelog) {
    filesToAdd.push('CHANGELOG.md');
  }

  exec(`git add ${filesToAdd.join(' ')}`);

  let commitMessage = `Bump version to ${version}`;
  if (changelog) {
    // 将更新日志添加到提交信息中
    const changelogLines = changelog.split('\n').map(line => line.trim()).filter(line => line);
    if (changelogLines.length > 0) {
      commitMessage += '\n\n' + changelogLines.join('\n');
    }
  }

  exec(`git commit -m "${commitMessage.replace(/"/g, '\\"')}"`);
  success('更改已提交');
  console.log();

  // 创建标签
  info('步骤 6/7: 创建 Git 标签...');
  if (changelog) {
    // 带注释的标签
    const tagMessage = `Release ${version}\n\n${changelog}`;
    exec(`git tag -a v${version} -m "${tagMessage.replace(/"/g, '\\"')}"`);
  } else {
    // 轻量级标签
    exec(`git tag v${version}`);
  }
  success(`标签 v${version} 已创建`);
  console.log();

  // 推送到远程
  info('步骤 7/7: 推送到远程仓库...');
  exec('git push origin main');
  exec(`git push origin v${version}`);
  success('已推送到远程仓库');
  console.log();

  success(`🎉 版本 ${version} 发布成功！`);
  console.log();
  info('下一步：');
  console.log('  1. 在 GitHub 上查看自动创建的标签');
  console.log('  2. 运行 npm run tauri:build 构建安装包');
  console.log('  3. 在 GitHub 上创建 Release 并上传构建产物');
  if (changelog) {
    console.log();
    log('更新日志已保存到 CHANGELOG.md 和 Git 标签中', 'cyan');
  }
}

main().catch(err => {
  error(`发布失败: ${err.message}`);
});
