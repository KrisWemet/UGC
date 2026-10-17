import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // ffmpeg-static ships a native binary; keep it out of the bundle and make
  // sure the binary and the caption font are traced into the render function.
  serverExternalPackages: ["ffmpeg-static"],
  outputFileTracingIncludes: {
    "/api/render": ["./node_modules/ffmpeg-static/ffmpeg", "./assets/fonts/**/*"],
  },
};

export default nextConfig;
