import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  agentRules: false,
  experimental: { serverActions: { bodySizeLimit: "4mb" } },
};

export default nextConfig;
