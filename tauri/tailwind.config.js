/** @type {import('tailwindcss').Config} */

export default {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    container: {
      center: true,
    },
    extend: {
      // Accent is a runtime CSS variable (the user picks it), so expose it as a
      // real Tailwind colour. Channels live in --accent-rgb, which lets every
      // opacity/variant modifier work: bg-accent, ring-accent/15,
      // peer-checked:bg-accent, focus:border-accent, hover:text-accent, ...
      colors: {
        accent: {
          DEFAULT: "rgb(var(--accent-rgb) / <alpha-value>)",
          hover: "var(--accent-hover)",
          contrast: "var(--accent-contrast)",
          tint: "rgb(var(--accent-rgb) / 0.1)",
        },
      },
      // Unified corner scale for the whole app:
      //   4px  - data-viz cells (heatmap)
      //   8px  - chips, badges, menu rows, small controls
      //   12px - inputs, buttons, selects, list rows
      //   16px - cards, popovers, panels, rail, hero
      //   full - pills, avatars, dots
      borderRadius: {
        sm: "4px",
        DEFAULT: "8px",
        md: "8px",
        lg: "8px",
        xl: "12px",
        "2xl": "16px",
        "3xl": "16px",
      },
    },
  },
  plugins: [],
};
