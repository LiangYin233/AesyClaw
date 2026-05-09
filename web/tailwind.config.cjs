/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./index.html', './src/**/*.{vue,ts}'],
  theme: {
    extend: {
      colors: {
        dark: '#141413',
        light: '#faf9f5',
        'mid-gray': '#b0aea5',
        'light-gray': '#e8e6dc',
        primary: '#d97757',
        'primary-hover': '#c96a4b',
        'accent-blue': '#6a9bcc',
        'accent-green': '#788c5d',
        danger: '#c45b5b',
        warning: '#c9a35a',
        surface: '#FDFBF9',
      },
      fontFamily: {
        heading: ['Poppins', 'Arial', 'sans-serif'],
        body: ['Lora', 'Georgia', 'serif'],
      },
      borderRadius: {
        DEFAULT: '8px',
        sm: '6px',
      },
      boxShadow: {
        sm: '0 1px 2px rgba(20, 20, 19, 0.06), 0 1px 3px rgba(20, 20, 19, 0.04)',
        DEFAULT: '0 4px 6px -1px rgba(20, 20, 19, 0.07), 0 2px 4px -2px rgba(20, 20, 19, 0.05)',
        lg: '0 10px 15px -3px rgba(20, 20, 19, 0.08), 0 4px 6px -4px rgba(20, 20, 19, 0.04)',
      },
      spacing: {
        sidebar: '240px',
        topbar: '64px',
      },
    },
  },
  plugins: [],
};
