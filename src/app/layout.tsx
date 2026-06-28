import React from 'react';
import './globals.css';
import '../../public/styles/components/global-chat-fab.css';
import { Metadata, Viewport } from 'next';
import Script from 'next/script';
import { Space_Mono, Bebas_Neue, Cormorant_Garamond } from 'next/font/google';
import GlobalIssueReporter from '@/components/GlobalIssueReporter';
import CookieConsentBanner from '@/components/CookieConsentBanner';
import PostHogProvider from '@/components/PostHogProvider';
import EmailVerificationBanner from '@/components/EmailVerificationBanner';
import EmailVerificationReminderPopup from '@/components/EmailVerificationReminderPopup';

const spaceMono = Space_Mono({
  weight: ['400', '700'],
  subsets: ['latin'],
  variable: '--font-main',
  display: 'swap',
});

const bebasNeue = Bebas_Neue({
  weight: ['400'],
  subsets: ['latin'],
  variable: '--font-title',
  display: 'swap',
});

const cormorantGaramond = Cormorant_Garamond({
  weight: ['300', '400'],
  subsets: ['latin'],
  variable: '--font-accent',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'TAKE ONE — Film Crew Connect',
  description: 'Where scripts become films. Connect with student filmmakers across campuses.',
  metadataBase: new URL('https://takeone-nexus.net.in'),
  openGraph: {
    title: 'TAKE ONE — Film Crew Connect',
    description: 'Where scripts become films. Connect with student filmmakers across campuses.',
    url: 'https://takeone-nexus.net.in',
    siteName: 'TAKE ONE',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'TAKE ONE — Film Crew Connect',
    description: 'Where scripts become films. Connect with student filmmakers across campuses.',
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${spaceMono.variable} ${bebasNeue.variable} ${cormorantGaramond.variable}`}>
      <body className={`${spaceMono.className}`}>
        <PostHogProvider>
          <div className="cur-dot" id="dot"></div>
          <div className="cur-cross" id="cross"></div>
          <div className="scroll-progress" id="scrollProgress"></div>
          <EmailVerificationBanner />
          <EmailVerificationReminderPopup />
          {children}
          <GlobalIssueReporter />
          <CookieConsentBanner />
        </PostHogProvider>
        <Script src="/scripts/constants/roles.js" strategy="beforeInteractive" />
        <Script src="/scripts/constants/themes.js" strategy="beforeInteractive" />
        <Script src="/scripts/api/api.js" strategy="afterInteractive" />
        <Script src="/scripts/utils/helpers.js" strategy="afterInteractive" />
        <Script src="/scripts/animations/common.js" strategy="afterInteractive" />
        <Script src="/scripts/components/modal.js" strategy="afterInteractive" />
        <Script src="/scripts/components/global-chat-fab.js" strategy="afterInteractive" />
      </body>
    </html>
  );
}
