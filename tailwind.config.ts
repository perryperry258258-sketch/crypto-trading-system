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
        bg: "#0A0E14",
        panel: "#12161F",
        panel2: "#171C28",
        border: "#232937",
        text: "#E7EAF0",
        subtext: "#8A93A6",
        bull: "#3ECF8E",
        brand: "#3ECF8E",
        bear: "#F2495C",
        warn: "#E8B341",
        info: "#4C8DFF",
        accent: "#3ECF8E",
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
