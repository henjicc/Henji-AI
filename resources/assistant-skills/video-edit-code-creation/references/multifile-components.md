# 多文件与项目组件库

## 什么时候拆文件

源码超过一两百行、部件超过三四个，或者同一部件要用好几次，就拆成多个文件。入口文件只放参数、类型声明和拼装，部件、配色表、着色器字符串各放一个文件。文件个数不设上限；单文件 64KiB，全部文件共享编译预算。

## 怎么提交

创建素材时用 `video_edit.code_material.files`（`{路径: 源码}`）加 `video_edit.code_material.entry`（入口路径，默认 main.ts），代替单文件的 source；两者二选一。新版本同理用 `video_edit.code_version.files` / `video_edit.code_version.entry`。

```json
{
  "main.ts": "import { card } from './parts/card'\nimport { palette } from './palette'\nexport default { ...入口声明..., render(ctx) { return [card(ctx, palette.accent)] } }",
  "parts/card.ts": "export const card = (ctx, accent) => rect({x: 0, y: 0, width: ctx.width * .3, height: 120, fill: accent})",
  "palette.ts": "export const palette = { accent: [.9,.4,.2,1] }"
}
```

- 路径用 `/` 分隔的相对路径，扩展名 .ts，不能越出根目录。
- 只有入口文件写 `export default`；其他文件是模块，只能有 `const`、`export const`、纯箭头函数和静态声明，不能有副作用。
- 导入写在文件顶部：`import { a, b as c } from "./相对路径"`，只支持具名导入，不写扩展名。缺失文件、缺失导出和循环导入会被拒绝，报错里带文件名和行号。
- 入口的 parameters、types、shaders 可以直接引用模块导出的静态对象，方便把一大段声明或 WGSL 字符串单独放一个文件。

## 存在哪里

每个版本的文件按原样写进项目文件夹：`代码/<素材名>/v<版本号>/<路径>`，用户能用任何编辑器打开查看。版本不可改：写入后不再修改，读取时校验内容，文件丢失或被外部改动会明确报错。移动、复制、收集素材、导出项目包和收录到资产库都会带上这些文件。改源码就是创建新版本，见 [参数与曲线](parameters-curves.md) 的“换源码版本”。

## 项目组件库

同一项目里多条素材、多个剪辑都会用到的部件（人名条、角标、品牌底板、常用转场形状），发布成项目组件：

1. 在剪辑文档下 `create_items`，entityType 为 `video_edit.code_component`，属性 `video_edit.code_component.name`（中文名即可）、`video_edit.code_component.source`（模块源码，规则同上面的模块文件，不能 export default）、`video_edit.code_component.description`（这个组件做什么、导出哪些函数、参数含义）。同名再次创建就是发布新版本，旧版本保留。
2. 素材源码里 `import { lowerThird } from "@组件/人名条"` 引用最新版本，或 `"@组件/人名条@2"` 固定第 2 版。组件也可以导入别的组件，不能循环。
3. 保存素材版本时，引用会被钉住到当时的组件版本；之后组件再发新版，已有素材画面不变。要用新组件，给素材创建一个新版本。
4. 开工前先 `list_application_entities` 列出 `video_edit.code_component`，propertyIds 带上 latest_version、exports、description（不带只返回引用），能复用就复用，别重复写同一个部件。
5. 被素材引用的组件版本不能删除；读组件可以看到哪些素材在用它。

组件函数也遵循参数化：接收一个属性对象（尺寸、颜色、文字、进度），由调用它的素材把自己的参数传进去。模块和组件拿不到 ctx，函数参数也不能叫 ctx；需要画面宽高、时间时作为参数传入。这样同一个组件在不同素材里能有不同外观。
