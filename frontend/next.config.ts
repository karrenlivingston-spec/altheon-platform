import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async rewrites() {
    return [
      { source: "/dashboard/clinics", destination: "/admin/clinics" },
    ];
  },
};

export default nextConfig;
