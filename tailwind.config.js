/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // 暗色主题
        dark: {
          bg: '#000000',
          'bg-secondary': '#1a1a1a',
          text: '#ffffff',
          'text-secondary': '#a0a0a0',
          border: '#404040',
          accent: '#3b82f6',
        }
      }
    },
  },
  plugins: [],
  darkMode: 'class',
}