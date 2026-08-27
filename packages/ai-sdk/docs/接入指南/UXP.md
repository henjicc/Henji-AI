# Photoshop UXP 接入

## 证据边界

当前结论来自 Adobe 官方文档与社区记录，**本机没有 Photoshop / UXP Developer Tool，未做真机端到端**。

- UXP 有 `fetch` / `AbortController` / Streams，但未找到官方证据证明长时间 `text/event-stream`
  在 Photoshop UXP 中稳定；LLM SSE 仍是待真机项。
- `requiredPermissions.network.domains` 支持 `https://*.example.com` 子域通配和 `"all"`。
  `requiredPermissions.webview.domains` 是另一套权限，不支持同样的通配，不要混用。
- `allowCodeGenerationFromStrings` 默认 `false`；UXP 又没有 Node/`node:vm`。SDK 因此只直接调用
  ESM 函数，不用 `eval`/`new Function`。不需要为 SDK 开启这项高风险权限。
- UXP 没有运行时 Node 模块解析；`@henjicc/ai-sdk` 和它的 npm 依赖必须在构建期 bundle。

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
import type { Logger, RuntimeContext } from '@henjicc/ai-sdk'

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
```

`ref` 应是你插件自己管理的文档/图层引用，不是让用户手填 URL。`photoshop.imaging.getPixels()`
可得到 `PhotoshopImageData`，再从 `imageData.getData()` 取像素字节；这是**原始像素**，
必须经插件的图像编码/临时文件导出流程得到真正 PNG/JPEG 字节，再从 `MediaReader.read()`
返回；不得把 RGBA 像素误报成 `image/png`。记录中 Grayscale/LAB 的通道处理与 CMYK
`getData()` 有历史问题，正式开放前要在真实 Photoshop 复测或明确禁用这些色彩模式。

## SecureStorage 与 base64

- SecureStorage 的 value 加密，key 名不加密；Adobe 将它定位为“更像缓存”，数据可丢失。
  凭据丢失时 `get()` 返回 `undefined`，UI 必须让用户重新填写；不得把它当作唯一且永久的账户真相源。
- UXP 有 `TextEncoder` / `TextDecoder` / `Uint8Array`，但记录中没有全局 `btoa` / `atob`。
  SDK 的媒体 base64 路径会使用这两个全局函数；UXP 入口在加载 SDK 之前必须安装基于
  `Uint8Array` 的经验证 polyfill。这一点仍需在真实 UXP 构建上做运行验收。
