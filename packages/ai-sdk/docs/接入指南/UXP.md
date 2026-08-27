# Photoshop UXP 接入

## 证据边界

SDK 上游已完成 generation-only IIFE/VM 门禁；Photoshop UXP 真机网络与图层编码仍由插件集成验证。

- UXP 有 `fetch` / `AbortController` / Streams，但未找到官方证据证明长时间 `text/event-stream`
  在 Photoshop UXP 中稳定；LLM SSE 仍是待真机项。
- `requiredPermissions.network.domains` 支持 `https://*.example.com` 子域通配和 `"all"`。
  `requiredPermissions.webview.domains` 是另一套权限，不支持同样的通配，不要混用。
- `allowCodeGenerationFromStrings` 默认 `false`；UXP 又没有 Node/`node:vm`。SDK 因此只直接调用
  ESM 函数，不用 `eval`/`new Function`。不需要为 SDK 开启这项高风险权限。
- UXP 没有运行时 Node 模块解析；`@henjicc/ai-sdk` 必须在构建期 bundle。只做生成时使用
  `@henjicc/ai-sdk/generation`，不要导入带 LLM 的包根。

generation-only 入口公开 `createGenerationClient`，提供 `generate`、`continuePolling`、`cancel`、
`catalog`、`providers` 与 `dispose`。发布门禁确认其 IIFE 不含 LLM/Vercel AI SDK、Node、动态代码生成、
global fetch、Streams、File、`btoa`/`atob`，import/create/catalog/dispose 网络调用为 0，目录为 99 个模型；
宿主不需要 alias 或 shim。

## manifest v5 网络权限

```json
{
  "manifestVersion": 5,
  "requiredPermissions": {
    "network": {
      "domains": [
        "https://api.kie.ai",
        "https://kieai.redpandaai.co",
        "https://fal.run",
        "https://*.fal.run",
        "https://rest.fal.ai"
      ]
    }
  }
}
```

这里只是短示例；复制 [供应商域名.md](供应商域名.md) 中你实际启用的全部请求域名。
模型结果可能来自供应商 CDN 或用户自定义 LLM Base URL，它们不可能被静态 SDK 目录穷举；
宿主需要在保持最小权限的前提下单独加入。

## RuntimeContext

```ts
import { createGenerationClient } from '@henjicc/ai-sdk/generation'
import type { Logger, RuntimeContext } from '@henjicc/ai-sdk/runtime'

const { secureStorage } = require('uxp').storage

type ExportEncodedLayer = (ref: string) => Promise<{
  bytes: Uint8Array
  mimeType: 'image/png' | 'image/jpeg'
  filename: string
}>

export function createUxpRuntime(
  exportEncodedLayer: ExportEncodedLayer,
  logger?: Logger,
): RuntimeContext {
  return {
    transport: { fetch: (url, init) => fetch(url, init) },
    credentials: {
      async get(scope, providerId) {
        const stored = await secureStorage.getItem(`${scope}:${providerId}`)
        return stored ? new TextDecoder().decode(stored) : undefined
      },
    },
    media: { read: exportEncodedLayer },
    logger,
  }
}

export function createUxpGenerationClient(exportEncodedLayer: ExportEncodedLayer) {
  return createGenerationClient({
    runtime: createUxpRuntime(exportEncodedLayer),
  })
}
```

`ref` 应是你插件自己管理的文档/图层引用，不是让用户手填 URL。`photoshop.imaging.getPixels()`
可得到 `PhotoshopImageData`，再从 `imageData.getData()` 取像素字节；这是**原始像素**，
必须经插件的图像编码/临时文件导出流程得到真正 PNG/JPEG 字节，再从 `MediaReader.read()`
返回；不得把 RGBA 像素误报成 `image/png`。记录中 Grayscale/LAB 的通道处理与 CMYK
`getData()` 有历史问题，正式开放前要在真实 Photoshop 复测或明确禁用这些色彩模式。

## SecureStorage 与媒体编码

- SecureStorage 的 value 加密，key 名不加密；Adobe 将它定位为“更像缓存”，数据可丢失。
  凭据丢失时 `get()` 返回 `undefined`，UI 必须让用户重新填写；不得把它当作唯一且永久的账户真相源。
- SDK 的媒体 base64 编解码只依赖 `Uint8Array`，不要求 UXP 提供 `btoa` / `atob` polyfill。
- Fal 本地媒体上传使用 `RuntimeContext.transport` 执行 REST initiate + signed PUT，不构造 `File`；
  取消信号与 120 秒上传 deadline 会传到两段请求。真实 UXP 网络权限、取消和图片放置仍需真机验证。
