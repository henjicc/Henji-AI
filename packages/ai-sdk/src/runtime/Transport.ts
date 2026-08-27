/**
 * `Transport` 是 SDK 发起网络请求时唯一依赖的宿主能力。
 *
 * 为什么必须由宿主提供：三个目标运行时的“发请求”方式并不等价——
 * Electron 主进程可以直接用全局 `fetch`（Node 18+/undici），但 Tauri 需要经
 * `@tauri-apps/plugin-http` 才能绕开浏览器 CORS 限制访问任意供应商域名，UXP 则完全没有
 * 全局 `fetch`，必须走其网络模块。SDK 内部因此不能直接调用全局 `fetch`，只能通过这一层
 * 窄接口让宿主决定“怎么发出去”。
 *
 * 接口本身只做一件事：接一个 URL + `RequestInit`，返回标准 `Response`。刻意不在这里放
 * 超时、重试、多端点回退这些策略——它们是“调用方希望怎么用这个能力”，不是“这个能力是什么”，
 * 塞进接口会让每个宿主实现都被迫重新实现一遍相同的策略。
 *
 * ## 为什么 `retryPreconnectOnce` 语义不进接口
 *
 * SDK 的 `providers/provider-fetch.ts` 中有一段“仅对尚未建立连接的失败重试一次”的逻辑
 * （`SAFE_PRECONNECT_RETRY_CODES`：
 * DNS 解析失败、连接超时、连接被拒绝等）。这段逻辑必须留在 SDK 内部作为一个**可选的高阶包装
 * 函数**（例如 `retryPreconnectOnce(transport, ...)`），包在 `Transport.fetch` 外层调用，
 * 而不是塞进 `Transport` 接口定义本身，原因是：
 *
 * 1. 这条重试策略只在“请求还没有送达供应商服务器”时才安全——一旦 TCP/TLS 握手已完成、
 *    请求体已经发出去，供应商可能已经收到并开始处理（部分供应商是先扣费/建任务再返回结果）。
 *    对这类失败重放请求，等于用同一份参数再次触发一次可能被计费的生成任务，这是绝对不能接受的
 *    副作用；因此重试的判断依据是“错误码是否只可能发生在建连阶段”，这是一条业务规则，
 *    不是网络层的通用能力，不该固化进传输接口。
 * 2. 不同宿主的错误码体系不同（Node undici 用 `ENOTFOUND`/`ECONNREFUSED` 这类 libuv 错误码，
 *    Tauri/UXP 的错误形状完全不同），把这条策略放接口里意味着每个宿主实现都要重新甄别
 *    "预连接失败" 与 "已连接后失败"，而放在 SDK 侧的包装函数里，只需要宿主实现如实抛出
 *    原始错误（不吞、不改写），策略判断留给统一的一处代码。
 * 3. 接口越窄，越容易在 UXP 这类能力受限的宿主上实现——`Transport` 只要求宿主能发一个请求、
 *    返回一个 `Response`，任何网络层都能满足。
 */
export interface Transport {
  /**
   * 发起一次网络请求，语义与标准 `fetch(url, init)` 完全一致：
   * - 网络失败（DNS、连接被拒绝、超时等）应该 `throw`，而不是返回一个“失败态”的 `Response`。
   * - HTTP 层面的失败（4xx/5xx）应该正常 `resolve` 出一个 `ok === false` 的 `Response`，
   *   由调用方决定如何解读响应体，`Transport` 不对业务语义做任何判断。
   * - `init.signal`（`AbortSignal`）必须被尊重：取消时应该尽快让返回的 Promise reject。
   */
  fetch(url: string, init?: RequestInit): Promise<Response>
}
