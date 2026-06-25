import nextJest from "next/jest";
import type { Config } from "jest";

const createJestConfig = nextJest({
  dir: "./"
});

const config: Config = {
  clearMocks: true,
  collectCoverageFrom: [
    "src/**/*.{ts,tsx}",
    "packages/db/**/*.{ts,tsx}",
    "!src/**/*.d.ts"
  ],
  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/src/$1",
    "\\.(css|less|scss|sass)$": "identity-obj-proxy",
    "^uuid$": require.resolve("uuid"),
    "^preact/jsx-runtime$": require.resolve("preact/jsx-runtime"),
    "^preact-render-to-string$": require.resolve("preact-render-to-string"),
    "^preact$": require.resolve("preact")
  },
  setupFilesAfterEnv: ["<rootDir>/jest.setup.ts"],
  testEnvironment: "node",
  testPathIgnorePatterns: ["/node_modules/", "/.next/", "/tests/e2e/"]
};

export default async function jestConfig() {
  const nextConfig = await createJestConfig(config)();
  // Override transformIgnorePatterns to allow transforming ESM packages
  nextConfig.transformIgnorePatterns = [
    "node_modules/(?!(superjson|jose|openid-client|copy-anything|is-what|msgpackr|@panva|uuid|next-auth|@auth|preact|@react-pdf/fns|@react-pdf/font|@react-pdf/image|@react-pdf/layout|@react-pdf/pdfkit|@react-pdf/primitives|@react-pdf/reconciler|@react-pdf/render|@react-pdf/renderer|@react-pdf/stylesheet|@react-pdf/svg|@react-pdf/textkit|@react-pdf/types|color-string|color-name|yoga-layout|emoji-regex-xs)/)"
  ];
  return nextConfig;
}
