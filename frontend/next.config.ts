import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async rewrites() {
    return [
      { source: "/dashboard/clinics", destination: "/admin/clinics" },
    ];
  },
  async redirects() {
    return [
      {
        source: "/",
        destination: "/admin",
        permanent: false,
      },
    ];
  },
};

export default nextConfig;
