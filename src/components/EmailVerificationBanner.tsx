'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Clock3, KeyRound, Loader2, MailWarning, Send, ShieldCheck, X } from 'lucide-react';
import { fetchWithCSRF } from '@/utils/fetchWithCSRF';

type CurrentUser = {
  id: number;
  email: string;
  name?: string;
  email_verified?: boolean | number;
};

const REMIND_LATER_MS = 4 * 60 * 60 * 1000;
const SESSION_CHECK_MS = 30 * 60 * 1000;

function getReminderKey(user: CurrentUser | null) {
  return user ? `take_one_verify_remind_after:${user.id}:${user.email}` : '';
}

function isRemindedLater(user: CurrentUser | null) {
  if (typeof window === 'undefined') return true;
  const key = getReminderKey(user);
  if (!key) return true;
  const remindAfter = Number(window.localStorage.getItem(key) || 0);
  return Boolean(remindAfter && Date.now() < remindAfter);
}

export default function EmailVerificationBanner() {
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [popupOpen, setPopupOpen] = useState(false);
  const [otpOpen, setOtpOpen] = useState(false);
  const [sendingOtp, setSendingOtp] = useState(false);
  const [resendingLink, setResendingLink] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [otp, setOtp] = useState(['', '', '', '', '', '']);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [otpCooldown, setOtpCooldown] = useState(0);
  const [linkCooldown, setLinkCooldown] = useState(0);
  const inputsRef = useRef<Array<HTMLInputElement | null>>([]);

  const isUnverified = Boolean(user) && !Boolean(user?.email_verified);
  const otpCode = useMemo(() => otp.join(''), [otp]);

  const refreshUser = useCallback(async (forceOpen = false) => {
    try {
      const res = await fetch('/api/users/me', { credentials: 'include', cache: 'no-store' });
      if (!res.ok) {
        setUser(null);
        setPopupOpen(false);
        return;
      }

      const data = await res.json();
      const nextUser = data?.success && data.user ? data.user as CurrentUser : null;
      setUser(nextUser);

      if (nextUser && !Boolean(nextUser.email_verified)) {
        setPopupOpen(forceOpen || !isRemindedLater(nextUser));
      } else {
        setPopupOpen(false);
        setOtpOpen(false);
      }
    } catch {
      setUser(null);
      setPopupOpen(false);
    }
  }, []);

  useEffect(() => {
    refreshUser();

    const onAuthChanged = () => refreshUser(true);
    const onOpenVerification = () => {
      refreshUser(true);
      setPopupOpen(true);
    };

    window.addEventListener('takeone:auth-changed', onAuthChanged);
    window.addEventListener('takeone:open-email-verification', onOpenVerification);

    const interval = window.setInterval(() => refreshUser(), SESSION_CHECK_MS);

    return () => {
      window.removeEventListener('takeone:auth-changed', onAuthChanged);
      window.removeEventListener('takeone:open-email-verification', onOpenVerification);
      window.clearInterval(interval);
    };
  }, [refreshUser]);

  useEffect(() => {
    if (otpCooldown <= 0) return;
    const timeout = window.setTimeout(() => setOtpCooldown((value) => Math.max(0, value - 1)), 1000);
    return () => window.clearTimeout(timeout);
  }, [otpCooldown]);

  useEffect(() => {
    if (linkCooldown <= 0) return;
    const timeout = window.setTimeout(() => setLinkCooldown((value) => Math.max(0, value - 1)), 1000);
    return () => window.clearTimeout(timeout);
  }, [linkCooldown]);

  const resetMessages = () => {
    setStatus('');
    setError('');
  };

  const sendOtp = useCallback(async (openModal = true) => {
    if (sendingOtp || otpCooldown > 0) return;
    resetMessages();
    setSendingOtp(true);

    try {
      const res = await fetchWithCSRF('/api/otp/send', { method: 'POST' });
      const data = await res.json();

      if (!res.ok || !data.success) {
        setError(data.message || 'Could not send verification code.');
        if (res.status === 429 && data.retryAfter) setOtpCooldown(Number(data.retryAfter));
        return;
      }

      setStatus(data.message || 'Verification code sent to your email.');
      setOtpCooldown(60);
      setOtp(['', '', '', '', '', '']);
      if (openModal) {
        setOtpOpen(true);
        window.setTimeout(() => inputsRef.current[0]?.focus(), 100);
      }
    } catch {
      setError('Connection error while sending the verification code.');
    } finally {
      setSendingOtp(false);
    }
  }, [otpCooldown, sendingOtp]);

  const resendVerificationEmail = useCallback(async () => {
    if (!user?.email || resendingLink || linkCooldown > 0) return;
    resetMessages();
    setResendingLink(true);

    try {
      const res = await fetchWithCSRF('/api/auth/verify-email', {
        method: 'POST',
        body: JSON.stringify({ email: user.email }),
      });
      const data = await res.json();

      if (!res.ok || !data.success) {
        setError(data.message || 'Could not resend verification email.');
        if (res.status === 429 && data.retryAfter) setLinkCooldown(Number(data.retryAfter));
        return;
      }

      setStatus(data.message || 'Verification email sent.');
      setLinkCooldown(60);
    } catch {
      setError('Connection error while resending the verification email.');
    } finally {
      setResendingLink(false);
    }
  }, [linkCooldown, resendingLink, user?.email]);

  const confirmOtp = useCallback(async () => {
    if (otpCode.length !== 6 || confirming) {
      setError('Enter the full 6-digit verification code.');
      return;
    }

    resetMessages();
    setConfirming(true);

    try {
      const res = await fetchWithCSRF('/api/otp/confirm', {
        method: 'POST',
        body: JSON.stringify({ otp: otpCode }),
      });
      const data = await res.json();

      if (!res.ok || !data.success) {
        setError(data.message || 'Invalid verification code.');
        return;
      }

      setStatus(data.message || 'Email verified successfully.');
      if (data.token) {
        window.localStorage.setItem('take_one_token', data.token);
      }
      if (data.user) {
        const storedUser = window.localStorage.getItem('take_one_user');
        let currentUser = {};
        try {
          currentUser = storedUser ? JSON.parse(storedUser) : {};
        } catch {
          currentUser = {};
        }
        window.localStorage.setItem('take_one_user', JSON.stringify({ ...currentUser, ...data.user }));
      }
      setOtpOpen(false);
      setPopupOpen(false);
      await refreshUser();
      window.dispatchEvent(new CustomEvent('takeone:auth-changed'));
    } catch {
      setError('Connection error while confirming the code.');
    } finally {
      setConfirming(false);
    }
  }, [confirming, otpCode, refreshUser]);

  const remindLater = () => {
    const key = getReminderKey(user);
    if (key) {
      window.localStorage.setItem(key, String(Date.now() + REMIND_LATER_MS));
    }
    setPopupOpen(false);
    setOtpOpen(false);
  };

  const updateOtp = (index: number, value: string) => {
    const digit = value.replace(/\D/g, '').slice(-1);
    setOtp((current) => current.map((item, itemIndex) => itemIndex === index ? digit : item));
    if (digit && index < 5) inputsRef.current[index + 1]?.focus();
  };

  if (!isUnverified || !popupOpen || !user) return null;

  return (
    <>
      <div className="email-verify-shell" role="dialog" aria-modal="true" aria-labelledby="email-verify-title">
        <div className="email-verify-panel">
          <button className="email-verify-close" type="button" onClick={remindLater} aria-label="Remind me later">
            <X size={16} />
          </button>

          <div className="email-verify-mark" aria-hidden="true">
            <MailWarning size={24} />
          </div>

          <div className="email-verify-kicker">Account Signal Pending</div>
          <h2 id="email-verify-title">Verify Your Email Address</h2>
          <p>
            Your email address has not been verified yet.
          </p>
          <p>
            Verify your account to unlock all platform features and improve account security.
          </p>

          {(status || error) && (
            <div className={error ? 'email-verify-feedback error' : 'email-verify-feedback'}>
              {error || status}
            </div>
          )}

          <div className="email-verify-actions">
            <button className="email-verify-primary" type="button" onClick={() => sendOtp(true)} disabled={sendingOtp || otpCooldown > 0}>
              {sendingOtp ? <Loader2 size={15} className="spin" /> : <KeyRound size={15} />}
              {sendingOtp ? 'Sending Code' : otpCooldown > 0 ? `Retry in ${otpCooldown}s` : 'Verify Now'}
            </button>
            <button className="email-verify-secondary" type="button" onClick={resendVerificationEmail} disabled={resendingLink || linkCooldown > 0}>
              {resendingLink ? <Loader2 size={15} className="spin" /> : <Send size={15} />}
              {resendingLink ? 'Sending Email' : linkCooldown > 0 ? `Retry in ${linkCooldown}s` : 'Resend Verification Email'}
            </button>
            <button className="email-verify-ghost" type="button" onClick={remindLater}>
              <Clock3 size={15} />
              Remind Me Later
            </button>
          </div>
        </div>
      </div>

      {otpOpen && (
        <div className="email-verify-otp-backdrop" role="dialog" aria-modal="true" aria-labelledby="email-verify-otp-title">
          <div className="email-verify-otp-panel">
            <button className="email-verify-close" type="button" onClick={() => setOtpOpen(false)} aria-label="Close verification code modal">
              <X size={16} />
            </button>
            <ShieldCheck className="email-verify-otp-icon" size={30} />
            <h3 id="email-verify-otp-title">Enter Verification Code</h3>
            <p>Use the 6-digit code sent to {user.email}.</p>

            <div className="email-verify-otp-inputs">
              {otp.map((digit, index) => (
                <input
                  key={index}
                  ref={(node) => { inputsRef.current[index] = node; }}
                  value={digit}
                  inputMode="numeric"
                  maxLength={1}
                  aria-label={`Verification digit ${index + 1}`}
                  onChange={(event) => updateOtp(index, event.currentTarget.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Backspace' && !digit && index > 0) inputsRef.current[index - 1]?.focus();
                    if (event.key === 'Enter') confirmOtp();
                  }}
                />
              ))}
            </div>

            <button className="email-verify-primary full" type="button" onClick={confirmOtp} disabled={confirming}>
              {confirming ? <Loader2 size={15} className="spin" /> : <ShieldCheck size={15} />}
              {confirming ? 'Verifying' : 'Confirm Code'}
            </button>
            <button className="email-verify-link" type="button" onClick={() => sendOtp(false)} disabled={sendingOtp || otpCooldown > 0}>
              {otpCooldown > 0 ? `Resend code in ${otpCooldown}s` : 'Resend Code'}
            </button>
          </div>
        </div>
      )}

      <style jsx>{`
        .email-verify-shell {
          position: fixed;
          inset: auto 22px 22px auto;
          z-index: 10020;
          width: min(420px, calc(100vw - 32px));
          font-family: var(--font-main);
        }

        .email-verify-panel,
        .email-verify-otp-panel {
          position: relative;
          overflow: hidden;
          background: linear-gradient(145deg, rgba(14, 18, 24, 0.98), rgba(6, 8, 10, 0.98));
          border: 1px solid rgba(255, 77, 26, 0.34);
          border-radius: 8px;
          padding: 26px;
          box-shadow: 0 24px 70px rgba(0, 0, 0, 0.55), 0 0 38px rgba(255, 77, 26, 0.12);
          backdrop-filter: blur(18px);
        }

        .email-verify-panel::before,
        .email-verify-otp-panel::before {
          content: '';
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          height: 3px;
          background: linear-gradient(90deg, var(--neon), var(--amber), var(--cyan));
        }

        .email-verify-close {
          position: absolute;
          top: 14px;
          right: 14px;
          width: 30px;
          height: 30px;
          display: grid;
          place-items: center;
          border: 1px solid rgba(232, 223, 200, 0.14);
          background: rgba(19, 24, 31, 0.82);
          color: var(--silver);
          cursor: pointer;
        }

        .email-verify-mark {
          width: 48px;
          height: 48px;
          display: grid;
          place-items: center;
          color: var(--neon);
          background: rgba(255, 77, 26, 0.1);
          border: 1px solid rgba(255, 77, 26, 0.32);
          margin-bottom: 18px;
          box-shadow: inset 0 0 18px rgba(255, 77, 26, 0.08);
        }

        .email-verify-kicker {
          color: var(--cyan);
          font-size: 10px;
          font-weight: 800;
          letter-spacing: 0.28em;
          text-transform: uppercase;
          margin-bottom: 8px;
        }

        h2,
        h3 {
          margin: 0;
          color: var(--cream);
          font-family: var(--font-title);
          font-weight: 400;
          letter-spacing: 0.14em;
          text-transform: uppercase;
        }

        h2 {
          font-size: 30px;
          line-height: 1;
          margin-bottom: 14px;
          padding-right: 22px;
        }

        h3 {
          font-size: 24px;
          margin-top: 12px;
          margin-bottom: 10px;
        }

        p {
          margin: 0 0 10px;
          color: rgba(232, 223, 200, 0.72);
          font-size: 12px;
          line-height: 1.65;
        }

        .email-verify-feedback {
          margin-top: 16px;
          padding: 11px 12px;
          border: 1px solid rgba(0, 212, 255, 0.24);
          color: var(--cyan);
          background: rgba(0, 212, 255, 0.08);
          font-size: 11px;
          line-height: 1.45;
        }

        .email-verify-feedback.error {
          border-color: rgba(255, 77, 26, 0.34);
          color: var(--neon);
          background: rgba(255, 77, 26, 0.09);
        }

        .email-verify-actions {
          display: grid;
          gap: 10px;
          margin-top: 18px;
        }

        button {
          font-family: var(--font-main);
          border-radius: 6px;
        }

        .email-verify-primary,
        .email-verify-secondary,
        .email-verify-ghost,
        .email-verify-link {
          min-height: 42px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 9px;
          padding: 11px 14px;
          font-size: 10px;
          font-weight: 900;
          letter-spacing: 0.16em;
          text-transform: uppercase;
          cursor: pointer;
          transition: transform 160ms ease, border-color 160ms ease, opacity 160ms ease;
        }

        .email-verify-primary {
          border: 1px solid var(--neon);
          background: var(--neon);
          color: #06080a;
          box-shadow: 0 0 22px rgba(255, 77, 26, 0.28);
        }

        .email-verify-secondary {
          border: 1px solid rgba(0, 212, 255, 0.44);
          background: rgba(0, 212, 255, 0.08);
          color: var(--cyan);
        }

        .email-verify-ghost,
        .email-verify-link {
          border: 1px solid rgba(232, 223, 200, 0.16);
          background: rgba(232, 223, 200, 0.04);
          color: var(--silver);
        }

        .email-verify-link {
          width: 100%;
          margin-top: 10px;
          border: 0;
          background: transparent;
          text-decoration: underline;
        }

        .email-verify-primary.full {
          width: 100%;
          margin-top: 18px;
        }

        button:disabled {
          cursor: not-allowed;
          opacity: 0.58;
        }

        button:not(:disabled):hover {
          transform: translateY(-1px);
        }

        .email-verify-otp-backdrop {
          position: fixed;
          inset: 0;
          z-index: 10030;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 20px;
          background: rgba(6, 8, 10, 0.74);
          backdrop-filter: blur(10px);
          font-family: var(--font-main);
        }

        .email-verify-otp-panel {
          width: min(440px, 100%);
          text-align: center;
        }

        .email-verify-otp-icon {
          color: var(--neon);
          filter: drop-shadow(0 0 12px rgba(255, 77, 26, 0.45));
        }

        .email-verify-otp-inputs {
          display: grid;
          grid-template-columns: repeat(6, minmax(0, 1fr));
          gap: 8px;
          margin-top: 20px;
        }

        .email-verify-otp-inputs input {
          width: 100%;
          aspect-ratio: 1;
          min-height: 46px;
          border: 1px solid rgba(255, 77, 26, 0.24);
          border-radius: 8px;
          background: var(--panel);
          color: var(--neon);
          text-align: center;
          font: 800 22px/1 var(--font-main);
          outline: none;
        }

        .email-verify-otp-inputs input:focus {
          border-color: var(--neon);
          box-shadow: 0 0 18px rgba(255, 77, 26, 0.18);
        }

        .spin {
          animation: email-verify-spin 900ms linear infinite;
        }

        @keyframes email-verify-spin {
          to { transform: rotate(360deg); }
        }

        @media (max-width: 640px) {
          .email-verify-shell {
            inset: auto 12px 12px 12px;
            width: auto;
          }

          .email-verify-panel,
          .email-verify-otp-panel {
            padding: 22px;
          }

          h2 {
            font-size: 25px;
          }

          .email-verify-primary,
          .email-verify-secondary,
          .email-verify-ghost {
            width: 100%;
          }
        }
      `}</style>
    </>
  );
}
