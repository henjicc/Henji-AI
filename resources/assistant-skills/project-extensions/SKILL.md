---
name: project-extensions
description: 应用工具做不到时，在用户电脑上自己装模型、写脚本、滤镜或助手插件，放进随项目走的扩展。本地模型推理（关键点、深度、法线、分割）、外部程序、批量数据处理、给助手加工具时使用。
---

# 项目扩展：缺什么就自己做

应用工具是常用事情的快车道：先找它们，没有或做不到再写扩展。扩展里放什么都可以：模型、脚本、滤镜、外部程序、助手插件，或者它们的组合。本机创作的扩展不用问用户，直接做；从网上装第三方库和模型也直接装，回复里说一句装了什么、放在哪。

## 放在哪

- **项目扩展**：`<项目文件夹>/扩展/<名字>/`（英文项目是 `Extensions`），只给这个项目用。内置助手的工作文件夹就是项目文件夹，消息开头会写明项目扩展、全局扩展与全局助手插件的绝对路径；外部助手按自己看到的项目文件夹位置来。
- **全局扩展**：`<作品目录>/扩展/<名字>/`，几个项目都用得上时从项目里移过去。
- 名字用小写英文加连字符（`hand-pose`、`face-relight`）；中文写在说明里。
- 文档扫描不进扩展文件夹，里面装多少依赖都不影响应用。

```text
扩展/hand-pose/
  extension.json   说明（必需，见下）
  README.md        给人看：做什么、怎么用、结果放到了哪里
  setup.mjs        在一台新电脑上装好依赖与模型，可重复运行（有依赖时必需）
  src/             代码
  .cache/          依赖、模型权重、中间结果：可删可重建，分享时不带
  out/             产物（导入应用之前的文件）
```

## extension.json

| 字段 | 内容 |
| --- | --- |
| `name`、`version` | 名字与版本（`1.0.0`），改了算法或输出格式就升版本 |
| `description` | 一句话用途，写清输入和输出 |
| `roles` | `analyzer` 分析器（对素材离线算一次）、`effect` 效果（逐帧画面，在剪辑代码工程里）、`operation` 操作（改工程或批量做事），可多选 |
| `runtime` | `node`（默认）、`python` 或其他；不是 node 时写清用什么 |
| `setup` | 装依赖、下载模型的命令，例如 `henji-node setup.mjs` |
| `run` | 运行命令，参数用 `<视频>`、`<输出文件夹>` 这样的占位写法 |
| `inputs`、`outputs` | 每项 `{ name, kind, format? }`；kind 用 `video`、`image`、`audio`、`data-track`（数据轨）、`image-track`（画面轨）、`file` |
| `params` | 参数名、类型、默认值与一句说明；用意图语义（“火焰高度占手掌比例”），不用内部单位 |
| `dependencies` | `npm` / `pip` 精确版本；`models` 每项 `{ url, sha256, path }` |
| `verify` | 怎么检查结果对，例如出一张叠了关键点的对比帧 |

## 运行环境

- **首选应用自带的那套**，用户什么都不用装：
  - 内置助手：命令里直接用 `henji-node`（用法同 `node`）；应用自带的 ffmpeg、ffprobe 在环境变量 `HENJI_FFMPEG`、`HENJI_FFPROBE`；
  - 外部助手：`describe_application_contract` 的 `localRuntime` 给出同一份 Node（按给的环境变量运行）与 ffmpeg、ffprobe 的路径；项目文件夹读 `documents.project.path`；
  - 看画面、看规格先用应用的观察工具（`observe_video_edit_frame` 的联系表带时间码，素材属性里有时长、分辨率、帧率），只有扩展脚本自己要解码时才调 ffmpeg；
  - 模型优先找 ONNX 版本，用 npm 的 `onnxruntime-node` 跑，先试显卡执行提供者（Windows 用 `dml` 或 `cuda`，macOS 用 `coreml`），不行再用 CPU；
  - 像素与模拟放到剪辑代码素材的 WebGPU 里做。
- 没有 npm 时，从 nodejs.org 下载官方便携版 Node 放到 `<作品目录>/扩展/.runtime/`，所有扩展共用。
- 模型只有 Python 版、或 Python 明显更合适时再用 Python：用 uv 给这个扩展建独立环境（放进 `.cache/`），不装进系统 Python。
- 重活走显卡（ffmpeg 加 `-hwaccel cuda` 等），同时只跑一两个重任务，别把用户电脑占满。

## 结果怎么进应用

扩展的产物通过“轨”交给应用，内置的跟踪、抠像和扩展做的东西用同一种方式接。

- **数据轨**（点、框、骨架、曲线、事件）：写成 TS 模块，放进剪辑代码工程 `<项目文件夹>/代码/` 里，比如 `film/<片子>/tracks/hand-pose.ts`，内容是 `export const track = { format, fps, frames: [{ t, ... }] }`。约定：
  - `t` 用素材的源时间（秒）；
  - 坐标按素材画面归一化到 0–1；
  - 文件开头注明由哪个扩展、哪个版本、哪个素材、什么参数生成，不手改；
  - 数据很大时按时间段拆成几个文件。

  写完调用 `commit_video_edit_code_project` 提交（和外部编辑器改文件是同一条路），代码效果再 `import` 它；已经在用的素材用 `upgrade_video_edit_code_materials` 升级。
- **画面轨**（蒙版、深度、法线、光照图）：输出成和原素材同帧率、同时长的视频（高码率或无损），用 `import_video_edit_asset` 导入项目，再把代码素材的 video 参数绑上 `{kind:"video", mediaId}`，渲染时按片段时间逐帧对上。
- **效果**：画面的代码写在剪辑代码工程里，按技能 video-edit-code-creation 写。渲染时代码不能读文件、不能联网，所以要用的数据和画面都按上面两条先交进来。扩展文件夹里放的是生成这些数据的程序。
- **操作**：一次性改工程的，脚本算出要改什么，再用应用工具写入（多步写入用 `run_application_script`），进撤销栈；不要直接改文档文件。
- 做完用 `observe_video_edit_frame` 取几帧看结果，自己检查，不凭脚本跑完就说做好了。

## 缓存与重跑

- 中间结果放 `.cache/`，按“输入文件内容、扩展版本、参数”起名，已经有就直接用。
- 改了参数或升了版本才重算；重算后数据轨的文件路径不变，用同样的方式覆盖并提交。

## 分享与重建

- 项目文件夹整个分享出去，扩展跟着走；`.cache/` 不用带，在 README 里写一句“依赖与模型运行 setup 重建”。
- 导入应用的画面轨、写进代码工程的数据轨本来就在项目里：对方没装扩展、没接助手，也能照常播放和导出，只是不能重新计算。
- 别人分享来的项目，用户在应用里允许运行其中的代码之前，不运行它的 setup 和 run，也不安装它声明的依赖。

## 给助手加工具（Pi 插件）

需要把一件事做成助手随时能调用的工具时，写一个 Pi 插件：

- 只给这个项目用的，放 `<项目文件夹>/.pi/extensions/<名字>.ts`；
- 全局的，放消息开头写明的全局助手插件文件夹；
- 下一条消息起自动加载。

```ts
import { Type } from 'typebox'
export default function (pi) {
  pi.registerTool({
    name: 'hand_pose', label: '手部关键点', description: '对一段视频估计手部关键点，返回数据轨文件路径。',
    parameters: Type.Object({ video: Type.String() }),
    async execute(_id, { video }, signal, _onUpdate, ctx) {
      // 可以运行本机命令，也可以用 ctx.executeTool('工具名', 参数) 调用应用工具
      return { content: [{ type: 'text', text: '...' }], details: undefined }
    },
  })
}
```

项目自己的规矩写进 `<项目文件夹>/AGENTS.md`，助手每次都会读到。

## 删除

命令里的删除（`rm`、`del`、`Remove-Item`）会移进系统回收站。清理文件就用这些命令，不要在脚本里用 `fs.rm` 之类的接口绕过回收站。

位置没有回收站（网络盘、移动盘、回收站被关掉）或东西大过回收站容量时，删除会报错、什么都不删。这时告诉用户原因；用户明确要永久删除，才用报错里给出的系统原版命令。`.cache` 里可以重建的依赖与中间结果不在此列，直接用原版命令清理即可。
