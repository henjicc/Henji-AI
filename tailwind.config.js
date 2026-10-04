/** @type {import('tailwindcss').Config} */
// 不透明令牌：走 `--{token}-rgb` 三元组，支持 `bg-panel/60` 这类透明度修饰。
const withOpacity = (variable) => `rgb(var(${variable}) / <alpha-value>)`
// 自带透明度的令牌（浅底、遮罩、媒体叠层等）：直接取完整颜色，不支持透明度修饰。
const cssVar = (variable) => `var(${variable})`
// 阴影颜色按主题的 `shade` 令牌取比例：深色 shade = 黑 50%，浅色 = 冷灰 18%。
// 比例按原深色数值反推（如 0.25 = shade 50%），深色观感不变、浅色自动变浅。
const shade = (percent) => `color-mix(in srgb, var(--shade) ${percent}%, transparent)`

export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    // 阴影颜色工具类（shadow-{color}）默认取全部颜色，其中 `panel` 与阴影档位 shadow-panel 同名：
    // 两条规则会同时命中，后出现的 `--tw-shadow: var(--tw-shadow-colored)` 把浮层投影换成不透明的面板色。
    // 这里去掉同名键，shadow-panel 只表示浮层阴影档位。
    boxShadowColor: ({ theme }) => {
      const { panel: _panel, ...colors } = theme('colors')
      return colors
    },
    extend: {
      // 字体：拉丁字母与数字 Geist / Geist Mono（@fontsource-variable，随包、离线可用，SIL OFL 1.1），
      // 中文按平台回落系统字体（重要记录 004）：Windows 微软雅黑 UI，macOS 苹方，Linux 思源/Noto。
      // 浏览器逐字回落：Geist 没有的汉字自动取下一个含该字的字体，不需要拆 unicode-range。
      fontFamily: {
        sans: [
          '"Geist Variable"',
          '"Microsoft YaHei UI"',
          '"Microsoft YaHei"',
          '"PingFang SC"',
          '"Hiragino Sans GB"',
          '"Noto Sans CJK SC"',
          '"Source Han Sans SC"',
          'system-ui',
          'sans-serif',
          '"Apple Color Emoji"',
          '"Segoe UI Emoji"',
          '"Segoe UI Symbol"',
          '"Noto Color Emoji"',
        ],
        mono: [
          '"Geist Mono Variable"',
          'ui-monospace',
          'SFMono-Regular',
          'Menlo',
          'Consolas',
          '"Microsoft YaHei UI"',
          '"PingFang SC"',
          'monospace',
        ],
      },
      // 字号令牌：Tailwind 最小档 text-xs 是 12px，项目实际需要 9~11px 三档。
      // 刻意使用字符串形式（只产出 font-size，不带 line-height），
      // 与原先散落的 text-[11px] / text-[10px] / text-[9px] 计算值完全一致。
      //
      // 界面文字最小 11px（text-2xs，重要记录 004 的“元信息”档）；10/9px 只允许用于
      // 压在媒体上的叠层读数、标尺刻度和紧凑徽标，调用点逐处登记在 1.3 执行记录。
      // 排版层级优先用 styleTokens.ts 的 UI_TEXT_* 令牌（20/16/14/13/12/11）。
      fontSize: {
        '4xs': '9px',
        '3xs': '10px',
        '2xs': '11px',
        // 13/14/15px 档：Tailwind 无对应步进（或对应步进会强制带上 line-height）。
        // 同样用字符串形式，只产出 font-size，用于行高需要由 leading-* 或继承决定的场景。
        // 13px 是正文与控件的基准字号（body 默认值，见 index.css）。
        13: '13px',
        14: '14px',
        15: '15px',
      },
      // 浮层阴影唯一档位。内容区一律不用阴影，层次靠间距与排版建立。
      // 几何取值与 Tailwind shadow-2xl 一致；颜色走主题 shade 令牌（深色下仍是黑 25%，像素不变）。
      //
      // 其余档位是「登记过的特效阴影」：它们不是层次装饰，而是有具体功能语义
      // （选中描边 / 失败描边 / 堆叠缩略图立体感），不可用 shadow-panel 替代。
      // 新增特效阴影必须在此登记具名档位，禁止在业务组件写 shadow-[...]。
      boxShadow: {
        panel: `0 25px 50px -12px ${shade(50)}`,
        // 画布节点选中描边。刻意走 --accent-rgb：此前硬编码 rgba(59,130,246) 是默认强调色，
        // 用户在设置里改 accentColor 后描边不跟随，而紧邻的 border-accent 却会跟随，导致颜色不一致。
        'node-selected': '0 0 0 1px rgb(var(--accent-rgb) / 0.32)',
        // 画布节点生成失败描边（配合 NodeGenerationError 覆盖层），走危险实底令牌
        'node-error': '0 0 0 1px color-mix(in srgb, var(--danger) 28%, transparent)',
        // 堆叠媒体缩略图的立体感
        thumb: `0 8px 16px ${shade(90)}`,
        // 内容色滑杆（打光亮度/色调）的滑块：白边之外再描 1px 固定深色细线。滑块与轨道都是灯光内容色、
        // 不随主题，纯白滑块停在白端时只靠这圈深线与白边的双色轮廓辨认（4.1：纸白下白端几乎不可见）。
        'thumb-ring': `0 0 0 1px var(--media-scrim), 0 8px 16px ${shade(90)}`,
        'thumb-sm': `0 6px 14px ${shade(84)}`,
      },
      // 把默认缓动改成 ease-out。Tailwind 原本的默认是 ease-in-out（起步和收尾都慢），
      // 在小尺度 UI 上显得拖沓；而"进场退场都该减速落位"是标准动效原则。
      //
      // 改这一处，等于让全部 transition-* 工具类自动拿到正确缓动，
      // 不必在 91 个调用点各写一遍 `ease-out`（那既是噪音，也总会漏）。
      // 需要别的缓动时仍可用 `ease-linear`/`ease-in` 显式覆盖。
      transitionTimingFunction: {
        DEFAULT: 'cubic-bezier(0, 0, 0.2, 1)',
      },
      // 动效时长档位，与 src/components/ui/motion.ts 的 UI_DURATION 一一对应：
      // 120 悬停/小控件、180 展开/弹窗（默认）、240 面板/大面积位移、500 全屏查看器（重要记录 004）。
      // Tailwind 自带档位不删，但 ESLint 只允许 duration-120/180/240/500。
      transitionDuration: {
        120: '120ms',
        180: '180ms',
        240: '240ms',
      },
      // 圆角令牌（重要记录 004）：控件 6 / 输入与菜单 8 / 浮层 12，全部由 CSS 变量驱动，
      // 「设置 → 界面 → 圆角」通过 data-ui-radius 一处改值，界面控件与画布节点一起生效。
      // rounded-md/lg/xl 改指同一组变量：标准档像素与 Tailwind 默认值相同（6/8/12），存量调用点不变。
      borderRadius: {
        control: 'var(--radius-control)',
        field: 'var(--radius-field)',
        overlay: 'var(--radius-overlay)',
        md: 'var(--radius-control)',
        lg: 'var(--radius-field)',
        xl: 'var(--radius-overlay)',
        // 时间轴关键帧菱形标记的极小圆角
        hairline: '1px',
      },
      borderWidth: {
        1.5: '1.5px',
      },
      // 控件高度令牌（重要记录 004）：28 紧凑 / 32 默认 / 36 醒目，由 CSS 变量驱动。
      // 新控件用 h-control-sm/md/lg（或 styleTokens 的 UI_CONTROL_HEIGHT_CLASS），不写 h-7/h-8/h-9。
      height: {
        'control-sm': 'var(--size-control-sm)',
        'control-md': 'var(--size-control-md)',
        'control-lg': 'var(--size-control-lg)',
      },
      minHeight: {
        'control-sm': 'var(--size-control-sm)',
        'control-md': 'var(--size-control-md)',
        'control-lg': 'var(--size-control-lg)',
      },
      minWidth: {
        'control-sm': 'var(--size-control-sm)',
        'control-md': 'var(--size-control-md)',
        'control-lg': 'var(--size-control-lg)',
      },
      // 浮层层级契约。档位是从实际代码里的层序需求反推出来的，不是拍脑袋定的：
      // 媒体查看器必须盖住弹窗、tooltip 必须盖住通知、无边框标题栏必须盖住一切，
      // 所以在 modal 之上还需要 viewer / toast / tooltip / drag / titlebar 五档。
      //
      // 新增浮层时从下往上挑第一个够用的档位，禁止再写 z-[9999] / z-[2147483647]，
      // 也不要写 z-10/z-20 这类数字类（ESLint 拦截），数值相同时用对应语义档。
      // 同档位内的先后由 DOM 顺序或 portal 决定，不要为了插队新增中间档。
      zIndex: {
        base: '0',
        raised: '10', // 文档流内的局部层叠（渐变遮罩、节点内部覆盖层）
        sticky: '20', // 视图内工具栏、粘性头部
        dropdown: '30', // 下拉、气泡、右键菜单、建议列表
        panel: '40', // 悬浮侧栏/面板（助手、资产库）
        modal: '50', // 弹窗及其遮罩
        viewer: '60', // 全屏媒体查看器（需要盖住弹窗）
        toast: '70', // 通知、临时提示
        popover: '75', // 挂到 body 的下拉与面板触发器浮层（可能从弹窗、查看器里打开，必须盖住它们）
        tooltip: '80', // tooltip（需要盖住通知）
        drag: '90', // 拖拽预览/跟随层
        titlebar: '100', // 无边框窗口标题栏与窗口控制按钮
      },
      // 颜色：界面只引用语义令牌（重要记录 002），值由主题引擎按种子推导后写到根节点。
      //
      // 命名规则：类名里的颜色名 = 令牌的 CSS 变量名去掉 `--`（src/core/theme/themeCssVars.ts），
      // 例如 --control-hover → bg-control-hover、--text2 → text-text2、--on-accent → text-on-accent、
      // --media-line → border-media-line。唯一例外见 clip.title。
      //
      // 旧类名（bg-app / bg-surface-dark / text-text-muted / bg-brand-500 …）保留为别名，直接指向
      // 1.1 映射表里的新令牌；调用点迁移由 2.x/3.x 按用途完成，4.2 删除别名。
      colors: {
        // —— 表面 ——
        gap: withOpacity('--gap-rgb'),
        window: withOpacity('--window-rgb'),
        canvas: withOpacity('--canvas-rgb'),
        panel: withOpacity('--panel-rgb'),
        raised: withOpacity('--raised-rgb'),
        control: {
          DEFAULT: withOpacity('--control-rgb'),
          hover: withOpacity('--control-hover-rgb'),
          pressed: withOpacity('--control-pressed-rgb'),
        },
        hover: withOpacity('--hover-rgb'),
        selected: withOpacity('--selected-rgb'),
        // 选中淡强调底（重要记录 012，任务 4.3）：bg-selected-accent / bg-selected-accent-hover
        'selected-accent': {
          DEFAULT: cssVar('--selected-accent'),
          hover: cssVar('--selected-accent-hover'),
        },
        line: {
          DEFAULT: withOpacity('--line-rgb'),
          strong: withOpacity('--line-strong-rgb'),
        },
        edge: cssVar('--edge'),
        // 媒体底与固定媒体叠层（不随主题：压在图片/视频上的控件、文字、渐变与描边）
        media: {
          DEFAULT: withOpacity('--media-rgb'),
          control: cssVar('--media-control'),
          'control-hover': cssVar('--media-control-hover'),
          scrim: cssVar('--media-scrim'),
          line: cssVar('--media-line'),
        },
        scrim: {
          DEFAULT: cssVar('--scrim'),
          soft: cssVar('--scrim-soft'),
          solid: cssVar('--scrim-solid'),
        },
        // —— 文字 ——（text1 主要 / text2 次要 / text3 辅助，均保证 ≥ 4.5:1）
        text1: withOpacity('--text1-rgb'),
        text2: withOpacity('--text2-rgb'),
        text3: withOpacity('--text3-rgb'),
        text: {
          // 旧别名：text-text-dark → text1
          DEFAULT: withOpacity('--text1-rgb'),
          dark: withOpacity('--text1-rgb'),
          disabled: withOpacity('--text-disabled-rgb'),
        },
        // 旧别名：说明/图标默认色 → text2；元信息与占位应由调用点改 text3
        'text-muted': {
          DEFAULT: withOpacity('--text2-rgb'),
          dark: withOpacity('--text2-rgb'),
        },
        // 旧别名：次要正文 → text2
        'text-soft': {
          DEFAULT: withOpacity('--text2-rgb'),
          dark: withOpacity('--text2-rgb'),
        },
        // 旧别名：占位、弱提示 → text3
        'text-faint': {
          DEFAULT: withOpacity('--text3-rgb'),
          dark: withOpacity('--text3-rgb'),
        },
        // —— 强调 ——（accent 实底不能直接压文字，文字用 accent-text，实底上的字用 on-accent）
        accent: {
          DEFAULT: withOpacity('--accent-rgb'),
          hi: withOpacity('--accent-hi-rgb'),
          hover: withOpacity('--accent-hover-rgb'),
          'hover-hi': withOpacity('--accent-hover-hi-rgb'),
          pressed: withOpacity('--accent-pressed-rgb'),
          text: withOpacity('--accent-text-rgb'),
          ring: withOpacity('--accent-ring-rgb'),
          tint: cssVar('--accent-tint'),
        },
        // —— 状态 ——
        // 过渡期：danger/success/warning 的 DEFAULT 是旧别名，指向 *-text（旧用法以文字为主），
        // 实底用 *-solid。4.2 删除旧别名后 DEFAULT 回到实底（与 --danger 同名），*-solid 随之合并。
        danger: {
          DEFAULT: withOpacity('--danger-text-rgb'),
          solid: cssVar('--danger'),
          hi: withOpacity('--danger-hi-rgb'),
          hover: withOpacity('--danger-hover-rgb'),
          'hover-hi': withOpacity('--danger-hover-hi-rgb'),
          pressed: withOpacity('--danger-pressed-rgb'),
          text: withOpacity('--danger-text-rgb'),
          tint: cssVar('--danger-tint'),
        },
        success: {
          DEFAULT: withOpacity('--success-text-rgb'),
          solid: cssVar('--success'),
          text: withOpacity('--success-text-rgb'),
          tint: cssVar('--success-tint'),
        },
        warning: {
          DEFAULT: withOpacity('--warning-text-rgb'),
          solid: cssVar('--warning'),
          text: withOpacity('--warning-text-rgb'),
          tint: cssVar('--warning-tint'),
        },
        // 实底上的文字：text-on-accent / on-danger / on-success / on-warning / on-media
        on: {
          accent: withOpacity('--on-accent-rgb'),
          danger: withOpacity('--on-danger-rgb'),
          success: withOpacity('--on-success-rgb'),
          warning: withOpacity('--on-warning-rgb'),
          media: withOpacity('--on-media-rgb'),
        },
        // —— 素材片段与波形 ——
        clip: {
          video: withOpacity('--clip-video-rgb'),
          'video-line': withOpacity('--clip-video-line-rgb'),
          audio: withOpacity('--clip-audio-rgb'),
          'audio-line': withOpacity('--clip-audio-line-rgb'),
          // 文字片段（--clip-text）：不叫 clip.text，因为 bg-clip-text 是 Tailwind 的 background-clip 工具类，
          // 同名会让两条声明叠在一起。
          title: withOpacity('--clip-text-rgb'),
          'title-line': withOpacity('--clip-text-line-rgb'),
          wave: withOpacity('--clip-wave-rgb'),
        },
        wave: {
          DEFAULT: withOpacity('--wave-rgb'),
          played: withOpacity('--wave-played-rgb'),
          cut: withOpacity('--wave-cut-rgb'),
        },
        // —— 旧别名（1.1 第七节映射；4.2 删除）——
        // bg-bg-dark → gap（媒体/视口由调用点改 media）
        bg: {
          DEFAULT: withOpacity('--gap-rgb'),
          dark: withOpacity('--gap-rgb'),
        },
        // bg-surface-dark → raised（按钮由 2.1 改 control，悬停改 hover）
        surface: {
          DEFAULT: withOpacity('--raised-rgb'),
          dark: withOpacity('--raised-rgb'),
        },
        // border-border-dark → line（更强分区由调用点改 line-strong）
        border: {
          DEFAULT: withOpacity('--line-rgb'),
          dark: withOpacity('--line-rgb'),
        },
        // bg-app → window
        app: withOpacity('--window-rgb'),
        // bg-layer → hover（选中由调用点改 selected）
        layer: withOpacity('--hover-rgb'),
        brand: {
          300: withOpacity('--accent-text-rgb'),
          500: withOpacity('--accent-rgb'),
          600: withOpacity('--accent-pressed-rgb'),
          700: withOpacity('--accent-pressed-rgb'),
        },
        // 白色半透明「薄纱」层：画布节点边框、玻璃质感底色、渐变高光统一走这套档位。
        // 固定白色，只适合压在媒体/深色画布上；界面面上的边与底由 2.x/3.6 按位置改
        // line / hover / raised 或媒体叠层令牌（media-line 等），本组不随主题。
        veil: {
          faint: 'rgb(255 255 255 / 0.04)',
          subtle: 'rgb(255 255 255 / 0.10)',
          soft: 'rgb(255 255 255 / 0.16)',
          DEFAULT: 'rgb(255 255 255 / 0.22)',
          strong: 'rgb(255 255 255 / 0.34)',
          bright: 'rgb(255 255 255 / 0.40)',
        },
      },
      keyframes: {
        scaleIn: {
          '0%': { opacity: '0', transform: 'scale(0.95)' },
          '100%': { opacity: '1', transform: 'scale(1)' }
        },
        'scale-in': {
          '0%': { opacity: '0', transform: 'scale(0.95)' },
          '100%': { opacity: '1', transform: 'scale(1)' }
        },
        'scale-out': {
          '0%': { opacity: '1', transform: 'scale(1)' },
          '100%': { opacity: '0', transform: 'scale(0.95)' }
        },
        radioDotAppear: {
          '0%': { transform: 'translate(-50%, -50%) scale(0)' },
          '100%': { transform: 'translate(-50%, -50%) scale(1)' }
        }
      },
      // 时长与 UI_DURATION 同档：展开 120（fast）、收起 180（base，Dropdown/PanelTrigger 的卸载计时同值）
      animation: {
        'scale-in': 'scale-in 120ms ease-out',
        'scale-out': 'scale-out 180ms ease-out',
        'scaleIn': 'scaleIn 120ms ease-out',
        'radioDotAppear': 'radioDotAppear 180ms ease-out'
      }
    },
  },
  plugins: [],
  // 全仓没有 dark: 变体，主题由引擎写变量切换；保留 class 策略只是为了让误写的 dark: 永不随系统偏好生效。
  darkMode: 'class',
}
