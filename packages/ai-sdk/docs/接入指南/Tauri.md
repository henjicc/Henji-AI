# Tauri 2 接入

## 已验证边界

任务 1.1 在 `@tauri-apps/plugin-http@2.5.9` 上完成了真实 `cargo check`，并直接核对了已安装包源码：

- `fetch()` 会尊重 `AbortSignal`，取消会调 Rust 侧 `fetch_cancel` / `fetch_cancel_body`。
- `Response.body` 是按 chunk 读取的标准 `ReadableStream`，因此与 SDK SSE 读取器的类型契约相容。
- capability URL glob 通过编译期校验。

未做的是 Tauri WebView 里的真实 SSE 服务器端到端联调；不要把“源码级支持”写成“所有平台都已实测稳定”。

## RuntimeContext

```ts
import { fetch as tauriFetch } from '@tauri-apps/plugin-http'
import { readFile } from '@tauri-apps/plugin-fs'
import type { CredentialScope, Logger, RuntimeContext } from '@henjicc/ai-sdk'

type ReadSecret = (key: string) => Promise<string | undefined>

export function createTauriRuntime(readSecret: ReadSecret, logger?: Logger): RuntimeContext {
  return {
    transport: { fetch: (url, init) => tauriFetch(url, init) },
    credentials: {
      get: (scope: CredentialScope, providerId: string) =>
        readSecret(`${scope}:${providerId}`),
    },
    media: {
      async read(ref) {
        const bytes = await readFile(ref)
        return {
          bytes,
          mimeType: inferMime(ref),
          filename: ref.split(/[\\/]/).at(-1) || 'upload.bin',
        }
      },
    },
    logger,
  }
}

function inferMime(ref: string): string {
  const path = ref.toLowerCase()
  if (path.endsWith('.png')) return 'image/png'
  if (path.endsWith('.webp')) return 'image/webp'
  if (path.endsWith('.mp4')) return 'video/mp4'
  if (path.endsWith('.mp3')) return 'audio/mpeg'
  return 'image/jpeg'
}
```

`@tauri-apps/plugin-fs` 还需要单独配置可读路径 scope；不要给全文件系统无限制权限。

## HTTP capability

`src-tauri/capabilities/default.json` 的形状如下；实际 URL 完整清单见
[供应商域名.md](供应商域名.md)：

```json
{
  "permissions": [
    "http:default",
    {
      "identifier": "http:allow-fetch",
      "allow": [
        { "url": "https://api.kie.ai/*" },
        { "url": "https://*.apimart.ai/*" }
      ]
    }
  ]
}
```

1.1 已对 `{"url":"https://*.apimart.ai/*"}` 做过 `cargo check`。新增供应商域名后要更新 capability 并重新发版。

## 凭据

`tauri-plugin-store` 是明文 JSON，不应直接存 API key。使用 Stronghold 或系统 keyring 实现上面的
`ReadSecret`，并在你的应用中完成写入/删除/重填流程。任务 1.1 只做了这两类方案的文档确认，
没有对某个 Stronghold/keyring 包的读写 API 做真机验证，所以本指南不伪造具体插件调用。
