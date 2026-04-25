/** @type {import('tailwindcss').Config} */
module.exports = {
  // NOTE: Update this to include the paths to all files that contain Nativewind classes.
  content: ["./src/**/*.{js,jsx,ts,tsx}", "./App.tsx", "./components/**/*.{js,jsx,ts,tsx}"],
  presets: [require("nativewind/preset")],
  theme: {
    extend: {
      colors: {
        // Primary
        primary: "#0d631b",
        "primary-container": "#2e7d32",
        "on-primary": "#ffffff",
        "on-primary-container": "#cbffc2",
        "primary-fixed": "#a3f69c",
        "primary-fixed-dim": "#88d982",
        // Secondary
        secondary: "#8b5000",
        "secondary-container": "#ff9800",
        "on-secondary": "#ffffff",
        "on-secondary-container": "#653900",
        "secondary-fixed": "#ffdcbe",
        "secondary-fixed-dim": "#ffb870",
        // Tertiary
        tertiary: "#923357",
        "tertiary-container": "#b14b6f",
        "on-tertiary": "#ffffff",
        "on-tertiary-container": "#ffedf0",
        // Error
        error: "#ba1a1a",
        "error-container": "#ffdad6",
        "on-error": "#ffffff",
        "on-error-container": "#93000a",
        // Surface & Background
        background: "#f9f9f9",
        surface: "#f9f9f9",
        "surface-bright": "#f9f9f9",
        "surface-dim": "#dadada",
        "surface-variant": "#e2e2e2",
        "surface-tint": "#1b6d24",
        "surface-container-lowest": "#ffffff",
        "surface-container-low": "#f3f3f3",
        "surface-container": "#eeeeee",
        "surface-container-high": "#e8e8e8",
        "surface-container-highest": "#e2e2e2",
        // On-Surface
        "on-background": "#1a1c1c",
        "on-surface": "#1a1c1c",
        "on-surface-variant": "#40493d",
        // Outline
        outline: "#707a6c",
        "outline-variant": "#bfcaba",
        // Inverse
        "inverse-primary": "#88d982",
        "inverse-surface": "#2f3131",
        "inverse-on-surface": "#f1f1f1",
      },
      fontFamily: {
        "jakarta-sans": ["PlusJakartaSans", "Plus Jakarta Sans", "sans-serif"],
        inter: ["Inter", "sans-serif"],
      },
    },
  },
  plugins: [],
};
