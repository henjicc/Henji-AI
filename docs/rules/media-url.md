# 媒体 URL 形态约束

> 读取时机：任何地方传递图片/视频/音频 URL 或路径、接入新的媒体消费方（Worker、Canvas、上传、图像处理）、排查 `Failed to fetch` 或图片不显示。
>
> 这是本项目最容易反复踩的坑：四种形态在类型上全是 `string`，编译期没有任何提示。

## 四种形态

同一张图会以四种形态流动：

1. **裸本地路径** — `D:\a\b.png`（画布节点的 `imageUrl`、`filePath` 存的就是这种）
2. `file://`
3. `henji-media://`
4. `http(s)` / `data:` / `blob:`

## 三类消费方，认死理

| 消费方 | 可接受形态 | 不接受 |
|---|---|---|
| `fetch()`（含 Worker 内）、`createImageBitmap(await fetch())`、`urlToFile` | `henji-media://`、`http(s)`、`data:`、`blob:` | **裸路径、`file://`** |
| `<img>/<video>/<audio> src`、CSS `url()` | 同上 | **裸路径、`file://`** |
| 主进程 fs、`readImageInfo`、Sharp、`readFile`、协议 handler | **真实文件路径** | `henji-media://` |

## 规则

- 交给 fetch / Worker 前，必须先过 `toFetchableMediaUrl()`（`@/services/imageSource`）；交给 `<img>` 等元素前用 `resolveImageDisplayUrl()`。两者等价，用名字表达意图。
- 交给主进程按路径读文件的调用（`readImageInfo`、Sharp 回落、`readFile`）**必须保留原始路径**，不要顺手一起转换。同一个函数里两条路各用各的形态是正常的，不是不一致。
- **转换点放在"有该要求的那层边界"，不要散在调用点。** 例如 Worker 的收口是 `WorkerImageEditClient`，在那里转一次，所有调用方自动受益；在每个业务调用点各转一次＝迟早漏一个。
- 消费方无法自行转换时（如 `utils/` 不能依赖 `services/`），**必须显式报错并在错误信息里写明修复方式**，禁止让它退化成 `Failed to fetch`——这个信息量为零的报错正是排查成本的来源。
- 新增能消费媒体 URL 的能力时，先回答"我这层接受哪种形态、由谁负责转换"，再写实现。

## 参数面板的 URL 不属于用户输入

- 模型接口虽然常把素材字段命名为 `image_url`、`mask_url`、`cref` 等，参数面板也不得让用户手动填写链接；一律显示上传按钮或对应媒体上传组件。
- 渲染层上传控件保存本地路径/本地协议，提交生成时由主进程调用当前供应商官方上传服务，取得公网 URL 后在请求边界替换。
- 特殊字段用模型 schema 的 `runtimeConstraints.mediaFields` 显式声明类型，公共上传预处理层消费该声明；不要在 UI 或主进程写模型 ID 特例。
- 旧工程中的远程 URL 可以只读兼容并继续请求，但不能因此保留 URL 文本输入框。
