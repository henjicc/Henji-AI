/**
 * 凭据作用域（命名空间）。目前痕迹AI 有两套独立的密钥空间：
 * - `generation`：图像/视频/音频生成供应商密钥（现有 `AI_KEY_NAMESPACE = 'ai'`）
 * - `llm`：大语言模型供应商密钥（现有 `LLM_KEY_NAMESPACE = 'llm'`）
 *
 * 不写成闭合联合 `'generation' | 'llm'`，而是「内置字面量 + 可扩展」——这是
 * docs/task/模型SDK抽离/重要记录.md 记录 005 定的可扩展类型原则：SDK 是要被多个项目消费的
 * 独立包，闭合联合意味着任何新增的凭据空间（例如未来的语音识别模型、或消费方自定义的
 * 私有供应商分组）都要求先改 SDK 类型定义再发版。开放字符串交叉类型保留了内置值的
 * 字面量提示（IDE 能补全 `'generation'`/`'llm'`），同时允许传入任意字符串而不报类型错误。
 */
type ExtensibleString = string & Record<never, never>

export type CredentialScope =
  | 'generation'
  | 'llm'
  | 'speech-recognition'
  | 'translation'
  | ExtensibleString

/**
 * `CredentialStore` 是 SDK 读取供应商 API Key 的唯一入口。
 *
 * 为什么必须由宿主提供：凭据的存储与加密方式在三个目标运行时里完全不同——
 * Electron 用 `safeStorage`（依赖操作系统级密钥库：macOS Keychain / Windows DPAPI）
 * 加密后存本地文件；Tauri 计划用 `stronghold` 或系统 keyring 插件；UXP 只有
 * `SecureStorage`，且官方文档明确其定位「更像缓存而非持久存储」（key 本身不加密，
 * 建议把它存的数据设计成"丢失后可以重新生成"）。这些差异不可能被 SDK 抽象掉，
 * 只能交给宿主各自实现。
 *
 * `get()` 的返回值刻意允许同步值（`string | undefined`）或异步值
 * （`Promise<string | undefined>`）——多数宿主的凭据读取是同步的（Electron 的
 * `safeStorage.decryptString` 是同步调用），强制包一层 `Promise` 只是徒增一次
 * microtask 开销；但 UXP `SecureStorage` 的 API 是异步的，所以不能收窄成纯同步签名。
 * 调用方应统一 `await`（`await store.get(...)` 对同步返回值同样成立）。
 *
 * 取不到密钥（未配置、或密钥损坏无法解密——见
 * `electron/main/services/keystore.ts` 的 `decryptStoredKey`：旧密钥解不开时按
 * "未配置" 处理而不是抛错）一律返回 `undefined`，不抛异常。这对应
 * docs/task/模型SDK抽离/重要记录.md 记录 010 的运行时约束：UXP `SecureStorage`
 * 随时可能"取不到"（缓存被清），`CredentialStore` 的调用方（SDK 内部的供应商适配器）
 * 不能假设一次取到凭据之后它就一直可用，必须始终按"可能拿不到，需要引导用户重新配置"
 * 的路径处理，而不是把这种情况当成需要中断整个应用的异常。
 */
export interface CredentialStore {
  /**
   * 读取指定作用域下某个供应商的 API Key。
   * @param scope 凭据作用域，见 {@link CredentialScope}
   * @param providerId 供应商 id（如 `'ppio'`、`'fal'`、`'openai'`）
   * @returns 密钥明文；未配置或无法读取时返回 `undefined`（不抛异常）
   */
  get(scope: CredentialScope, providerId: string): Promise<string | undefined> | string | undefined
}
