# 字幕、花字、关键词与人名条

配方只示范写法与常见做法，不是推荐风格；配色、时长、幅度按风格说明书或需求改。

先区分“要能导出字幕文本”还是“需要图形编排”。原文、姓名、译文不能为省空间截断；字幕数量、行数不设产品上限。

## 中文字幕起点

通常每行约16字、两行、每秒不超过9字；单条1–7秒是阅读起点而非系统限制。长内容按语义分段或延长；两行可上短下长，不拆专名／词组。1080p字号44–56，底部居中，浅字＋深描边或半透明底；竖屏避开底部按钮区，人物旁文字不盖下巴／手势。

无指定规范时可提议句中逗号／句末句号转为空格，保留问号与叹号、避免叠用；不能静默改用户要求忠实保留的标点。阅读速度按最终可见文字与时间复核，双语上下行要留更多空间，不只按原文算。

## 两条真实路线

| 需求 | 做法与边界 |
| --- | --- |
| 普通台词／双语／SRT、VTT | video_edit.caption挂序列；创建必填start/duration/text（整数序列帧）；可写translation、style、clip_id。先describe_application_entities查字段，change_application_entities合并同目的写入；clip_id绑定时随片段修剪／移位，未绑定为序列锚定 |
| 静态综艺字幕风格 | caption.style整体读改写：fontFamily/fontWeight/fontSize、fill、strokes多层、shadows多层、background、tracking、leading、align/verticalAlign、bottomMargin。空间量按1080p参考缩放，bottomMargin为0–1；保留原其他样式字段，空字符串恢复默认 |
| 花字逐字蹦出／关键词多色／人名条自适应 | 代码生成器：排版库 henji-layout 排版与逐字绘制＋text/textStyle 参数；普通片段叠到当前时间线。它是画面素材，不能替代caption实体参加字幕文本导出；需字幕时保留原caption |

caption.style没有字符范围样式或逐字动画字段；不能给caption虚构wordColors或动画器。普通整句高亮改style.fill；只高亮关键词时用独立代码短语：layoutText 传富文本（一段多个 run，各 run 用 `{ ...params.style, fill }` 换色）或按词分段排版，不编造characterRange。自动识别／翻译可能计费，按正式能力授权，不因配方加载自动调用。

## 画面上写什么

画面文字只承载信息：名称、步骤、参数、数据、产品与模型名，以及帮观众看懂概念的短标签（“STEP 01 · 整理思路”“1250 亿参数”）。概念由口播讲，画面不复述整句，也不替作者插话。

换说法，不照抄口播（花字、节点标签、标题、说明都适用）：上屏文案和口播同时出现，字面一样就像第二条字幕。表达同一个意思，但换成更短、更像标签的说法，提炼结论而不是转写：“用本地 AI 就不用担心 token 消耗了”→“无限 Token”；“想到一个点子马上就能试，一直试到满意为止”→“想试就试”。专有名词、数字、型号照写。批量核对不用逐帧看：从源码的 text 参数与花字表里取出全部上屏字符串，读 `video_edit.sequence.transcript` 求最长公共子串，或逐条用 `query_video_edit_transcript` 按 text 检索；覆盖率高、与原句相同或只删了几个字的列出来逐条重写（实测一次扫出 131 条文案中 7 处照抄）。

默认不上屏：口语和招呼（“直接拿去玩”“搞定”“各位”）、感叹和牢骚、自嘲、调侃、号召或推销口吻；口播里说了画面也不跟着写，用户明确要求才放。用户要吐槽或气泡时，写成这个人当下真会说的一句话（“这真的是一只兔子，信我”），不贴“吐槽”“梗”这类用途标签；小标题要么省略，要么写有信息的内容（“画画水平”“说实话”）。拿不准一句该不该上屏时不放，或先问用户。

## 花字与关键词

花字不替代字幕；一句强调几个词、配色怎样变化由风格定，同一部片里同类情绪用同一套更好认。主文字粗圆／标题字；深内描边与浅外描边可从字号各12%起试，硬投影距离约.08字号，底板按排版结果的 box 算。多层描边与投影写进 textStyle 的 strokes（外到内）、shadows，drawText 按文字工具同一套遮罩合成，不要自己叠 strokeText；不要复制旧像素尺寸。

入场.2–.35秒，可一次backOut过冲8–15%、字间1–2帧；停留静止，晃动有语义才用且约±2°；离场.15–.25秒缩小淡出。读字至少每字.25秒＋.5秒，不把冲击动画算进完全可读停留。短pop／ding／whoosh对齐落地帧，只用已有或授权音效。强调色一屏通常给一两处，其他退后；避开脸和字幕。

## 完整人名条

左／右下安全区，名字大、头衔小。底板用 `layoutBoxes` 包住两行字：宽高跟着较宽的一行与边距走，太长在最大宽度内折行、不截断；头衔为空取消第二行，姓名为空整组隐藏。底板quartOut展开.45秒，名字晚.15秒、头衔晚.25秒；退出全组淡出.3秒。样例展示秒数为源时钟参数，裁短／变速时同步时间线与参数，不自动保护入退场。

```ts
import { layoutBoxes } from "henji-layout/flex"
import { drawText } from "henji-layout/text"
const clamp01 = v => Math.min(1, Math.max(0, v))
const quartOut = t => 1 - (1 - t) ** 4
export default {
  name: "自适应人名条", kind: "generator", mode: "dynamic", width: 1920, height: 1080, durationSeconds: 8,
  params: [
    { key: "name", type: "text", title: "姓名", default: "林晓", maxLength: 80, layer: "lower-third" },
    { key: "role", type: "text", title: "头衔", default: "创作总监", maxLength: 120, layer: "lower-third" },
    { key: "nameStyle", type: "textStyle", title: "姓名样式", layer: "lower-third", default: { fontSize: 64, fontWeight: 700, align: "left", fill: { color: "#f2f5f7" } } },
    { key: "roleStyle", type: "textStyle", title: "头衔样式", layer: "lower-third", default: { fontSize: 38, align: "left", fill: { color: "#f2f5f7" } } },
    { key: "accent", type: "color", title: "底板颜色", default: "#14404d" },
    { key: "seconds", type: "number", title: "展示秒数", default: 6, min: 2, max: 8, step: .1 }
  ],
  layers(params, width, height) {
    const s = params.nameStyle.fontSize, pad = s * .45
    const rows = [{ id: "name", text: { content: params.name, style: params.nameStyle } }]
    if (params.role !== "") rows.push({ id: "role", text: { content: params.role, style: params.roleStyle } })
    const boxes = layoutBoxes({
      id: "root", style: { flexDirection: "column", justifyContent: "end", alignItems: "start", padding: { left: width * .06, bottom: height * .22 } },
      children: [{ id: "card", style: { flexDirection: "column", gap: s * .3, padding: { left: pad, right: pad, top: pad * .5, bottom: pad * .5 }, maxWidth: width * .72 }, children: rows }]
    }, { width, height })
    const card = boxes.card
    return [{ id: "lower-third", bounds: [card.x, card.y, card.x + card.width, card.y + card.height],
      pose: t => params.name === "" ? null : { opacity: 1 - clamp01((t - (params.seconds - .3)) / .3) },
      draw(ctx, time) {
        ctx.fillStyle = params.accent; ctx.beginPath()
        ctx.roundRect(card.x, card.y, Math.max(1, card.width * quartOut(clamp01(time / .45))), card.height, Math.min(s * .3, card.height / 2)); ctx.fill()
        rows.forEach((row, i) => {
          const box = boxes[row.id]
          if (!box.text) return
          ctx.save(); ctx.globalAlpha = clamp01((time - .15 - i * .1) / .3)
          ctx.translate(box.contentBox.x, box.contentBox.y); drawText(ctx, box.text); ctx.restore()
        })
      } }]
  }
}
```

入场中间文字可能早于底板完全展开，取帧看包裹关系；需要严格遮罩就按底板当前宽度 `ctx.clip()` 后再画文字（drawText 遵守 clip）。压测：单字名＋CEO、长英文头衔、中英混排、空头衔、空姓名、换字体、字号翻倍。底板高度／安全区溢出就重排或分拍，不横压。

建议发布为项目组件：提取 `lowerThird(params)` 返回图层的工厂函数并具名导出；发布 video_edit.code_component 并写明意图，素材具名导入 @组件/人名条，图层写 `factory` 便于跳转。发布模块不含 export default，完整素材保留入口；钉版本与更新见 multifile-components。仅换姓名／头衔优先改实例code_parameters。
