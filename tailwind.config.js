/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        hud: {
          bg: '#02040A',
          card: '#060C18',
          cardBorder: '#121E36',
          cardHover: '#0B1A30',
          cyan: '#00F0FF',
          cyanGlow: 'rgba(0, 240, 255, 0.25)',
          amber: '#F59E0B',
          amberGlow: 'rgba(245, 158, 11, 0.25)',
          red: '#EF4444',
          redGlow: 'rgba(239, 68, 68, 0.25)',
          green: '#10B981',
          greenGlow: 'rgba(16, 185, 129, 0.25)',
          purple: '#A855F7',
          purpleGlow: 'rgba(168, 85, 247, 0.25)',
          blue: '#0284C7',
          panel: 'rgba(6, 12, 24, 0.78)',
          grid: '#0D1728',
          textMuted: '#8899AC',
          textBright: '#F1F5F9',
        },
        starship: {
          void: '#02040A',
          surface: '#050A14',
          glass: 'rgba(6, 12, 24, 0.72)',
          glassBorder: 'rgba(0, 240, 255, 0.16)',
          rimGlow: 'rgba(255, 255, 255, 0.07)',
          accent: '#00F0FF',
          hazard: '#F59E0B',
          critical: '#EF4444',
          nominal: '#10B981',
          ai: '#A855F7',
        }
      },
      fontFamily: {
        mono: ['"JetBrains Mono"', '"Fira Code"', 'monospace'],
        display: ['"Orbitron"', 'sans-serif'],
        hud: ['"Rajdhani"', 'sans-serif'],
      },
      boxShadow: {
        'hud-cyan': '0 0 15px rgba(0, 240, 255, 0.35)',
        'hud-cyan-lg': '0 0 30px rgba(0, 240, 255, 0.5)',
        'hud-amber': '0 0 15px rgba(245, 158, 11, 0.35)',
        'hud-red': '0 0 15px rgba(239, 68, 68, 0.4)',
        'hud-green': '0 0 15px rgba(16, 185, 129, 0.35)',
        'hud-purple': '0 0 15px rgba(168, 85, 247, 0.35)',
        'starship-glow': '0 0 25px rgba(0, 240, 255, 0.25), inset 0 0 15px rgba(0, 240, 255, 0.05)',
        'starship-glass': '0 8px 32px 0 rgba(0, 0, 0, 0.6), inset 0 1px 0 0 rgba(255, 255, 255, 0.08)',
      },
      animation: {
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'radar-sweep': 'sweep 4s linear infinite',
        'scanline': 'scan 6s linear infinite',
        'beacon': 'beacon 2s ease-in-out infinite',
      },
      keyframes: {
        sweep: {
          '0%': { transform: 'rotate(0deg)' },
          '100%': { transform: 'rotate(360deg)' },
        },
        scan: {
          '0%': { transform: 'translateY(-100%)' },
          '100%': { transform: 'translateY(1000%)' },
        },
        beacon: {
          '0%, 100%': { opacity: '0.4', transform: 'scale(0.95)' },
          '50%': { opacity: '1', transform: 'scale(1.08)' },
        }
      }
    },
  },
  plugins: [],
}
