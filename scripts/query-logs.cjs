#!/usr/bin/env node

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const readline = require('node:readline');

const APP_IDENTIFIER = 'com.henji.ai';
const LOG_FILE_PREFIX = 'henji-';
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const LEVELS = ['trace', 'debug', 'info', 'warn', 'error'];
const SOURCES = ['frontend', 'backend'];

function getDefaultLogDir() {
  if (process.platform === 'win32' && process.env.LOCALAPPDATA) {
    return path.join(process.env.LOCALAPPDATA, APP_IDENTIFIER, 'Henji-AI', 'logs');
  }

  const appDataDir = process.platform === 'darwin'
    ? path.join(os.homedir(), 'Library', 'Application Support')
    : process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
  return path.join(appDataDir, APP_IDENTIFIER, 'Henji-AI', 'logs');
}

function getToday() {
  return new Date().toISOString().slice(0, 10);
}

function printHelp() {
  console.log(`用法：npm run logs:query -- [选项]

默认查询今天的日志文件，并输出紧凑摘要。--chain 会输出指定 requestId 的完整事件内容。

选项：
  --date YYYY-MM-DD       查询日期（默认今天，按 UTC 日期命名）
  --request-id ID         精确匹配 requestId
  --chain ID              输出该 requestId 的完整请求链路（忽略其余筛选条件）
  --domain PREFIX         按 domain 前缀匹配
  --level LEVEL           最低级别：trace/debug/info/warn/error
  --event NAME            精确匹配 event
  --grep TEXT             在整条 JSON 中大小写不敏感搜索
  --source SOURCE         frontend 或 backend
  --tail N                只保留最后 N 条匹配事件
  --json                  输出原始 JSONL（每行可直接 JSON.parse）
  --dir PATH              覆盖默认日志目录
  --help, -h              显示本帮助

示例：
  npm run logs:query -- --level error --tail 50
  npm run logs:query -- --chain req_123
  npm run logs:query -- --date 2026-07-10 --domain llm-runtime --json`);
}

function fail(message) {
  console.error(`[logs:query] ${message}`);
  process.exit(1);
}

function requireValue(argv, index, option) {
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) {
    fail(`${option} 需要一个值`);
  }
  return value;
}

function parseArgs(argv) {
  const options = {
    date: getToday(),
    dir: getDefaultLogDir(),
    json: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') {
      options.help = true;
      continue;
    }
    if (arg === '--json') {
      options.json = true;
      continue;
    }

    const optionMap = {
      '--date': 'date',
      '--request-id': 'requestId',
      '--chain': 'chain',
      '--domain': 'domain',
      '--level': 'level',
      '--event': 'event',
      '--grep': 'grep',
      '--tail': 'tail',
      '--source': 'source',
      '--dir': 'dir',
    };
    const key = optionMap[arg];
    if (!key) {
      fail(`未知参数：${arg}`);
    }
    options[key] = requireValue(argv, index, arg);
    index += 1;
  }

  if (!DATE_PATTERN.test(options.date)) {
    fail('--date 必须是 YYYY-MM-DD');
  }
  if (options.level && !LEVELS.includes(options.level)) {
    fail('--level 必须是 trace、debug、info、warn 或 error');
  }
  if (options.source && !SOURCES.includes(options.source)) {
    fail('--source 必须是 frontend 或 backend');
  }
  if (options.tail !== undefined) {
    const tail = Number(options.tail);
    if (!Number.isSafeInteger(tail) || tail < 1) {
      fail('--tail 必须是正整数');
    }
    options.tail = tail;
  }
  if (options.chain) {
    options.requestId = options.chain;
  }

  return options;
}

function isLogEvent(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  return typeof value.timestamp === 'string'
    && LEVELS.includes(value.level)
    && typeof value.domain === 'string'
    && typeof value.event === 'string'
    && typeof value.message === 'string'
    && SOURCES.includes(value.source);
}

function matches(event, rawLine, options) {
  if (options.chain) {
    return event.requestId === options.chain;
  }
  if (options.requestId && event.requestId !== options.requestId) {
    return false;
  }
  if (options.domain && !event.domain.startsWith(options.domain)) {
    return false;
  }
  if (options.level && LEVELS.indexOf(event.level) < LEVELS.indexOf(options.level)) {
    return false;
  }
  if (options.event && event.event !== options.event) {
    return false;
  }
  if (options.source && event.source !== options.source) {
    return false;
  }
  return !options.grep || rawLine.toLowerCase().includes(options.grep.toLowerCase());
}

function oneLine(value, limit = 180) {
  const normalized = String(value || '').replace(/\s+/g, ' ').trim();
  return normalized.length > limit ? `${normalized.slice(0, limit - 1)}…` : normalized;
}

function formatSummary(event) {
  const requestId = event.requestId ? ` requestId=${event.requestId}` : '';
  return `${event.timestamp} ${String(event.level).toUpperCase().padEnd(5)} ${event.domain} ${event.event}${requestId} | ${oneLine(event.message)}`;
}

function writeEvent(event, options) {
  if (options.json) {
    console.log(JSON.stringify(event));
    return;
  }

  console.log(formatSummary(event));
  if (!options.chain) {
    return;
  }
  console.log(JSON.stringify(event, null, 2));
}

async function queryLogFile(options) {
  const logFile = path.join(options.dir, `${LOG_FILE_PREFIX}${options.date}.log`);
  if (!fs.existsSync(logFile)) {
    console.error(`[logs:query] 未找到日志文件：${logFile}`);
    return;
  }

  const stream = fs.createReadStream(logFile, { encoding: 'utf8' });
  const lines = readline.createInterface({ input: stream, crlfDelay: Infinity });
  const matched = [];
  let malformedLines = 0;

  try {
    for await (const line of lines) {
      if (!line.trim()) {
        continue;
      }
      let event;
      try {
        event = JSON.parse(line);
      } catch {
        malformedLines += 1;
        continue;
      }
      if (!isLogEvent(event)) {
        malformedLines += 1;
        continue;
      }
      if (!matches(event, line, options)) {
        continue;
      }
      if (options.tail && !options.chain) {
        matched.push(event);
        if (matched.length > options.tail) {
          matched.shift();
        }
      } else {
        writeEvent(event, options);
      }
    }
  } finally {
    lines.close();
    stream.close();
  }

  for (const event of matched) {
    writeEvent(event, options);
  }
  if (malformedLines > 0) {
    console.error(`[logs:query] 已跳过 ${malformedLines} 行损坏或不符合日志 schema 的数据。`);
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }
  await queryLogFile(options);
}

main().catch((error) => {
  console.error(`[logs:query] 查询失败：${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
