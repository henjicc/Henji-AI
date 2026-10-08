# 字幕、花字、关键词与人名条

先区分“要能导出字幕文本”还是“需要图形编排”。原文、姓名、译文不能为省空间截断；字幕数量、行数不设产品上限。

## 中文字幕起点

通常每行约16字、两行、每秒不超过9字；单条1–7秒是阅读起点而非系统限制。长内容按语义分段或延长；两行可上短下长，不拆专名／词组。1080p字号44–56，底部居中，浅字＋深描边或半透明底；竖屏避开底部按钮区，人物旁文字不盖下巴／手势。

无指定规范时可提议句中逗号／句末句号转为空格，保留问号与叹号、避免叠用；不能静默改用户要求忠实保留的标点。阅读速度按最终可见文字与时间复核，双语上下行要留更多空间，不只按原文算。

## 两条真实路线

| 需求 | 做法与边界 |
| --- | --- |
| 普通台词／双语／SRT、VTT | video_edit.caption挂序列；创建必填start/duration/text（整数序列帧）；可写translation、style、clip_id。先describe_application_entities查字段，change_application_entities合并同目的写入；clip_id绑定时随片段修剪／移位，未绑定为序列锚定 |
| 静态综艺字幕风格 | caption.style整体读改写：fontFamily/fontWeight/fontSize、fill、strokes多层、shadows多层、background、tracking、leading、align/verticalAlign、bottomMargin。空间量按1080p参考缩放，bottomMargin为0–1；保留原其他样式字段，空字符串恢复默认 |
| 花字逐字蹦出／关键词多色／人名条自适应 | 代码生成器text/group/perChar/measureText＋参数；普通片段叠到当前时间线。它是画面素材，不能替代caption实体参加字幕文本导出；需字幕时保留原caption |

caption.style没有字符范围样式／perChar动画字段；不能给caption虚构wordColors或动画器。普通整句高亮改style.fill；只高亮关键词时用独立代码短语或拆开text片段按measureText排，不编造characterRange。自动识别／翻译可能计费，按正式能力授权，不因配方加载自动调用。

## 花字与关键词

一句话通常只强调一个词，花字不替代字幕；配色按情绪固定两三套，不每次换风格。主文字粗圆／标题字；深内描边与浅外描边可从字号各12%起试，硬投影距离约.08字号，底板量字。代码单个text只有一层stroke，多层描边按外宽字在下、内窄字在上、填充字最上，同一字体、布局、perChar进度；不要复制旧像素尺寸。

入场.2–.35秒，可一次backOut过冲8–15%、字间1–2帧；停留静止，晃动有语义才用且约±2°；离场.15–.25秒缩小淡出。读字至少每字.25秒＋.5秒，不把冲击动画算进完全可读停留。短pop／ding／whoosh对齐落地帧，只用已有或授权音效。强调色一屏通常给一两处，其他退后；避开脸和字幕。

## 完整人名条

左／右下安全区，名字大、头衔小。宽取两者较宽＋边距；头衔为空取消第二行，姓名为空整组隐藏。底板quartOut展开.45秒，名字晚.15秒、头衔晚.25秒；退出全组淡出.3秒。样例展示秒数为源时钟参数，裁短／变速时同步时间线与参数，不自动保护入退场。

```ts
export default {
  apiVersion: 1, languageVersion: 3, name: "自适应人名条",
  kind: "generator", mode: "dynamic", width: 1920, height: 1080,
  durationSeconds: 8, seed: 6,
  parameters: {
    name: {type: "text", title: "姓名", default: "林晓", maxLength: 80},
    role: {type: "text", title: "头衔", default: "创作总监", maxLength: 120},
    font: {type: "font", title: "字体", default: "sans-serif"},
    size: {type: "number", title: "姓名字号", default: 64, min: 28, max: 120, step: 1},
    accent: {type: "color", title: "底板颜色", default: [.08,.25,.3,1]},
    seconds: {type: "number", title: "展示秒数", default: 6, min: 2, max: 8, step: .1}
  },
  render(ctx) {
    const s = ctx.params.size;
    const pad = s * .45;
    const limit = ctx.width * .72;
    const a = measureText({text: ctx.params.name, fontFamily: ctx.params.font,
      fontSize: s, fontWeight: 700, lineHeight: 1.2, maxWidth: limit, wrap: true});
    const b = measureText({text: ctx.params.role, fontFamily: ctx.params.font,
      fontSize: s * .6, lineHeight: 1.2, maxWidth: limit, wrap: true});
    const hasRole = ctx.params.role !== "";
    const w = max(a.width, hasRole ? b.width : 0) + pad * 2;
    const h = a.height + (hasRole ? s * .3 + b.height : 0) + pad;
    const leave = 1 - progress(ctx.time, ctx.params.seconds - .3, .3);
    return [group({id: "lowerThird", x: ctx.width * .06, y: ctx.height * .78 - h,
      opacity: ctx.params.name === "" ? 0 : leave}, [
      rect({id: "plate", x: 0, y: 0, width: max(1, w * quartOut(progress(ctx.time, 0, .45))),
        height: h, radius: min(s * .3, h / 2), fill: ctx.params.accent}),
      text({id: "name", x: pad, y: pad * .5, text: ctx.params.name,
        fontFamily: ctx.params.font, fontSize: s, fontWeight: 700, baseline: "top",
        lineHeight: 1.2, maxWidth: limit, wrap: true, color: ctx.style.palette.fg,
        opacity: progress(ctx.time, .15, .3)}),
      text({id: "role", x: pad, y: pad * .5 + a.height + s * .3, text: ctx.params.role,
        fontFamily: ctx.params.font, fontSize: s * .6, baseline: "top",
        lineHeight: 1.2, maxWidth: limit, wrap: true, color: ctx.style.palette.fg,
        opacity: hasRole ? progress(ctx.time, .25, .3) : 0})
    ])];
  }
}
```

入场中间文字可能早于底板完全展开，取帧看包裹关系；需要严格遮罩就用group.clip同步底板宽，保持文字局部坐标。压测：单字名＋CEO、长英文头衔、中英混排、空头衔、空姓名、换字体、字号翻倍。底板高度／安全区溢出就重排或分拍，不横压。

建议发布为项目组件：提取lowerThird(props)导出纯函数，参数接文字、字体、色彩、时刻与画幅（不能用ctx形参）；发布video_edit.code_component并写明意图，素材具名导入@组件/人名条。发布模块不含export default，完整素材样例保留入口；钉版本与更新见multifile-components。仅换姓名／头衔优先改实例code_parameters。
