import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Dev only: lets the dev server be opened from this machine's network address
  // as well as localhost. Add other addresses here if your IP changes.
  allowedDevOrigins: ["10.42.0.22", "10.152.178.24"],
};

export default nextConfig;
