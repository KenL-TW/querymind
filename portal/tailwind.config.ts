import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        paper: "#f5f1e8",
        ink: "#1f2a35",
        accent: "#0b7a75",
        ember: "#e2725b"
      },
      fontFamily: {
        display: ["'Space Grotesk'", "sans-serif"],
        body: ["'Noto Sans TC'", "sans-serif"]
      }
    }
  },
  plugins: []
};

export default config;
