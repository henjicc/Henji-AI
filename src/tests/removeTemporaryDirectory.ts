import { rmSync } from 'node:fs'
import fsp from 'node:fs/promises'

/**
 * 删除测试用的临时目录。**Windows 上必须带重试，不能直接 `fsp.rm`。**
 *
 * 这些目录里的图片是 `sharp(路径)` 读进去的，libvips 的操作缓存默认会把源文件的
 * 句柄留到缓存淘汰为止。POSIX 允许删除仍被打开的文件，Windows 不允许：句柄还在时
 * `unlink` 直接抛 `EBUSY`，而 `force: true` 只吞 `ENOENT`，对 `EBUSY` 无效。
 * 于是收尾偶发失败，表现成一条与断言毫无关系的红——2026-09-18 的全量单测里
 * `source-provider.test.ts` 就这样红过一次，同一文件重跑又是绿的。
 *
 * `maxRetries` 是 Node 为这个场景提供的官方解法：它只对 `EBUSY`/`EPERM`/`ENOTEMPTY`
 * 这类可恢复错误退避重试，真正的删除失败仍然会抛出来，不会把错误吞掉。
 */
export function removeTemporaryDirectory(directory: string): Promise<void> {
  return fsp.rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 })
}

/** 同步版本，供本来就用 `rmSync` 收尾的测试使用，重试语义与上面一致。 */
export function removeTemporaryDirectorySync(directory: string): void {
  rmSync(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 })
}
