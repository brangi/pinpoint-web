/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: 'class',
  content: [
    './live.html',
    './index.html',
    './js/**/*.js',
  ],
  theme: {
    extend: {
      colors: {
        dark: {
          900: '#0A0E17',
          800: '#111827',
          700: '#1F2937',
        },
        blue: {
          400: '#60A5FA',
          500: '#3B82F6',
          600: '#2563EB',
        },
        brand: {
          green: '#34C759',
          orange: '#FF9500',
          red: '#FF3B30',
        },
      },
      fontFamily: {
        display: ['Clash Display', 'system-ui', 'sans-serif'],
        body: ['Satoshi', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        card: '0 4px 12px rgba(0,0,0,0.06)',
        'card-dark': '0 4px 12px rgba(0,0,0,0.25)',
        elevated: '0 12px 32px rgba(0,0,0,0.10)',
        'elevated-dark': '0 12px 32px rgba(0,0,0,0.40)',
      },
    },
  },
  plugins: [],
};
