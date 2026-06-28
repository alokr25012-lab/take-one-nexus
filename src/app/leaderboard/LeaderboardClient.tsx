'use client';

import React, { useEffect, useState, useCallback } from 'react';
import Pusher from 'pusher-js';
import { getAvatarUrl } from '@/lib/avatars';
import { getCanonicalDisplayName } from '@/utils/formatting';
import './leaderboard.css';

interface User {
  id: number;
  name: string;
  screen_name?: string;
  display_preference?: string;
  avatar_url?: string;
  gender?: string;
  role?: string;
  college?: string;
  credits: number;
  email_verified?: boolean;
  averageRating?: number;
  ratingCount?: number;
}

interface CreditTask {
  id: number;
  name: string;
  description: string | null;
  credits_rewarded: number;
  trigger_type: string;
  completed: boolean;
  completed_at: string | null;
}

interface LeaderboardClientProps {
  initialUsers: User[];
  pusherConfig: {
    key: string;
    cluster: string;
  };
}

export default function LeaderboardClient({ initialUsers, pusherConfig }: LeaderboardClientProps) {
  const [users, setUsers] = useState<User[]>(initialUsers);
  const [activeFaq, setActiveFaq] = useState<number | null>(null);
  const [creditTasks, setCreditTasks] = useState<CreditTask[]>([]);
  const [tasksLoading, setTasksLoading] = useState(false);

  const fetchLeaderboard = useCallback(async () => {
    try {
      const res = await fetch('/api/ratings/leaderboard');
      const json = await res.json();
      if (json.success) {
        setUsers(json.data);
      }
    } catch (err) {
      console.error('Failed to fetch leaderboard:', err);
    }
  }, []);

  useEffect(() => {
    if (!pusherConfig.key) return;

    const pusher = new Pusher(pusherConfig.key, {
      cluster: pusherConfig.cluster
    });

    const channel = pusher.subscribe('global-events');
    channel.bind('leaderboard-update', () => {
      fetchLeaderboard();
    });

    return () => {
      channel.unbind_all();
      pusher.unsubscribe('global-events');
    };
  }, [pusherConfig, fetchLeaderboard]);

  useEffect(() => {
    setTasksLoading(true);
    fetch('/api/credits/tasks', { credentials: 'include' })
      .then(r => r.json())
      .then(d => { if (d.success) setCreditTasks(d.data); })
      .catch(() => {})
      .finally(() => setTasksLoading(false));
  }, []);

  const getDisplayName = (u: User) => {
    return getCanonicalDisplayName(u);
  };

  const getInitials = (name: string) => {
    return name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();
  };

  const faqs = [
    {
      q: "How can I earn credits?",
      a: "Credits are awarded for active participation in the Nexus: Uploading quality portfolio work, completing film tasks, and consistent community contribution. Every approved task earns you credits."
    },
    {
      q: "Where can I see my credits?",
      a: "Your current credit balance is displayed on your personal Profile page, here on the global Leaderboard, and on your Dashboard indicators when logged in."
    },
    {
      q: "Where can I spend credits?",
      a: "COMING SOON: We are building a cinematic marketplace where credits can be used for project spotlighting, equipment discounts, and exclusive workshop access."
    }
  ];

  return (
    <section className="leaderboard-section">
      <div className="sec-label reveal">Rankings</div>
      <div className="sec-title reveal">The Nexus<br />Leaderboard</div>
      <p className="sec-sub reveal">Recognizing the most active creators, collaborators, and filmmakers in the community.</p>

      <div className="leaderboard-container reveal">
        <div className="leaderboard-header">
          <div className="leaderboard-title">
            <div className="leaderboard-subtitle">Top Performers</div>
            <h2>Elite Creators</h2>
          </div>
          <div className="status-item">
            <div className="status-dot"></div> Live Signal
          </div>
        </div>

        <div className="leaderboard-table-wrapper">
          <table className="leaderboard-table">
            <thead>
              <tr>
                <th>Rank</th>
                <th>Creator</th>
                <th>Role</th>
                <th>Rating</th>
                <th style={{ textAlign: 'right' }}>Credits</th>
              </tr>
            </thead>
            <tbody>
              {users.length === 0 ? (
                <tr>
                  <td colSpan={5} style={{ textAlign: 'center', padding: '100px 0', color: 'rgba(255,255,255,0.2)' }}>
                    No creators have earned credits yet.
                  </td>
                </tr>
              ) : (
                users.map((user, index) => {
                  const rank = index + 1;
                  const rankClass = rank <= 3 ? `top-rank-${rank}` : '';
                  const displayName = getDisplayName(user);
                  const avatarUrl = getAvatarUrl(user.name, user.gender, user.avatar_url);

                  return (
                    <tr key={user.id} className={`leaderboard-row ${rankClass}`}>
                      <td className="rank-cell">#{rank}</td>
                      <td>
                        <div className="user-cell">
                          {user.avatar_url ? (
                            <img src={avatarUrl} alt="" className="user-avatar" />
                          ) : (
                            <div className="user-avatar">{getInitials(user.name)}</div>
                          )}
                          <div className="user-info">
                            <span className="user-name" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                              {displayName}
                              {user.email_verified === true && (
                                <span className="verified-badge-inline" title="Verified Creator" style={{ display: 'inline-flex', alignItems: 'center' }}>
                                  <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--neon)', filter: 'drop-shadow(0 0 3px var(--neon))' }}>
                                    <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" fill="var(--neon)" />
                                  </svg>
                                </span>
                              )}
                            </span>
                            <span className="user-role">{user.college || 'Nexus Creator'}</span>
                          </div>
                        </div>
                      </td>
                      <td>{user.role || 'Crew'}</td>
                      <td>
                        {user.averageRating && user.averageRating > 0 ? (
                          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                            <span style={{ color: 'var(--amber)', textShadow: '0 0 6px rgba(255, 166, 32, 0.4)' }}>★</span>
                            <span>{user.averageRating.toFixed(1)}</span>
                            <span style={{ fontSize: '0.8em', color: 'var(--silver)' }}>({user.ratingCount})</span>
                          </div>
                        ) : (
                          <span style={{ color: 'var(--silver)', fontSize: '0.9em' }}>—</span>
                        )}
                      </td>
                      <td className="credits-cell">
                        {user.credits.toLocaleString()} <span style={{ fontSize: '0.7em', opacity: 0.5 }}>PTS</span>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── EARN CREDITS TASK BOARD ── */}
      <div className="reveal" style={{ marginTop: '64px' }}>
        <div className="sec-label">Rewards</div>
        <div className="sec-title" style={{ fontSize: 'clamp(28px,4vw,42px)', marginBottom: '12px' }}>Earn Credits</div>
        <p className="sec-sub" style={{ marginBottom: '32px' }}>Complete these actions to climb the leaderboard and unlock platform privileges.</p>

        {tasksLoading ? (
          <div style={{ textAlign: 'center', color: 'rgba(255,255,255,0.2)', fontSize: '11px', letterSpacing: '3px', padding: '40px' }}>LOADING TASKS...</div>
        ) : creditTasks.length === 0 ? (
          <div style={{ textAlign: 'center', color: 'rgba(255,255,255,0.2)', fontSize: '11px', letterSpacing: '3px', padding: '40px' }}>No active tasks at this time.</div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: '16px' }}>
            {creditTasks.map(task => (
              <div
                key={task.id}
                style={{
                  background: task.completed
                    ? 'linear-gradient(135deg, rgba(0,255,136,0.05), rgba(0,255,136,0.02))'
                    : 'linear-gradient(135deg, rgba(255,77,26,0.07), rgba(28,35,48,0.8))',
                  border: `1px solid ${task.completed ? 'rgba(0,255,136,0.2)' : 'rgba(255,77,26,0.18)'}`,
                  borderRadius: '10px',
                  padding: '20px 22px',
                  position: 'relative',
                  overflow: 'hidden',
                }}
              >
                {/* Accent bar */}
                <div style={{ position: 'absolute', top: 0, left: 0, width: '3px', height: '100%', background: task.completed ? 'var(--green)' : 'var(--neon)', borderRadius: '10px 0 0 10px' }} />

                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '10px', paddingLeft: '8px' }}>
                  <div style={{ fontSize: '12px', fontWeight: '700', letterSpacing: '1px', color: 'var(--text)', lineHeight: 1.4 }}>{task.name}</div>
                  <div style={{
                    background: task.completed ? 'rgba(0,255,136,0.12)' : 'rgba(255,77,26,0.12)',
                    border: `1px solid ${task.completed ? 'rgba(0,255,136,0.3)' : 'rgba(255,77,26,0.3)'}`,
                    borderRadius: '4px',
                    padding: '3px 8px',
                    fontSize: '10px',
                    fontWeight: '700',
                    letterSpacing: '1px',
                    color: task.completed ? 'var(--green)' : 'var(--neon)',
                    whiteSpace: 'nowrap',
                    marginLeft: '8px',
                  }}>
                    +{task.credits_rewarded} PTS
                  </div>
                </div>

                {task.description && (
                  <div style={{ fontSize: '11px', color: 'var(--text-dim)', lineHeight: 1.6, paddingLeft: '8px', marginBottom: '12px' }}>{task.description}</div>
                )}

                <div style={{ paddingLeft: '8px' }}>
                  {task.completed ? (
                    <div style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', fontSize: '9px', letterSpacing: '2px', color: 'var(--green)', textTransform: 'uppercase' }}>
                      <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                      COMPLETED
                    </div>
                  ) : (
                    <div style={{ fontSize: '9px', letterSpacing: '2px', color: 'rgba(255,255,255,0.25)', textTransform: 'uppercase' }}>PENDING</div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="faq-section reveal">
        <h3 className="faq-title">Credit Intelligence</h3>
        <div className="faq-grid">
          {faqs.map((faq, i) => (
            <div key={i} className={`faq-card ${activeFaq === i ? 'active' : ''}`}>
              <div className="faq-question" onClick={() => setActiveFaq(activeFaq === i ? null : i)}>
                {faq.q}
              </div>
              <div className="faq-answer">
                {faq.a}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
