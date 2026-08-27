/**
 * 读取一段媒体二进制数据后的产物：字节内容 + 供上传/内联使用的元信息。
 */
export interface MediaBinary {
  bytes: Uint8Array
  mimeType: string
  filename: string
}

/**
 * `MediaReader` 是 SDK 把「用户在界面上选中的媒体」转换成「可以放进供应商请求体的字节」
 * 的唯一入口。供应商适配器上传本地图片/视频/音频前，统一先经过这一步，再决定是转成
 * `data:` URI 内联、还是调用供应商的文件上传接口换一个公网 URL。
 *
 * 为什么必须由宿主提供：`ref` 指向的资源在三个目标运行时里对应完全不同的读取方式——
 * - **Electron**：`ref` 通常是本地文件系统绝对路径（如 `/Users/x/image.png`），读取即
 *   `fs.readFileSync`；也可能是渲染层已经生成好的 `data:` URI（用户从剪贴板粘贴、或
 *   画布节点导出的内联图片），此时直接解析 base64 payload，不涉及文件系统。
 * - **Tauri**：本地路径需要经 Tauri 的文件系统 API（`@tauri-apps/plugin-fs`）读取，
 *   受 `tauri.conf.json` 的文件系统作用域（scope）限制，不能像 Electron 一样无限制访问
 *   任意路径。
 * - **UXP（Photoshop）**：`ref` 很可能根本不对应一个磁盘文件，而是指向当前打开的 PS 文档
 *   或某个图层——读取过程是调用 `imaging.getPixels()`/文档导出 API 把画面栅格化导出为
 *   PNG/JPEG 字节，是一次"渲染"而不是一次"文件读取"。这是三者中差异最大的一种实现，
 *   `ref` 语义在 UXP 侧需要扩展为可以表达"文档/图层引用"而不仅是路径字符串
 *   （具体扩展方式留给消费 UXP 的任务决定，本接口的 `ref: string` 是三个宿主的最小公分母）。
 *
 * `ref` 的语义与 SDK 迁移前的 Electron 媒体预处理契约保持一致，支持两类输入：
 * 1. `data:` URI（`data:image/png;base64,....`）——直接解析，不触碰文件系统。
 * 2. 本地路径（含 `file://` 等本地协议前缀，或裸的绝对/相对路径）——按宿主的文件读取能力
 *    取出字节。
 *
 * 不支持的输入（远程 `http(s)://` URL、`blob:` URL）不应该传给 `MediaReader.read()`——
 * 远程 URL 应该原样透传给供应商，`blob:` URL 在后端运行时本来就不可解析，这两类的过滤
 * 是调用方（SDK 内部）的职责，不是 `MediaReader` 要处理的输入。
 */
export interface MediaReader {
  /**
   * 读取 `ref` 指向的媒体，返回字节与元信息。
   * @param ref 本地路径或 `data:` URI，语义见上方接口注释
   * @throws 当 `ref` 无法解析（既不是合法 `data:` URI 也不是宿主能读取的本地引用）
   *         或读取失败（文件不存在、无权限、文档导出失败等）时应该 `throw`，
   *         不要返回空字节——调用方无法安全地把"读取失败"和"空文件"区分开。
   */
  read(ref: string): Promise<MediaBinary>
}
