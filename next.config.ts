import type { NextConfig } from "next";

/** Sent on every response. No CSP yet: it needs testing against Next's inline scripts first. */
const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
];

const nextConfig: NextConfig = {
  // Dev only: lets the dev server be opened from this machine's network address
  // as well as localhost. Add other addresses here if your IP changes.
  allowedDevOrigins: ["10.42.0.22", "10.152.178.24"],
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
