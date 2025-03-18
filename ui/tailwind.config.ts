import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        background: "var(--background)",
        foreground: "var(--foreground)",
        darkGreen: "#062817",
        veryDarkGreen: "#060A08",
        connectedGreen: "#1f3029",
        lightGreen: "#64E18E",
      },
      backgroundImage: {
        "custom-svg": "url('/assets/BackgroundLight.svg')",
      },
    },
  },
  plugins: [],
};
export default config;
