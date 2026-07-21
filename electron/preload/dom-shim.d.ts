/**
 * tsconfig.electron.json 故意不包含 "DOM" lib（electron/main/** 用的是 Node 自带的
 * fetch/Headers/Uint8Array 类型，跟完整 DOM lib 的同名类型会打架）。但 preload 脚本运行时
 * 确实有 DOM 环境，electron.d.ts 的 webUtils.getPathForFile(file: File) 又引用了全局 File
 * 类型，这里只补一个最小够用的 shim，不引入整个 DOM lib。
 */
interface Blob {
  readonly size: number
  readonly type: string
}

interface File extends Blob {
  readonly name: string
  readonly lastModified: number
}
