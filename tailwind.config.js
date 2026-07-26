/** @type {import('tailwindcss').Config} */
const withOpacity = (variable) => `rgb(var(${variable}) / <alpha-value>)`

export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      // 字号令牌：Tailwind 最小档 text-xs 是 12px，项目实际需要 9~11px 三档。
      // 刻意使用字符串形式（只产出 font-size，不带 line-height），
      // 与原先散落的 text-[11px] / text-[10px] / text-[9px] 计算值完全一致。
      fontSize: {
        '4xs': '9px',
        '3xs': '10px',
        '2xs': '11px',
        // 13/14/15px 档：Tailwind 无对应步进（或对应步进会强制带上 line-height）。
        // 同样用字符串形式，只产出 font-size，用于行高需要由 leading-* 或继承决定的场景。
        13: '13px',
        14: '14px',
        15: '15px',
      },
      // 浮层阴影唯一档位。内容区一律不用阴影，层次靠间距与排版建立。
      // 取值刻意与 Tailwind shadow-2xl 完全一致，使现有 UiPanel 换名后像素无变化；
      // 若后续要调整浮层阴影观感，只改这一处。
      //
      // 其余档位是「登记过的特效阴影」：它们不是层次装饰，而是有具体功能语义
      // （选中描边 / 失败描边 / 堆叠缩略图立体感），不可用 shadow-panel 替代。
      // 新增特效阴影必须在此登记具名档位，禁止在业务组件写 shadow-[...]。
      boxShadow: {
        panel: '0 25px 50px -12px rgb(0 0 0 / 0.25)',
        // 画布节点选中描边。刻意走 --accent-rgb：此前硬编码 rgba(59,130,246) 是默认强调色，
        // 用户在设置里改 accentColor 后描边不跟随，而紧邻的 border-accent 却会跟随，导致颜色不一致。
        'node-selected': '0 0 0 1px rgb(var(--accent-rgb) / 0.32)',
        // 画布节点生成失败描边（配合 NodeGenerationError 覆盖层）
        'node-error': '0 0 0 1px rgb(239 68 68 / 0.28)',
        // 堆叠媒体缩略图的立体感
        thumb: '0 8px 16px rgb(0 0 0 / 0.45)',
        'thumb-sm': '0 6px 14px rgb(0 0 0 / 0.42)',
      },
      borderRadius: {
        // 时间轴关键帧菱形标记的极小圆角
        hairline: '1px',
      },
      borderWidth: {
        1.5: '1.5px',
      },
      // 浮层层级契约。档位是从实际代码里的层序需求反推出来的，不是拍脑袋定的：
      // 媒体查看器必须盖住弹窗、tooltip 必须盖住通知、无边框标题栏必须盖住一切，
      // 所以在 modal 之上还需要 viewer / toast / tooltip / drag / titlebar 五档。
      //
      // 新增浮层时从下往上挑第一个够用的档位，禁止再写 z-[9999] / z-[2147483647]。
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
        tooltip: '80', // tooltip（需要盖住通知）
        drag: '90', // 拖拽预览/跟随层
        titlebar: '100', // 无边框窗口标题栏与窗口控制按钮
      },
      colors: {
        bg: {
          DEFAULT: withOpacity('--bg-rgb'),
          dark: withOpacity('--bg-rgb'),
        },
        surface: {
          DEFAULT: withOpacity('--surface-rgb'),
          dark: withOpacity('--surface-rgb'),
        },
        border: {
          DEFAULT: withOpacity('--border-rgb'),
          dark: withOpacity('--border-rgb'),
        },
        text: {
          DEFAULT: withOpacity('--text-rgb'),
          dark: withOpacity('--text-rgb'),
        },
        'text-muted': {
          DEFAULT: withOpacity('--text-muted-rgb'),
          dark: withOpacity('--text-muted-rgb'),
        },
        // 文字四档：text（标题/强调） > text-soft（次要正文） > text-muted（说明）
        // > text-faint（占位/禁用）。中间两档由 runtimeTheme.applyTextScale 从
        // text/text-muted 派生，取代此前硬编码的 text-zinc-300 / text-zinc-500
        // ——那两个不会跟随主题预设，切到「石墨灰阶」后会和周围语义色脱节。
        'text-soft': {
          DEFAULT: withOpacity('--text-soft-rgb'),
          dark: withOpacity('--text-soft-rgb'),
        },
        'text-faint': {
          DEFAULT: withOpacity('--text-faint-rgb'),
          dark: withOpacity('--text-faint-rgb'),
        },
        // 白色半透明「薄纱」层：画布节点边框、玻璃质感底色、渐变高光统一走这套档位。
        // 此前散落 49 处 rgba(255,255,255,X) 字面量、共 14 种不同透明度，
        // 既违反「禁止 rgb/rgba 字面量」，也让同一视觉意图有十几种写法。
        // 收敛为 6 档；新增用法必须复用这里的档位，不要再写 rgba 字面量。
        veil: {
          faint: 'rgb(255 255 255 / 0.04)',
          subtle: 'rgb(255 255 255 / 0.10)',
          soft: 'rgb(255 255 255 / 0.16)',
          DEFAULT: 'rgb(255 255 255 / 0.22)',
          strong: 'rgb(255 255 255 / 0.34)',
          bright: 'rgb(255 255 255 / 0.40)',
        },
        accent: withOpacity('--accent-rgb'),
        success: withOpacity('--success-rgb'),
        warning: withOpacity('--warning-rgb'),
        danger: withOpacity('--danger-rgb'),
        app: withOpacity('--app-rgb'),
        canvas: withOpacity('--canvas-rgb'),
        panel: withOpacity('--panel-rgb'),
        layer: withOpacity('--layer-rgb'),
        brand: {
          300: withOpacity('--brand-300-rgb'),
          500: withOpacity('--brand-500-rgb'),
          600: withOpacity('--brand-600-rgb'),
          700: withOpacity('--brand-700-rgb'),
        },
        // 暗色主题
        dark: {
          bg: '#0a0a0a',
          'bg-secondary': '#171717',
          text: '#ffffff',
          'text-secondary': '#a3a3a3',
          border: '#404040',
          accent: '#3b82f6',
        }
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
      animation: {
        'scale-in': 'scale-in 0.1s ease-out',
        'scale-out': 'scale-out 0.2s ease-out',
        'scaleIn': 'scaleIn 0.1s ease-out',
        'radioDotAppear': 'radioDotAppear 0.2s ease-out'
      }
    },
  },
  plugins: [],
  darkMode: 'class',
}
