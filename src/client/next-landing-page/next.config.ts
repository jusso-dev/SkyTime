import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  turbopack: { root: process.cwd() },
  serverExternalPackages: ["pdfkit", "svg-to-pdfkit"],
  outputFileTracingIncludes: { "/api/**/*": ["./public/skytime-logo.svg"] },
};

export default nextConfig;
