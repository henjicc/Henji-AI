import * as yauzl from 'yauzl'

/**
 * yauzl 的最小封装：懒读条目、逐条读取字节。项目包导入与技能安装共用这一份，
 * 不要在各自模块里再写一遍 Promise 包装。
 */

export function openZip(zipPath: string): Promise<yauzl.ZipFile> {
  return new Promise((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true, autoClose: false }, (error, archive) => {
      if (error) {
        reject(new Error(`Invalid package file: ${error.message}`))
        return
      }
      if (!archive) {
        reject(new Error('Invalid package file'))
        return
      }
      resolve(archive)
    })
  })
}

function readNextEntry(archive: yauzl.ZipFile): Promise<yauzl.Entry | null> {
  return new Promise((resolve, reject) => {
    const onEntry = (entry: yauzl.Entry): void => {
      cleanup()
      resolve(entry)
    }
    const onEnd = (): void => {
      cleanup()
      resolve(null)
    }
    const onError = (error: Error): void => {
      cleanup()
      reject(error)
    }
    const cleanup = (): void => {
      archive.off('entry', onEntry)
      archive.off('end', onEnd)
      archive.off('error', onError)
    }
    archive.once('entry', onEntry)
    archive.once('end', onEnd)
    archive.once('error', onError)
    archive.readEntry()
  })
}

export async function* iterateEntries(archive: yauzl.ZipFile): AsyncGenerator<yauzl.Entry> {
  while (true) {
    const entry = await readNextEntry(archive)
    if (!entry) {
      return
    }
    yield entry
  }
}

export function readEntryBytes(
  archive: yauzl.ZipFile,
  entry: yauzl.Entry,
  entryName: string
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    archive.openReadStream(entry, (error, stream) => {
      if (error) {
        reject(new Error(`Failed to extract ${entryName}: ${error.message}`))
        return
      }
      if (!stream) {
        reject(new Error(`Failed to extract ${entryName}`))
        return
      }
      const chunks: Buffer[] = []
      stream.on('data', (chunk: Buffer) => {
        chunks.push(chunk)
      })
      stream.on('error', (streamError) => {
        reject(new Error(`Failed to extract ${entryName}: ${streamError.message}`))
      })
      stream.on('end', () => {
        resolve(Buffer.concat(chunks))
      })
    })
  })
}

/** zip 条目是否是符号链接（Unix 模式位在 externalFileAttributes 高 16 位）。 */
export function isSymbolicLinkEntry(entry: yauzl.Entry): boolean {
  return ((entry.externalFileAttributes >>> 16) & 0xF000) === 0xA000
}
