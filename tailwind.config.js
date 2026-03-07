/** @type {import('tailwindcss').Config} */
const withOpacity = (variable) => `rgb(var(${variable}) / <alpha-value>)`

export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
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
        // 暗色主题
        dark: {
          bg: '#0a0b0d',
          'bg-secondary': '#1a1a1a',
          text: '#ffffff',
          'text-secondary': '#a0a0a0',
          border: '#404040',
          accent: '#007eff',
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
