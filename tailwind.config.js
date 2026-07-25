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
      },
      // 浮层阴影唯一档位。内容区一律不用阴影，层次靠间距与排版建立。
      // 取值刻意与 Tailwind shadow-2xl 完全一致，使现有 UiPanel 换名后像素无变化；
      // 若后续要调整浮层阴影观感，只改这一处。
      boxShadow: {
        panel: '0 25px 50px -12px rgb(0 0 0 / 0.25)',
      },
      // 浮层层级：禁止再出现 z-[9999] / z-[2147483647] 这类任意值
      zIndex: {
        base: '0',
        raised: '10',
        sticky: '20',
        dropdown: '30',
        panel: '40',
        modal: '50',
        toast: '60',
        drag: '70',
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
