import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{js,ts,jsx,tsx,mdx}", "./components/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    screens: {
      xs: "320px",
      sm: "360px",
      "sm2": "375px",
      md: "390px",
      "md2": "393px",
      lg: "412px",
      xl: "430px",
      "2xl": "768px",
      "3xl": "1024px",
      "4xl": "1440px",
    },
    extend: {
      colors: {
        bg: "#0B0E11",
        panel: "#121620",
        panel2: "#171C28",
        border: "#232937",
        text: "#E7EAF0",
        subtext: "#8A93A6",
        bull: "#20C97A",
        bear: "#F0475B",
        warn: "#E8B341",
        accent: "#4C8DFF",
        s: "#FF5A36",
      },
      fontFamily: {
        display: ["'Space Grotesk'", "sans-serif"],
        mono: ["'JetBrains Mono'", "monospace"],
      },
    },
  },
  plugins: [],
};
export default config;
