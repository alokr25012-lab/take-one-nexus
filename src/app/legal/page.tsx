import React from 'react';
import { Metadata } from 'next';
import '../../../public/styles/pages/legal.css';

export const metadata: Metadata = {
  title: 'Legal — TAKE ONE',
  description: 'Privacy Policy, Terms of Service, and Community Rules for TAKE ONE.',
};

export default function LegalPage() {
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
          <a href="/moderation">Moderation</a>
        </nav>
      </header>

      <main className="legal-shell">
        <section className="legal-hero">
          <div className="legal-kicker">Draft Legal Center</div>
          <h1>Privacy, Terms, and Safety</h1>
          <p>
            This is a beginner-friendly legal starting point for TAKE ONE. Before public launch,
            these pages should be reviewed by a real lawyer and adjusted for the country where the company operates.
          </p>
        </section>

        <section className="legal-grid">
          <article className="legal-card" id="privacy">
            <h2>Privacy Policy</h2>
            <ul>
              <li>TAKE ONE stores account details such as name, email, role, college, city, bio, skills, and portfolio links.</li>
              <li>Scripts, requests, profile updates, and notifications are stored so collaboration features can work.</li>
              <li>Email may be used for login, collaboration requests, account notices, and safety moderation.</li>
              <li>Users should not upload private documents, sensitive personal data, or content they do not own.</li>
            </ul>
          </article>

          <article className="legal-card" id="terms">
            <h2>Terms</h2>
            <ul>
              <li>Users are responsible for the scripts, messages, profiles, and portfolio links they post.</li>
              <li>Creators must only upload work they own or have permission to share.</li>
              <li>TAKE ONE can remove accounts, scripts, or messages that are abusive, fake, spammy, unsafe, or illegal.</li>
              <li>Collaboration decisions happen between users. TAKE ONE is not responsible for offline production agreements.</li>
            </ul>
          </article>

          <article className="legal-card" id="community">
            <h2>Community Rules</h2>
            <ul>
              <li>No harassment, hate speech, threats, stalking, impersonation, or spam.</li>
              <li>No fake casting calls, fake payment promises, or misleading production details.</li>
              <li>No sharing another person's private contact details without consent.</li>
              <li>Report suspicious users or scripts so moderators can review them.</li>
            </ul>
          </article>
        </section>

        <section className="legal-note">
          <h2>Still Needed Before Launch</h2>
          <p>
            Add proper company details, support email, data deletion flow, copyright takedown process,
            child safety policy if minors can use the app, and final legal review.
          </p>
        </section>
      </main>
    </>
  );
}
