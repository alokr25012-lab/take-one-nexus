const { withSentryConfig } = require("@sentry/nextjs");

const cspHeader = `
  default-src 'self';
  script-src 'self' 'unsafe-eval' 'unsafe-inline' https://us.i.posthog.com https://eu.i.posthog.com https://app.posthog.com https://cdn.jsdelivr.net https://js.sentry-cdn.com https://browser.sentry-cdn.com https://takeone-nexus.net.in https://www.takeone-nexus.net.in https://checkout.razorpay.com https://*.razorpay.com;
  style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://cdn.jsdelivr.net;
  img-src 'self' blob: data: https://api.dicebear.com https://ui-avatars.com https://us.i.posthog.com https://eu.i.posthog.com;
  font-src 'self' https://fonts.gstatic.com https://cdn.jsdelivr.net;
  connect-src 'self' https://us.i.posthog.com https://eu.i.posthog.com https://app.posthog.com https://sentry.io https://*.sentry.io wss://*.pusher.com https://*.pusher.com https://*.pusherapp.com wss://*.pusherapp.com http://localhost:* ws://localhost:* http://127.0.0.1:* ws://127.0.0.1:* https://takeone-nexus.net.in https://www.takeone-nexus.net.in https://admin.takeone-nexus.net.in https://scripts.takeone-nexus.net.in https://api.razorpay.com https://*.razorpay.com;
  frame-src 'self' https://us.posthog.com https://eu.posthog.com https://app.posthog.com https://api.razorpay.com https://*.razorpay.com https://checkout.razorpay.com https://admin.takeone-nexus.net.in https://scripts.takeone-nexus.net.in;
  worker-src 'self' blob:;
  object-src 'none';
  base-uri 'self';
  form-action 'self';
`.replace(/\s{2,}/g, ' ').trim();

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'api.dicebear.com' },
      { protocol: 'https', hostname: 'ui-avatars.com' },
    ],
  },
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          {
            key: 'Content-Security-Policy',
            value: cspHeader,
          },
          {
            key: 'X-Frame-Options',
            value: 'SAMEORIGIN',
          },
          {
            key: 'X-Content-Type-Options',
            value: 'nosniff',
          },
          {
            key: 'Referrer-Policy',
            value: 'strict-origin-when-cross-origin',
          },
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), accelerometer=(), gyroscope=()',
          },
        ],
      },
    ];
  },
  async rewrites() {
    if (process.env.VERCEL || process.env.NEXT_DISABLE_API_PROXY === 'true') {
      return [];
    }

    const legacyApiOrigin = process.env.LEGACY_API_ORIGIN || 'http://127.0.0.1:5001';

    return [
      {
        source: '/api/:path*',
        destination: `${legacyApiOrigin}/api/:path*`,
      },
      {
        source: '/uploads/:path*',
        destination: `${legacyApiOrigin}/uploads/:path*`,
      },
    ];
  },
};

module.exports = withSentryConfig(nextConfig, {
  // Sentry Options
  silent: true,
  org: "take-one",
  project: "nexus-frontend",
}, {
  // Upload Options
  widenClientFileUpload: false, // Don't widen client uploads
  transpileClientSDK: false,
  tunnelRoute: "/monitoring",
  hideSourceMaps: true,
  disableLogger: true,
  disableClientSide: true, // Specifically disable on the client
});

