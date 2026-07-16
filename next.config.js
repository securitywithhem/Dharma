/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  experimental: {
    typedRoutes: true,
    // Enables src/instrumentation.ts (OpenTelemetry bootstrap on server boot).
    instrumentationHook: true
  }
};

module.exports = nextConfig;
