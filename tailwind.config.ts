import type { Config } from "tailwindcss";
import defaultTheme from "tailwindcss/defaultTheme";

const config: Config = {
  darkMode: ["class"],
  content: [
    "./src/app/**/*.{ts,tsx}",
    "./src/components/**/*.{ts,tsx}",
    "./src/hooks/**/*.{ts,tsx}",
    "./src/lib/**/*.{ts,tsx}",
    "./src/pages/**/*.{ts,tsx}"
  ],
  theme: {
    container: {
      center: true,
      padding: {
        DEFAULT: "1.25rem",
        lg: "2rem",
        xl: "2.5rem"
      }
    },
    extend: {
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))"
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))"
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))"
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))"
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))"
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))"
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))"
        },
        // Compliance status scale — kept distinct from the brand tokens so a
        // white-label tenant cannot recolour the meaning of a finding.
        success: {
          DEFAULT: "hsl(var(--success))",
          foreground: "hsl(var(--success-foreground))"
        },
        warning: {
          DEFAULT: "hsl(var(--warning))",
          foreground: "hsl(var(--warning-foreground))"
        },
        critical: {
          DEFAULT: "hsl(var(--critical))",
          foreground: "hsl(var(--critical-foreground))"
        },
        info: {
          DEFAULT: "hsl(var(--info))",
          foreground: "hsl(var(--info-foreground))"
        },
        // Severity — one key per Prisma `Severity` enum member. Consumed only
        // via <StatusBadge severity={...} />; no screen should reach for these
        // directly, or the ramp drifts again the way the old per-page
        // red-500/orange-500 hardcodes did.
        severity: {
          none: "hsl(var(--severity-none))",
          low: "hsl(var(--severity-low))",
          medium: "hsl(var(--severity-medium))",
          high: "hsl(var(--severity-high))",
          critical: "hsl(var(--severity-critical))"
        },
        // Categorical — fixed order, never cycled. Validated for CVD.
        chart: {
          1: "hsl(var(--chart-1))",
          2: "hsl(var(--chart-2))",
          3: "hsl(var(--chart-3))",
          4: "hsl(var(--chart-4))",
          5: "hsl(var(--chart-5))"
        },
        // Sequential — single hue, light→dark, for magnitude only.
        seq: {
          1: "hsl(var(--seq-1))",
          2: "hsl(var(--seq-2))",
          3: "hsl(var(--seq-3))",
          4: "hsl(var(--seq-4))",
          5: "hsl(var(--seq-5))"
        }
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)"
      },
      fontFamily: {
        // Fraunces carries the brand voice on marketing + page titles; Inter
        // Tight does the dense UI work; JetBrains Mono is for identifiers,
        // hashes, and control IDs.
        display: ["var(--font-display)", ...defaultTheme.fontFamily.serif],
        sans: ["var(--font-sans)", ...defaultTheme.fontFamily.sans],
        mono: ["var(--font-mono)", ...defaultTheme.fontFamily.mono]
      },
      fontSize: {
        // Dashboard-density type scale. The 11-13px steps carry table and
        // metadata text, which the default Tailwind scale jumps straight past.
        micro: ["0.6875rem", { lineHeight: "1rem", letterSpacing: "0.01em" }],
        meta: ["0.75rem", { lineHeight: "1.125rem" }],
        data: ["0.8125rem", { lineHeight: "1.25rem" }],
        // Display sizes get negative tracking — large type set at default
        // tracking is one of the clearest "untuned" tells.
        "display-sm": ["1.75rem", { lineHeight: "2.125rem", letterSpacing: "-0.02em" }],
        "display-md": ["2.25rem", { lineHeight: "2.625rem", letterSpacing: "-0.024em" }],
        "display-lg": ["3rem", { lineHeight: "3.25rem", letterSpacing: "-0.028em" }],
        "display-xl": ["4rem", { lineHeight: "4.25rem", letterSpacing: "-0.032em" }]
      },
      boxShadow: {
        // Layered, low-alpha, indigo-tinted rather than neutral grey — grey
        // shadows on warm paper read as dirty.
        xs: "0 1px 2px 0 hsl(226 28% 13% / 0.05)",
        sm: "0 1px 2px 0 hsl(226 28% 13% / 0.06), 0 1px 3px 0 hsl(226 28% 13% / 0.04)",
        md: "0 2px 4px -1px hsl(226 28% 13% / 0.06), 0 4px 12px -2px hsl(226 28% 13% / 0.08)",
        lg: "0 4px 8px -2px hsl(226 28% 13% / 0.06), 0 12px 28px -4px hsl(226 28% 13% / 0.10)",
        focus: "0 0 0 4px hsl(var(--ring) / 0.18)"
      },
      backgroundImage: {
        "dharma-radial":
          "radial-gradient(ellipse 80% 50% at 50% -10%, hsl(var(--primary) / 0.14), transparent 70%)"
      },
      transitionTimingFunction: {
        // Exponential ease-out: fast departure, soft arrival. Reads as
        // responsive rather than floaty.
        out: "cubic-bezier(0.16, 1, 0.3, 1)"
      },
      keyframes: {
        "accordion-down": {
          from: { height: "0" },
          to: { height: "var(--radix-accordion-content-height)" }
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to: { height: "0" }
        }
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out"
      }
    }
  },
  plugins: [require("tailwindcss-animate")]
};

export default config;
