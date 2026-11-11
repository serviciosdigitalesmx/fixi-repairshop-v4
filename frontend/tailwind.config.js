/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#f4fdfd',
          100: '#ecfcfc',
          200: '#c5f5f7',
          300: '#a5edf0',
          400: '#7be5e9',
          500: '#4cdae0',
          600: '#25d2d9',
          700: '#1bbbc2',
          800: '#08777c',
          900: '#075e63',
        },
      },
      fontFamily: {
        sans: ['Inter', 'Segoe UI Variable', 'Segoe UI', 'system-ui', '-apple-system', 'sans-serif'],
        display: ['Inter', 'Segoe UI Variable', 'Segoe UI', 'system-ui', 'sans-serif'],
        mono: ['DM Mono', 'Cascadia Code', 'SFMono-Regular', 'Consolas', 'monospace'],
      },
      boxShadow: {
        panel: '0 1px 2px rgba(15, 32, 39, 0.03), 0 12px 36px rgba(15, 32, 39, 0.055)',
        float: '0 20px 60px rgba(10, 26, 33, 0.16)',
      },
    },
  },
  plugins: [],
}
