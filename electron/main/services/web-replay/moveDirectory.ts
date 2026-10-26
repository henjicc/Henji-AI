import { moveDirectoryNoOverwrite } from '../fs/no-overwrite'

/**
 * Windows refuses to move a folder while any file in it is open (a video still closing in the preview,
 * the indexer, antivirus); those locks clear within moments, so the move is retried briefly.
 * 工程里的录制与应用数据里的回收区可能在不同磁盘：跨盘时复制后删除原文件夹（直接改名会报 EXDEV）。
 */
export async function moveWebRecordingDirectory(from: string, to: string): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try { await moveDirectoryNoOverwrite(from, to); return } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if ((code !== 'EPERM' && code !== 'EBUSY' && code !== 'EACCES') || attempt >= 15) {
        if (code === 'EPERM' || code === 'EBUSY' || code === 'EACCES') throw new Error('这段录制的文件正被其他程序占用，请关闭正在播放或打开它的程序后再删除')
        throw error
      }
      await new Promise(resolve => setTimeout(resolve, 200))
    }
  }
}
