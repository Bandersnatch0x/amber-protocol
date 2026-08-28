/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        obsidian: {
          void: '#080B10',
          surface: '#0F141C',
          elevated: '#151D28',
          inset: '#1B2433',
          border: 'rgba(255, 255, 255, 0.08)',
          'border-hover': 'rgba(255, 255, 255, 0.18)',
          'border-active': 'rgba(245, 158, 11, 0.35)',
        },
        porcelain: {
          void: '#F8FAFC',
          surface: '#FFFFFF',
          elevated: '#FFFFFF',
          inset: '#F1F5F9',
          border: '#E2E8F0',
          'border-hover': '#CBD5E1',
        },
        amber: {
          gold: '#F59E0B',
          hover: '#D97706',
          light: '#FDE68A',
          muted: 'rgba(245, 158, 11, 0.12)',
          glow: 'rgba(245, 158, 11, 0.25)',
        },
        cobalt: {
          DEFAULT: '#2563EB',
          hover: '#1D4ED8',
          muted: 'rgba(37, 99, 235, 0.12)',
          glow: 'rgba(37, 99, 235, 0.3)',
        },
        surface: {
          DEFAULT: '#ffffff',
          secondary: '#f8fafc',
          tertiary: '#f1f5f9',
        },
        ink: {
          DEFAULT: '#0f172a',
          secondary: '#475569',
          tertiary: '#94a3b8',
          inverse: '#ffffff',
        },
        accent: {
          DEFAULT: '#2563eb',
          hover: '#1d4ed8',
          muted: '#dbeafe',
        },
        success: {
          DEFAULT: '#10b981',
          muted: '#d1fae5',
        },
        warning: {
          DEFAULT: '#f59e0b',
          muted: '#fef3c7',
        },
        error: {
          DEFAULT: '#f43f5e',
          muted: '#ffe4e6',
        },
      },
      fontFamily: {
        headline: ['Geist', 'Inter', 'sans-serif'],
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
        body: ['Inter', '-apple-system', 'sans-serif'],
        mono: ['JetBrains Mono', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      fontSize: {
        '2xs': ['0.625rem', { lineHeight: '0.875rem' }],
      },
      boxShadow: {
        'glow-amber': '0 0 24px -2px rgba(245, 158, 11, 0.25)',
        'glow-cobalt': '0 0 24px -2px rgba(37, 99, 235, 0.3)',
        'tactile-card': '0 4px 20px -2px rgba(0, 0, 0, 0.08), 0 1px 3px rgba(0, 0, 0, 0.05)',
        'tactile-card-dark':
          '0 8px 32px -4px rgba(0, 0, 0, 0.35), 0 0 0 1px rgba(255, 255, 255, 0.07)',
        'floating-command': '0 24px 64px -12px rgba(0, 0, 0, 0.4), 0 0 0 1px rgba(0, 0, 0, 0.08)',
        'floating-command-dark':
          '0 24px 64px -12px rgba(0, 0, 0, 0.6), 0 0 0 1px rgba(255, 255, 255, 0.12)',
      },
      animation: {
        'fade-in': 'fadeIn 0.2s ease-out',
        'slide-up': 'slideUp 0.2s ease-out',
        'pulse-glow': 'pulseGlow 2.4s ease-in-out infinite',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        slideUp: {
          '0%': { opacity: '0', transform: 'translateY(4px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        pulseGlow: {
          '0%, 100%': { opacity: '0.8', transform: 'scale(1)' },
          '50%': { opacity: '0.3', transform: 'scale(1.4)' },
        },
      },
    },
  },
  plugins: [],
};
