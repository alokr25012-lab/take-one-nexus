import React from 'react';
import { Metadata } from 'next';
import Script from 'next/script';
import '../../../public/styles/pages/moderation.css';

export const metadata: Metadata = {
  title: 'Moderation — TAKE ONE',
  description: 'Safety and moderation tools for TAKE ONE administrators.',
};

export default function ModerationPage() {
  return (
    <>

      <header>
        <a className="logo" href="/">TAKE <span>ONE</span></a>
        <nav>
          <a href="/">Home</a>
          <a href="/#explore">Discover Projects</a>
          <a href="/crew">Find Crew</a>
          <a href="/leaderboard">Leaderboard</a>
          <a href="/chat">Community</a>
          <a href="/profile">Profile</a>
          <a href="/legal">Legal</a>
          <a href="/moderation" className="active">Moderation</a>
        </nav>
      </header>

      <main className="moderation-shell">
        <section className="moderation-head">
          <div className="kicker">Safety Dashboard</div>
          <h1>Moderation Tools</h1>
          <p>
            This page is for admin or moderator accounts only. Users can report unsafe content through the API,
            and moderators can review, resolve, or dismiss those reports here.
          </p>
        </section>

        <div className="toolbar">
          <select id="statusFilter">
            <option value="">All Reports</option>
            <option value="open">Open</option>
            <option value="reviewing">Reviewing</option>
            <option value="resolved">Resolved</option>
            <option value="dismissed">Dismissed</option>
          </select>
          <button type="button" id="refreshReportsBtn">Refresh</button>
        </div>

        <div className="report-list" id="reportList">
          <div className="empty">Loading moderation reports...</div>
        </div>
      </main>

      <Script src="/scripts/utils/helpers.js" strategy="beforeInteractive" />
      <Script src="/scripts/components/ui.js" strategy="beforeInteractive" />
      <Script src="/scripts/animations/common.js" strategy="beforeInteractive" />
      <Script src="/scripts/pages/moderation.js" strategy="afterInteractive" />
    </>
  );
}
