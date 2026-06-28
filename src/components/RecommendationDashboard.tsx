'use client';

import { useState, useCallback } from 'react';

interface Script {
  id: number;
  title: string;
  genre: string;
  status: string;
  roles_needed: string;
  author_name: string;
}

interface Collaborator {
  id: number;
  displayName: string;
  role: string;
  college: string;
  city: string;
  credits: number;
}

interface Action {
  label: string;
  href: string;
  icon: string;
}

interface RecommendationData {
  scripts: Script[];
  collaborators: Collaborator[];
  actions: Action[];
}

export default function RecommendationDashboard() {
  const [data, setData] = useState<RecommendationData | null>(null);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/users/recommendations', { credentials: 'include' });
      const json = await res.json();
      if (json.success) {
        setData(json.data);
        setLoaded(true);
      } else {
        setError(json.message || 'Failed to load recommendations');
      }
    } catch {
      setError('Connection error. Please try again.');
    } finally {
      setLoading(false);
    }
  }, []);

  return (
    <div style={{ padding: '0 0 32px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px' }}>
        <div>
          <div style={{ fontSize: '9px', letterSpacing: '3px', color: 'var(--neon)', textTransform: 'uppercase', marginBottom: '4px' }}>
            ✦ Personalised
          </div>
          <h3 style={{ fontFamily: 'Bebas Neue, sans-serif', fontSize: '22px', letterSpacing: '3px', color: 'var(--cream)', margin: 0 }}>
            Recommendations
          </h3>
        </div>
        <button
          onClick={load}
          disabled={loading}
          style={{
            background: 'none',
            border: '1px solid rgba(255,77,26,0.3)',
            color: 'var(--neon)',
            padding: '8px 16px',
            fontSize: '9px',
            letterSpacing: '2px',
            textTransform: 'uppercase',
            cursor: loading ? 'wait' : 'pointer',
            borderRadius: '4px',
            transition: 'all 0.2s',
            opacity: loading ? 0.6 : 1,
          }}
        >
          {loading ? 'Loading...' : loaded ? '↺ Refresh' : 'Load Signals'}
        </button>
      </div>

      {error && (
        <div style={{ background: 'rgba(255,51,102,0.08)', border: '1px solid rgba(255,51,102,0.25)', borderRadius: '6px', padding: '12px 16px', fontSize: '11px', color: '#FF3366', marginBottom: '20px', letterSpacing: '1px' }}>
          {error}
        </div>
      )}

      {!loaded && !loading && (
        <div style={{ background: 'rgba(255,77,26,0.03)', border: '1px dashed rgba(255,77,26,0.15)', borderRadius: '8px', padding: '40px', textAlign: 'center' }}>
          <div style={{ fontSize: '28px', marginBottom: '12px', opacity: 0.4 }}>📡</div>
          <p style={{ color: 'var(--silver)', fontSize: '11px', letterSpacing: '1px', margin: 0 }}>
            Click &quot;Load Signals&quot; to discover personalised recommendations.
          </p>
        </div>
      )}

      {loaded && data && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>

          {/* Suggested Actions */}
          {data.actions.length > 0 && (
            <section>
              <div style={{ fontSize: '9px', letterSpacing: '3px', color: 'var(--silver)', textTransform: 'uppercase', marginBottom: '12px' }}>
                Suggested Actions
              </div>
              <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                {data.actions.map((a, i) => (
                  <a
                    key={i}
                    href={a.href}
                    style={{
                      display: 'flex', alignItems: 'center', gap: '8px',
                      background: 'var(--panel)', border: '1px solid var(--border)',
                      borderRadius: '6px', padding: '10px 16px',
                      textDecoration: 'none', color: 'var(--cream)',
                      fontSize: '11px', letterSpacing: '0.5px',
                      transition: 'border-color 0.2s',
                    }}
                  >
                    <span>{a.icon}</span>
                    <span>{a.label}</span>
                  </a>
                ))}
              </div>
            </section>
          )}

          {/* Recommended Scripts */}
          <section>
            <div style={{ fontSize: '9px', letterSpacing: '3px', color: 'var(--silver)', textTransform: 'uppercase', marginBottom: '12px' }}>
              Scripts Matching Your Role
            </div>
            {data.scripts.length === 0 ? (
              <p style={{ color: 'var(--dim)', fontSize: '11px', letterSpacing: '1px' }}>No matching scripts found right now.</p>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '12px' }}>
                {data.scripts.map(s => (
                  <a
                    key={s.id}
                    href={`/#explore`}
                    style={{
                      background: 'var(--machine)', border: '1px solid var(--rail)',
                      borderRadius: '8px', padding: '16px',
                      textDecoration: 'none', display: 'block',
                      transition: 'border-color 0.2s',
                    }}
                  >
                    <div style={{ fontSize: '9px', letterSpacing: '2px', color: 'var(--neon)', marginBottom: '6px', textTransform: 'uppercase' }}>
                      {s.genre || 'General'}
                    </div>
                    <div style={{ fontSize: '13px', fontWeight: '700', color: 'var(--cream)', marginBottom: '6px', lineHeight: '1.3' }}>
                      {s.title}
                    </div>
                    <div style={{ fontSize: '10px', color: 'var(--silver)', letterSpacing: '0.5px' }}>
                      by {s.author_name}
                    </div>
                    {s.roles_needed && (
                      <div style={{ fontSize: '9px', color: 'var(--dim)', marginTop: '8px', letterSpacing: '0.5px' }}>
                        Needs: {s.roles_needed}
                      </div>
                    )}
                  </a>
                ))}
              </div>
            )}
          </section>

          {/* Suggested Collaborators */}
          <section>
            <div style={{ fontSize: '9px', letterSpacing: '3px', color: 'var(--silver)', textTransform: 'uppercase', marginBottom: '12px' }}>
              Creators You May Know
            </div>
            {data.collaborators.length === 0 ? (
              <p style={{ color: 'var(--dim)', fontSize: '11px', letterSpacing: '1px' }}>No matching collaborators found.</p>
            ) : (
              <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                {data.collaborators.map(c => (
                  <a
                    key={c.id}
                    href={`/profile?id=${c.id}`}
                    style={{
                      background: 'var(--machine)', border: '1px solid var(--rail)',
                      borderRadius: '8px', padding: '14px 18px',
                      textDecoration: 'none', minWidth: '160px',
                      transition: 'border-color 0.2s',
                    }}
                  >
                    <div style={{ fontSize: '12px', fontWeight: '700', color: 'var(--cream)', marginBottom: '4px' }}>
                      {c.displayName}
                    </div>
                    <div style={{ fontSize: '10px', color: 'var(--neon)', letterSpacing: '1px', marginBottom: '4px' }}>
                      {c.role}
                    </div>
                    <div style={{ fontSize: '9px', color: 'var(--silver)' }}>
                      {[c.college, c.city].filter(Boolean).join(' · ') || 'Location unknown'}
                    </div>
                    <div style={{ fontSize: '9px', color: 'var(--dim)', marginTop: '6px' }}>
                      ✦ {c.credits} credits
                    </div>
                  </a>
                ))}
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
