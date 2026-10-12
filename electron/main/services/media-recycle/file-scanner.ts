import { Worker } from 'node:worker_threads'
import { createRequire } from 'node:module'

/** JSON parsing/traversal stays off the Electron main thread. One file/ZIP entry is
 * delivered at a time and acknowledged before proceeding (bounded in-flight work). */
const SOURCE = String.raw`
const { parentPort, workerData } = require('node:worker_threads');
const fs = require('node:fs/promises');
const path = require('node:path');
const yauzl = require(workerData.yauzl);
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
async function scan(target, optional, extensions) {
  let stat;
  try { stat = await fs.lstat(target); } catch (error) { if (optional && error.code === 'ENOENT') return; throw error; }
  if (stat.isSymbolicLink()) throw new Error('Cannot prove references through symbolic link: ' + target);
  if (stat.isDirectory()) {
    const dir = await fs.opendir(target);
    for await (const entry of dir) await scan(path.join(target, entry.name), false, extensions);
  } else if (extensions.includes(path.extname(target).toLowerCase())) {
    const handle = await fs.open(target, 'r');
    const signature = Buffer.alloc(4);
    try { await handle.read(signature, 0, 4, 0); } finally { await handle.close(); }
    if (signature[0] === 80 && signature[1] === 75) await zip(target);
    else await send(target, JSON.parse(await fs.readFile(target, 'utf8')));
  }
}
(async () => { for (const root of workerData.roots) await scan(root.path, root.optional, root.extensions || workerData.extensions); parentPort.postMessage({ done: true }); })()
  .catch(error => { parentPort.postMessage({ error: String(error.stack || error) }); });
`

export interface ReferenceScanRoot { path: string; optional?: boolean; extensions?: readonly string[] }
export async function scanReferenceFiles(
  roots: readonly ReferenceScanRoot[], extensions: readonly string[], signal: AbortSignal,
  accept: (file: string, paths: string[]) => Promise<void>,
): Promise<void> {
  signal.throwIfAborted()
  const resolver = createRequire(__filename)
  const worker = new Worker(SOURCE, { eval: true, workerData: { roots, extensions, yauzl: resolver.resolve('yauzl') } })
  try {
    await new Promise<void>((resolve, reject) => {
      const abort = (): void => reject(signal.reason ?? new Error('Reference scan cancelled'))
      signal.addEventListener('abort', abort, { once: true })
      worker.once('error', reject)
      worker.once('exit', code => { signal.removeEventListener('abort', abort); if (code !== 0) reject(new Error(`Reference worker exited: ${code}`)) })
      worker.on('message', (message: { done?: boolean; error?: string; file?: string; paths?: string[] }) => {
        if (message.error) reject(new Error(message.error))
        else if (message.done) { signal.removeEventListener('abort', abort); resolve() }
        else if (message.file && message.paths) {
          void accept(message.file, message.paths).then(() => worker.postMessage('next'), reject)
        }
      })
    })
  } finally { await worker.terminate() }
}
