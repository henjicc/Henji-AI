import { Worker } from 'node:worker_threads'
import { createRequire } from 'node:module'

/** JSON parsing/traversal stays off the Electron main thread. One file/ZIP entry is
 * delivered at a time and acknowledged before proceeding (bounded in-flight work). */
const SOURCE = String.raw`
const { parentPort, workerData } = require('node:worker_threads');
const fs = require('node:fs/promises');
const path = require('node:path');
const yauzl = require(workerData.yauzl);
const visited = new Set();
const files = new Set();
const skippedLinks = [];
const unreadableLinks = [];
function skipLink(target, error) {
  skippedLinks.push(target);
  // 离线磁盘和共享目录也会返回不存在，只有循环链接能确定无需读取目标作品。
  if (error.code !== 'ELOOP') unreadableLinks.push(target);
}
function key(value) { const resolved = path.resolve(value); return process.platform === 'win32' ? resolved.toLowerCase() : resolved; }
function excluded(target, exclusions) { const value = key(target); return exclusions.some(root => value === key(root) || value.startsWith(key(root) + path.sep)); }
function refs(value) {
  const found = new Set(), stack = [value];
  while (stack.length) {
    const item = stack.pop();
    if (typeof item === 'string') {
      if (/^(?:[a-z]:[\\/]|[/\\]|file:|henji(?:-media)?:)/i.test(item)) found.add(item);
    } else if (item && typeof item === 'object') {
      for (const [key, child] of Object.entries(item)) stack.push(key, child);
    }
  }
  return [...found];
}
async function send(file, value) {
  const ack = new Promise(resolve => parentPort.once('message', resolve));
  parentPort.postMessage({ file, paths: refs(value) });
  await ack;
}
async function zip(file, bytes) {
  const archive = await new Promise((resolve, reject) => {
    const callback = (error, value) => error ? reject(error) : resolve(value);
    if (bytes) yauzl.fromBuffer(bytes, { lazyEntries: true }, callback);
    else yauzl.open(file, { lazyEntries: true }, callback);
  });
  try {
    await new Promise((resolve, reject) => {
      archive.on('error', reject); archive.on('end', resolve);
      archive.on('entry', entry => {
        if (!workerData.extensions.includes(path.extname(entry.fileName).toLowerCase())) { archive.readEntry(); return; }
        archive.openReadStream(entry, async (error, stream) => {
          if (error) { reject(error); return; }
          try {
            const chunks = []; for await (const chunk of stream) chunks.push(chunk);
            const bytes = Buffer.concat(chunks);
            if (bytes[0] === 80 && bytes[1] === 75) await zip(file, bytes);
            else await send(file, JSON.parse(bytes.toString('utf8')));
            archive.readEntry();
          } catch (error) { reject(error); }
        });
      });
      archive.readEntry();
    });
  } finally { archive.close(); }
}
async function scan(target, optional, extensions, exclusions, entry, resolved) {
  if (excluded(target, exclusions)) return;
  let stat = entry;
  if (!stat) {
    try { stat = await fs.lstat(target); } catch (error) { if (optional && error.code === 'ENOENT') return; throw error; }
  }
  // Windows 目录项也把云占位与去重重解析点标成链接，先用 lstat 区分普通文件和真正的链接。
  if (entry && stat.isSymbolicLink()) {
    try { stat = await fs.lstat(target); } catch (error) { skipLink(target, error); return; }
  }
  if (stat.isFile() && !extensions.includes(path.extname(target).toLowerCase())) return;
  const linked = stat.isSymbolicLink();
  if (stat.isSymbolicLink()) {
    try { stat = await fs.stat(target); resolved = await fs.realpath(target); }
    catch (error) { skipLink(target, error); return; }
  }
  const canonical = resolved || await fs.realpath(target);
  try { await scanContent(target, stat, canonical, extensions, exclusions); }
  catch (error) {
    // 链接已解析成功，后代 I/O 失败不能证明整棵目录已失效，未读到的作品仍须保护媒体。
    if (linked && error.code) { skippedLinks.push(target); unreadableLinks.push(target); return; }
    throw error;
  }
}
async function scanContent(target, stat, canonical, extensions, exclusions) {
  if (stat.isDirectory()) {
    const identity = key(canonical) + ':' + extensions.join(',') + ':' + exclusions.map(key).sort().join(',');
    if (visited.has(identity)) return;
    visited.add(identity);
    const dir = await fs.opendir(target);
    // 目录项已携带类型，无关文件无需逐个查询元数据；链接仍须解析，不能漏掉链接内的作品。
    for await (const entry of dir) {
      if (entry.isFile() && !extensions.includes(path.extname(entry.name).toLowerCase())) continue;
      await scan(path.join(target, entry.name), false, extensions, exclusions, entry, path.join(canonical, entry.name));
    }
  } else if (extensions.includes(path.extname(target).toLowerCase())) {
    const identity = key(canonical);
    if (files.has(identity)) return;
    files.add(identity);
    const handle = await fs.open(target, 'r');
    const signature = Buffer.alloc(4);
    try {
      await handle.read(signature, 0, 4, 0);
      if (signature[0] === 80 && signature[1] === 75) await zip(target);
      else await send(target, JSON.parse(await handle.readFile('utf8')));
    } finally { await handle.close(); }
  }
}
(async () => { for (const root of workerData.roots) await scan(root.path, root.optional, root.extensions || workerData.extensions, root.exclude || []); parentPort.postMessage({ done: true, skippedLinks, unreadableLinks }); })()
  .catch(error => { parentPort.postMessage({ error: String(error.stack || error) }); });
`

export interface ReferenceScanRoot { path: string; optional?: boolean; extensions?: readonly string[]; exclude?: readonly string[] }
export async function scanReferenceFiles(
  roots: readonly ReferenceScanRoot[], extensions: readonly string[], signal: AbortSignal,
  accept: (file: string, paths: string[]) => Promise<void>,
): Promise<{ skippedLinks: string[]; unreadableLinks: string[] }> {
  signal.throwIfAborted()
  const resolver = createRequire(__filename)
  const worker = new Worker(SOURCE, { eval: true, workerData: { roots, extensions, yauzl: resolver.resolve('yauzl') } })
  try {
    return await new Promise<{ skippedLinks: string[]; unreadableLinks: string[] }>((resolve, reject) => {
      const abort = (): void => reject(signal.reason ?? new Error('Reference scan cancelled'))
      signal.addEventListener('abort', abort, { once: true })
      worker.once('error', reject)
      worker.once('exit', code => { signal.removeEventListener('abort', abort); if (code !== 0) reject(new Error(`Reference worker exited: ${code}`)) })
      worker.on('message', (message: { done?: boolean; error?: string; file?: string; paths?: string[]; skippedLinks?: string[]; unreadableLinks?: string[] }) => {
        if (signal.aborted) return
        if (message.error) reject(new Error(message.error))
        else if (message.done) { signal.removeEventListener('abort', abort); resolve({ skippedLinks: message.skippedLinks ?? [], unreadableLinks: message.unreadableLinks ?? [] }) }
        else if (message.file && message.paths) {
          void accept(message.file, message.paths).then(() => worker.postMessage('next'), reject)
        }
      })
    })
  } finally { await worker.terminate() }
}
