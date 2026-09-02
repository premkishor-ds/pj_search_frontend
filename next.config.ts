import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  env: {
    NEXT_PUBLIC_BACKEND_API_URL: process.env.NEXT_PUBLIC_BACKEND_API_URL || "http://127.0.0.1:8000",
  },
  allowedDevOrigins: ['192.168.9.118', 'localhost', '127.0.0.1'],
  async rewrites() {
    const backendUrl = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000";
    return [
      {
        source: '/api/:path*',
        destination: `${backendUrl}/:path*`,
      }
    ]
  }
};

export default nextConfig;
