'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Pusher from 'pusher-js';
import { getAvatarUrl } from '@/lib/avatars';
import { format } from 'date-fns';
import NewDirectMessageModal from '@/components/NewDirectMessageModal';
import TaskModal from '@/components/TaskModal';
import AvatarUploader from '@/components/AvatarUploader';
import { fetchWithCSRF } from '@/utils/fetchWithCSRF';
import './chat.css';

const cacheBustUrl = (url: string | null | undefined, updatedAt?: string | Date | number) => {
  if (!url) return '';
  if (url.startsWith('data:') || url.startsWith('blob:')) return url;
  if (url.includes('default-group.png') || url.includes('default-avatar')) return url;
  
  const t = updatedAt ? new Date(updatedAt).getTime() : Date.now();
  const separator = url.includes('?') ? '&' : '?';
  return `${url}${separator}t=${t}`;
};

const getRoleSlug = (role?: string): string => {
  if (!role) return 'other';
  const r = role.toLowerCase();
  if (r.includes('director')) return 'director';
  if (r.includes('photographer')) return 'photographer';
  if (r.includes('cinematographer') || r.includes('dp') || r.includes('camera')) return 'cinematographer';
  if (r.includes('writer')) return 'writer';
  if (r.includes('editor')) return 'editor';
  if (r.includes('sound')) return 'sound';
  if (r.includes('designer')) return 'designer';
  if (r.includes('actor')) return 'actor';
  if (r.includes('producer')) return 'producer';
  if (r.includes('lighting') || r.includes('gaffer')) return 'lighting';
  if (r.includes('support') || r.includes('spot')) return 'support';
  return 'other';
};

interface User {
  id: number;
  name: string;
  email?: string;
  screen_name?: string;
  display_preference?: string;
  avatar_url?: string;
  gender?: string;
  role?: string;
  college?: string;
  city?: string;
  skills?: string;
  credits?: number;
  created_at?: string;
  role_in_group?: 'Director' | 'Admin' | 'Member';
  secondary_role?: string;
}


interface ChatMessage {
  id: number | string; // Support temporary string IDs for optimistic updates
  conversation_id: number;
  sender_id: number;
  content: string;
  created_at: string;
  sender: User;
  status?: 'pending' | 'sending' | 'sent' | 'failed';
  tempId?: string;
}

interface QueuedMessage {
  tempId: string;
  content: string;
  conversationId: number;
  senderId: number;
  createdAt: string;
  status: 'pending' | 'sending' | 'sent' | 'failed';
  retryCount: number;
  nextRetryAt: number;
}

type PusherConnectionState = 'connected' | 'connecting' | 'disconnected' | 'unavailable';

interface Conversation {
  id: number;
  name?: string;
  is_group?: boolean;
  avatar_url?: string;
  users: User[];
  messages: ChatMessage[];
  unread?: number;
  updated_at?: string;
  my_role?: 'Director' | 'Admin' | 'Member';
  canMembersMessage?: boolean;
  community_id?: number;
  groupSettings?: string | any;
}

interface Task {
  id: number;
  title: string;
  description?: string;
  status: 'Todo' | 'In Progress' | 'Review' | 'Done';
  priority: 'Low' | 'Medium' | 'High' | 'Critical';
  assignee_id?: number;
  creator_id: number;
  due_date?: string;
  reward_credits: number;
  approval_status: 'Pending' | 'Approved';
  completed_at?: string;
  approved_at?: string;
  created_at: string;
}

type ChatState = 'loading' | 'ready' | 'error' | 'not-found';

// ───────────────────────────────────────────────────────────────
// Custom Hooks for Resilient Message Queue System
// ───────────────────────────────────────────────────────────────


/**
 * Hook: useMessageQueue
 * Manages the outbox queue with retry logic and localStorage persistence
 */
const useMessageQueue = (enabled: boolean) => {
  const [queue, setQueue] = useState<QueuedMessage[]>([]);
  const processingRef = useRef(false);
  const queueRef = useRef<QueuedMessage[]>([]);

  // Keep queueRef in sync with queue state
  useEffect(() => {
    queueRef.current = queue;
  }, [queue]);
  
  // Restore queue from localStorage on mount
  useEffect(() => {
    if (!enabled) return;
    try {
      const stored = localStorage.getItem('take_one_message_queue');
      if (stored) {
        const restoredQueue = JSON.parse(stored);
        setQueue(restoredQueue);
      }
    } catch (err) {
      console.error('[QUEUE] Failed to restore queue from localStorage', err);
    }
  }, [enabled]);
  
  // Persist queue to localStorage whenever it changes
  useEffect(() => {
    if (!enabled) return;
    try {
      localStorage.setItem('take_one_message_queue', JSON.stringify(queue));
    } catch (err) {
      console.error('[QUEUE] Failed to persist queue to localStorage', err);
    }
  }, [queue, enabled]);
  
  const addToQueue = useCallback((message: QueuedMessage) => {
    setQueue(prev => [...prev, message]);
  }, []);
  
  const updateMessageStatus = useCallback((tempId: string, status: QueuedMessage['status'], retryCount?: number) => {
    setQueue(prev => prev.map(msg => 
      msg.tempId === tempId 
        ? { ...msg, status, retryCount: retryCount !== undefined ? retryCount : msg.retryCount }
        : msg
    ));
  }, []);
  
  const removeFromQueue = useCallback((tempId: string) => {
    setQueue(prev => prev.filter(msg => msg.tempId !== tempId));
  }, []);
  
  const getNextMessageToRetry = useCallback((): QueuedMessage | null => {
    const now = Date.now();
    const pending = queueRef.current.find(msg => 
      (msg.status === 'pending' || msg.status === 'failed') &&
      msg.retryCount < 5 &&
      msg.nextRetryAt <= now
    );
    return pending || null;
  }, []);
  
  const getExponentialBackoffDelay = (retryCount: number): number => {
    const delays = [1000, 2000, 4000, 8000, 8000];
    return delays[Math.min(retryCount, delays.length - 1)];
  };
  
  const scheduleRetry = useCallback((tempId: string, retryCount: number) => {
    const delay = getExponentialBackoffDelay(retryCount);
    const nextRetryAt = Date.now() + delay;
    setQueue(prev => prev.map(msg =>
      msg.tempId === tempId
        ? { ...msg, status: 'failed', retryCount, nextRetryAt }
        : msg
    ));
  }, []);
  
  const isProcessing = useCallback(() => processingRef.current, []);
  const setProcessing = useCallback((value: boolean) => { processingRef.current = value; }, []);
  
  return useMemo(() => ({
    queue,
    addToQueue,
    updateMessageStatus,
    removeFromQueue,
    getNextMessageToRetry,
    scheduleRetry,
    isProcessing,
    setProcessing
  }), [
    queue,
    addToQueue,
    updateMessageStatus,
    removeFromQueue,
    getNextMessageToRetry,
    scheduleRetry,
    isProcessing,
    setProcessing
  ]);
};

const loadRazorpayScript = () => {
  return new Promise((resolve) => {
    if (typeof window === 'undefined') {
      resolve(false);
      return;
    }
    if ((window as any).Razorpay) {
      resolve(true);
      return;
    }
    const script = document.createElement('script');
    script.src = 'https://checkout.razorpay.com/v1/checkout.js';
    script.onload = () => resolve(true);
    script.onerror = () => resolve(false);
    document.body.appendChild(script);
  });
};

interface OfferCardProps {
  message: ChatMessage;
  onAccept: (offer: any, selectedPlan: string) => void;
  onNegotiate: (offer: any) => void;
}

const OfferCard: React.FC<OfferCardProps> = ({ message, onAccept, onNegotiate }) => {
  const match = message.content.match(/\[WEBSITE_OFFER:(\d+)\]/);
  const offerId = match ? match[1] : null;
  const [offer, setOffer] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [selectedPlan, setSelectedPlan] = useState<'Annual' | 'Quarterly' | 'Monthly'>('Annual');

  useEffect(() => {
    if (offerId) {
      const token = localStorage.getItem('token');
      fetch(`/api/services/offers/${offerId}`, {
        headers: token ? { 'Authorization': `Bearer ${token}` } : {}
      })
        .then(res => res.json())
        .then(data => {
          if (data.success) {
            setOffer(data.data);
            if (data.data.selected_maintenance_plan) {
              setSelectedPlan(data.data.selected_maintenance_plan);
            }
          }
          setLoading(false);
        })
        .catch(() => setLoading(false));
    }
  }, [offerId]);

  if (loading) {
    return <div className="offer-card-loading" style={{ color: '#888', padding: '10px 0', fontFamily: 'monospace' }}>Accessing proposal details...</div>;
  }

  if (!offer) {
    return <div className="offer-card-error" style={{ color: '#ff4d1a', padding: '10px 0', fontFamily: 'monospace' }}>Proposal not found or inaccessible.</div>;
  }

  let features: string[] = [];
  try {
    features = typeof offer.features === 'string' ? JSON.parse(offer.features) : (offer.features || []);
  } catch (e) {
    features = [];
  }

  let includedServices: string[] = [];
  try {
    includedServices = typeof offer.included_services === 'string' ? JSON.parse(offer.included_services) : (offer.included_services || []);
  } catch (e) {
    includedServices = ['Hosting', 'SSL Security', 'Software Updates', 'Daily Backups', 'Uptime Monitoring', 'Priority Support'];
  }

  const getPlanPrice = (plan: 'Annual' | 'Quarterly' | 'Monthly') => {
    if (plan === 'Annual') {
      const base = Number(offer.annual_price || 0);
      const discount = Number(offer.annual_discount || 0);
      return base - discount;
    } else if (plan === 'Quarterly') {
      return Number(offer.quarterly_price || 0);
    } else {
      return Number(offer.monthly_price || 0);
    }
  };

  const currentMaintPrice = getPlanPrice(selectedPlan);
  const totalInitialPayment = Number(offer.advance_payment) + currentMaintPrice;

  return (
    <div className="offer-card-wrap" style={{
      background: 'linear-gradient(135deg, rgba(20, 20, 25, 0.98), rgba(10, 10, 15, 0.98))',
      border: '1px solid rgba(255, 77, 26, 0.25)',
      borderRadius: '12px',
      padding: '24px',
      margin: '16px 0',
      maxWidth: '460px',
      boxShadow: '0 8px 32px rgba(0,0,0,0.6)',
      textAlign: 'left',
      fontFamily: 'system-ui, -apple-system, sans-serif'
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', borderBottom: '1px solid rgba(255,255,255,0.08)', paddingBottom: '12px' }}>
        <h4 style={{ margin: 0, color: '#ff4d22', textTransform: 'uppercase', letterSpacing: '1.5px', fontSize: '13px', fontWeight: 800 }}>
          {offer.website_type === 'Maintenance Renewal' ? 'Maintenance Renewal Offer' : 'Website Development Proposal'}
        </h4>
        <span className={`status-badge status-${offer.status}`} style={{
          fontSize: '9px',
          textTransform: 'uppercase',
          letterSpacing: '1px',
          padding: '2px 8px',
          borderRadius: '4px',
          fontWeight: 'bold',
          background: offer.status === 'accepted' ? 'rgba(76, 175, 80, 0.15)' : offer.status === 'rejected' ? 'rgba(244, 67, 54, 0.15)' : 'rgba(255, 152, 0, 0.15)',
          color: offer.status === 'accepted' ? '#4CAF50' : offer.status === 'rejected' ? '#F44336' : '#FF9800',
          border: `1px solid ${offer.status === 'accepted' ? '#4CAF50' : offer.status === 'rejected' ? '#F44336' : '#FF9800'}`
        }}>
          {offer.status}
        </span>
      </div>

      <div style={{ marginBottom: '16px' }}>
        <div style={{ fontSize: '10px', color: '#888', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Website Type</div>
        <div style={{ fontSize: '16px', fontWeight: 'bold', color: '#fff', marginTop: '2px' }}>{offer.website_type}</div>
      </div>

      {offer.description && (
        <div style={{ marginBottom: '16px' }}>
          <div style={{ fontSize: '10px', color: '#888', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Description</div>
          <div style={{ fontSize: '13.5px', color: '#ccc', marginTop: '4px', lineHeight: '1.4' }}>{offer.description}</div>
        </div>
      )}

      {features.length > 0 && (
        <div style={{ marginBottom: '20px' }}>
          <div style={{ fontSize: '10px', color: '#888', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '6px' }}>Key Deliverables</div>
          <ul style={{ margin: 0, paddingLeft: '18px', fontSize: '13px', color: '#ccc', lineHeight: '1.5' }}>
            {features.map((feat: string, i: number) => (
              <li key={i} style={{ marginBottom: '4px' }}>{feat}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Website Development Pricing Breakdown */}
      {offer.website_type !== 'Maintenance Renewal' && (
        <div style={{
          background: 'rgba(255,255,255,0.02)',
          padding: '16px',
          borderRadius: '8px',
          marginBottom: '20px',
          border: '1px solid rgba(255,255,255,0.05)'
        }}>
          <div style={{ fontSize: '10px', color: '#888', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '8px' }}>Development Pricing (One-time)</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '15px' }}>
            <div>
              <div style={{ fontSize: '9px', color: '#666', textTransform: 'uppercase' }}>Advance Dev Fee</div>
              <div style={{ fontSize: '15px', fontWeight: 'bold', color: '#fff', marginTop: '2px' }}>₹{Number(offer.advance_payment).toLocaleString('en-IN')}</div>
            </div>
            <div>
              <div style={{ fontSize: '9px', color: '#666', textTransform: 'uppercase' }}>Final Dev Fee</div>
              <div style={{ fontSize: '15px', fontWeight: 'bold', color: '#fff', marginTop: '2px' }}>₹{Number(offer.final_payment).toLocaleString('en-IN')}</div>
            </div>
          </div>
          <div style={{ marginTop: '10px', paddingTop: '10px', borderTop: '1px solid rgba(255,255,255,0.05)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '11px', color: '#888' }}>Total Development Cost</span>
            <span style={{ fontSize: '15px', fontWeight: 'bold', color: '#ff4d22' }}>₹{Number(offer.price).toLocaleString('en-IN')}</span>
          </div>
        </div>
      )}

      {/* Maintenance Pricing Selectors */}
      <div style={{ marginBottom: '20px' }}>
        <div style={{ fontSize: '10px', color: '#888', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '10px' }}>Website Maintenance Plan</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {/* Annual option */}
          {offer.annual_price && (
            <label style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '12px 14px',
              borderRadius: '8px',
              border: `1px solid ${selectedPlan === 'Annual' ? '#ff4d22' : 'rgba(255,255,255,0.05)'}`,
              background: selectedPlan === 'Annual' ? 'rgba(255, 77, 34, 0.08)' : 'rgba(255,255,255,0.01)',
              cursor: offer.status === 'pending' ? 'pointer' : 'default',
              transition: 'all 0.2s ease'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <input
                  type="radio"
                  name={`maint-plan-${offer.id}`}
                  checked={selectedPlan === 'Annual'}
                  disabled={offer.status !== 'pending'}
                  onChange={() => setSelectedPlan('Annual')}
                  style={{ accentColor: '#ff4d22', cursor: 'pointer' }}
                />
                <div>
                  <div style={{ fontSize: '13px', fontWeight: 'bold', color: '#fff' }}>Annual Maintenance</div>
                  <div style={{ fontSize: '11px', color: '#888' }}>Billed every 12 months</div>
                </div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: '13px', fontWeight: 'bold', color: '#ff4d22' }}>
                  ₹{getPlanPrice('Annual').toLocaleString('en-IN')}/yr
                </div>
                {Number(offer.annual_discount || 0) > 0 && (
                  <span style={{
                    fontSize: '9px',
                    background: 'rgba(76, 175, 80, 0.15)',
                    color: '#4CAF50',
                    padding: '1px 5px',
                    borderRadius: '4px',
                    fontWeight: 'bold',
                    display: 'inline-block',
                    marginTop: '2px'
                  }}>
                    Save ₹{Number(offer.annual_discount).toLocaleString('en-IN')}
                  </span>
                )}
              </div>
            </label>
          )}

          {/* Quarterly option */}
          {offer.quarterly_price && (
            <label style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '12px 14px',
              borderRadius: '8px',
              border: `1px solid ${selectedPlan === 'Quarterly' ? '#ff4d22' : 'rgba(255,255,255,0.05)'}`,
              background: selectedPlan === 'Quarterly' ? 'rgba(255, 77, 34, 0.08)' : 'rgba(255,255,255,0.01)',
              cursor: offer.status === 'pending' ? 'pointer' : 'default',
              transition: 'all 0.2s ease'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <input
                  type="radio"
                  name={`maint-plan-${offer.id}`}
                  checked={selectedPlan === 'Quarterly'}
                  disabled={offer.status !== 'pending'}
                  onChange={() => setSelectedPlan('Quarterly')}
                  style={{ accentColor: '#ff4d22', cursor: 'pointer' }}
                />
                <div>
                  <div style={{ fontSize: '13px', fontWeight: 'bold', color: '#fff' }}>Quarterly Maintenance</div>
                  <div style={{ fontSize: '11px', color: '#888' }}>Billed every 3 months</div>
                </div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: '13px', fontWeight: 'bold', color: '#ff4d22' }}>
                  ₹{getPlanPrice('Quarterly').toLocaleString('en-IN')}/qt
                </div>
              </div>
            </label>
          )}

          {/* Monthly option */}
          {offer.monthly_price && (
            <label style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '12px 14px',
              borderRadius: '8px',
              border: `1px solid ${selectedPlan === 'Monthly' ? '#ff4d22' : 'rgba(255,255,255,0.05)'}`,
              background: selectedPlan === 'Monthly' ? 'rgba(255, 77, 34, 0.08)' : 'rgba(255,255,255,0.01)',
              cursor: offer.status === 'pending' ? 'pointer' : 'default',
              transition: 'all 0.2s ease'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <input
                  type="radio"
                  name={`maint-plan-${offer.id}`}
                  checked={selectedPlan === 'Monthly'}
                  disabled={offer.status !== 'pending'}
                  onChange={() => setSelectedPlan('Monthly')}
                  style={{ accentColor: '#ff4d22', cursor: 'pointer' }}
                />
                <div>
                  <div style={{ fontSize: '13px', fontWeight: 'bold', color: '#fff' }}>Monthly Maintenance</div>
                  <div style={{ fontSize: '11px', color: '#888' }}>Billed every month</div>
                </div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: '13px', fontWeight: 'bold', color: '#ff4d22' }}>
                  ₹{getPlanPrice('Monthly').toLocaleString('en-IN')}/mo
                </div>
              </div>
            </label>
          )}
        </div>
      </div>

      {/* Included Services list */}
      {includedServices.length > 0 && (
        <div style={{ marginBottom: '20px', background: 'rgba(255,255,255,0.01)', padding: '12px 14px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.03)' }}>
          <div style={{ fontSize: '9px', color: '#666', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '6px' }}>Services Included with Maintenance</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px', fontSize: '11px', color: '#aaa' }}>
            {includedServices.map((service, idx) => (
              <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span style={{ color: '#4CAF50', fontSize: '12px' }}>✓</span> {service}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Dynamic Payment Breakdown */}
      {offer.status === 'pending' && (
        <div style={{
          background: 'linear-gradient(180deg, rgba(255, 77, 34, 0.05) 0%, rgba(255, 77, 34, 0.15) 100%)',
          padding: '16px',
          borderRadius: '8px',
          border: '1px solid rgba(255, 77, 34, 0.3)',
          marginBottom: '20px'
        }}>
          <div style={{ fontSize: '10px', color: '#ff8866', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '8px', fontWeight: 'bold' }}>First Payment Breakdown</div>
          {offer.website_type !== 'Maintenance Renewal' && (
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: '#ccc', marginBottom: '6px' }}>
              <span>Advance Development Payment</span>
              <span>₹{Number(offer.advance_payment).toLocaleString('en-IN')}</span>
            </div>
          )}
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: '#ccc', marginBottom: '8px' }}>
            <span>{selectedPlan} Maintenance Plan</span>
            <span>₹{currentMaintPrice.toLocaleString('en-IN')}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '14px', color: '#fff', fontWeight: 'bold', paddingTop: '8px', borderTop: '1px solid rgba(255,255,255,0.1)' }}>
            <span>Total Initial Due</span>
            <span style={{ color: '#ff4d22' }}>₹{totalInitialPayment.toLocaleString('en-IN')}</span>
          </div>
        </div>
      )}

      {offer.status === 'pending' && (
        <div style={{ display: 'flex', gap: '10px', marginTop: '15px' }}>
          <button
            onClick={() => onAccept(offer, selectedPlan)}
            style={{
              flex: 1,
              background: '#ff4d22',
              color: '#fff',
              border: 'none',
              borderRadius: '6px',
              padding: '12px',
              fontWeight: 'bold',
              cursor: 'pointer',
              textTransform: 'uppercase',
              letterSpacing: '1px',
              fontSize: '11px',
              boxShadow: '0 4px 14px rgba(255, 77, 34, 0.3)',
              transition: 'all 0.2s ease'
            }}
          >
            Accept Proposal
          </button>
          {offer.website_type !== 'Maintenance Renewal' && (
            <button
              onClick={() => onNegotiate(offer)}
              style={{
                background: 'rgba(255,255,255,0.05)',
                color: '#fff',
                border: '1px solid rgba(255,255,255,0.15)',
                borderRadius: '6px',
                padding: '12px 18px',
                fontWeight: 'bold',
                cursor: 'pointer',
                textTransform: 'uppercase',
                letterSpacing: '1px',
                fontSize: '11px',
                transition: 'all 0.2s ease'
              }}
            >
              Negotiate
            </button>
          )}
        </div>
      )}
    </div>
  );
};

interface MaintenanceOfferCardProps {
  message: ChatMessage;
  onPaymentSuccess: () => void;
}

const MaintenanceOfferCard: React.FC<MaintenanceOfferCardProps> = ({ message, onPaymentSuccess }) => {
  const match = message.content.match(/\[MAINTENANCE_OFFER:(\d+)\]/);
  const maintenanceId = match ? match[1] : null;
  const [maintenance, setMaintenance] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [paying, setPaying] = useState(false);

  const fetchMaintenance = useCallback(() => {
    if (maintenanceId) {
      const token = localStorage.getItem('token');
      fetch(`/api/services/maintenance/${maintenanceId}`, {
        headers: token ? { 'Authorization': `Bearer ${token}` } : {}
      })
        .then(res => res.json())
        .then(data => {
          if (data.success) {
            setMaintenance(data.data);
          }
          setLoading(false);
        })
        .catch(() => setLoading(false));
    }
  }, [maintenanceId]);

  useEffect(() => {
    fetchMaintenance();
  }, [fetchMaintenance]);

  const handleDecline = async () => {
    if (!maintenance) return;
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`/api/services/maintenance/${maintenance.id}/respond`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {})
        },
        body: JSON.stringify({ status: 'declined' })
      });
      const data = await response.json();
      if (data.success) {
        setMaintenance(data.data);
        alert('Offer status updated: Maybe Later');
      } else {
        alert(data.message || 'Failed to decline proposal');
      }
    } catch (e) {
      console.error(e);
      alert('Error responding to proposal');
    }
  };

  const handlePurchase = async () => {
    if (!maintenance) return;
    setPaying(true);
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`/api/services/maintenance/${maintenance.id}/pay`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {})
        }
      });
      const rpOrder = await response.json();
      if (!rpOrder.success) {
        alert(rpOrder.message || 'Payment failed to initiate');
        setPaying(false);
        return;
      }

      const loaded = await loadRazorpayScript();
      if (!loaded) {
        alert('Razorpay SDK failed to load');
        setPaying(false);
        return;
      }

      const options = {
        key: rpOrder.keyId,
        amount: rpOrder.amount,
        currency: rpOrder.currency,
        name: 'Take One',
        description: `Annual Website Maintenance Plan`,
        order_id: rpOrder.orderId,
        handler: async (resp: any) => {
          try {
            const verifyRes = await fetch('/api/services/maintenance/verify-payment', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                ...(token ? { 'Authorization': `Bearer ${token}` } : {})
              },
              body: JSON.stringify({
                razorpay_order_id: resp.razorpay_order_id,
                razorpay_payment_id: resp.razorpay_payment_id,
                razorpay_signature: resp.razorpay_signature,
                maintenanceId: maintenance.id,
                action: 'purchase'
              })
            });
            const verifyJson = await verifyRes.json();
            if (verifyJson.success) {
              alert('Annual Maintenance plan activated successfully!');
              onPaymentSuccess();
              fetchMaintenance();
            } else {
              alert(verifyJson.message || 'Payment verification failed');
            }
          } catch (err) {
            console.error(err);
            alert('Verification request failed');
          }
        },
        theme: {
          color: '#ff4d1a'
        }
      };

      const paymentObject = new (window as any).Razorpay(options);
      paymentObject.open();
    } catch (e) {
      console.error(e);
      alert('Checkout error');
    } finally {
      setPaying(false);
    }
  };

  if (loading) {
    return <div style={{ color: '#888', padding: '10px 0', fontFamily: 'monospace' }}>Accessing maintenance offer...</div>;
  }

  if (!maintenance) {
    return <div style={{ color: '#ff4d1a', padding: '10px 0', fontFamily: 'monospace' }}>Maintenance proposal not found.</div>;
  }

  let included: string[] = [];
  try {
    included = typeof maintenance.included_services === 'string'
      ? JSON.parse(maintenance.included_services)
      : (maintenance.included_services || []);
  } catch (e) {
    included = [];
  }

  return (
    <div className="offer-card-wrap" style={{
      background: 'linear-gradient(135deg, rgba(20, 20, 25, 0.95), rgba(10, 10, 15, 0.95))',
      border: '1px solid rgba(255, 77, 26, 0.2)',
      borderRadius: '8px',
      padding: '20px',
      margin: '12px 0',
      maxWidth: '450px',
      boxShadow: '0 4px 20px rgba(0,0,0,0.5)',
      textAlign: 'left'
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px', borderBottom: '1px solid rgba(255,255,255,0.08)', paddingBottom: '10px' }}>
        <h4 style={{ margin: 0, color: 'var(--neon)', textTransform: 'uppercase', letterSpacing: '1.5px', fontSize: '13px' }}>
          Annual Maintenance Offer
        </h4>
        <span className={`status-badge status-${maintenance.status}`} style={{
          fontSize: '9px',
          textTransform: 'uppercase',
          letterSpacing: '1px',
          padding: '2px 8px',
          borderRadius: '4px',
          fontWeight: 'bold',
          background: maintenance.status === 'active' ? 'rgba(76, 175, 80, 0.15)' : maintenance.status === 'declined' ? 'rgba(244, 67, 54, 0.15)' : 'rgba(255, 152, 0, 0.15)',
          color: maintenance.status === 'active' ? '#4CAF50' : maintenance.status === 'declined' ? '#F44336' : '#FF9800',
          border: `1px solid ${maintenance.status === 'active' ? '#4CAF50' : maintenance.status === 'declined' ? '#F44336' : '#FF9800'}`
        }}>
          {maintenance.status}
        </span>
      </div>

      <div style={{ marginBottom: '15px', fontSize: '13px', color: '#ccc', lineHeight: '1.4' }}>
        Get a professionally developed website with a one-time development fee. Continue worry-free with an optional annual maintenance plan covering hosting, updates, security, backups, and technical support.
      </div>

      {maintenance.description && (
        <div style={{ marginBottom: '15px' }}>
          <div style={{ fontSize: '10px', color: '#888', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Plan Details</div>
          <div style={{ fontSize: '13px', color: '#ccc', marginTop: '4px', lineHeight: '1.4' }}>{maintenance.description}</div>
        </div>
      )}

      {included.length > 0 && (
        <div style={{ marginBottom: '20px' }}>
          <div style={{ fontSize: '10px', color: '#888', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '6px' }}>Services Included</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', fontSize: '12px', color: '#ccc' }}>
            {included.map((srv: string, i: number) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span style={{ color: 'var(--neon)' }}>✓</span> {srv}
              </div>
            ))}
          </div>
        </div>
      )}

      <div style={{
        background: 'rgba(255,255,255,0.02)',
        padding: '12px 15px',
        borderRadius: '6px',
        marginBottom: '15px',
        border: '1px solid rgba(255,255,255,0.05)'
      }}>
        <div style={{ fontSize: '9px', color: '#888', textTransform: 'uppercase' }}>Annual Maintenance Fee</div>
        <div style={{ fontSize: '18px', fontWeight: 'bold', color: 'var(--neon)', marginTop: '2px' }}>₹{Number(maintenance.annual_price).toLocaleString('en-IN')}<span style={{ fontSize: '11px', color: '#666', fontWeight: 'normal' }}> / Year</span></div>
      </div>

      {maintenance.status === 'pending' && (
        <div style={{ display: 'flex', gap: '10px', marginTop: '15px' }}>
          <button
            onClick={handlePurchase}
            disabled={paying}
            style={{
              flex: 1,
              background: 'var(--neon)',
              color: '#000',
              border: 'none',
              borderRadius: '4px',
              padding: '10px',
              fontWeight: 'bold',
              cursor: paying ? 'wait' : 'pointer',
              textTransform: 'uppercase',
              letterSpacing: '1px',
              fontSize: '11px'
            }}
          >
            {paying ? 'Processing...' : 'Purchase Plan'}
          </button>
          <button
            onClick={handleDecline}
            style={{
              background: 'rgba(255,255,255,0.05)',
              color: '#fff',
              border: '1px solid rgba(255,255,255,0.1)',
              borderRadius: '4px',
              padding: '10px 15px',
              fontWeight: 'bold',
              cursor: 'pointer',
              textTransform: 'uppercase',
              letterSpacing: '1px',
              fontSize: '11px'
            }}
          >
            Maybe Later
          </button>
        </div>
      )}
    </div>
  );
};

interface ProjectTrackerProps {
  order: any;
  onPaymentSuccess: () => void;
}

const ProjectTracker: React.FC<ProjectTrackerProps> = ({ order, onPaymentSuccess }) => {
  const [paying, setPaying] = useState(false);
  const [activePanel, setActivePanel] = useState<'development' | 'maintenance'>('development');
  
  const [maintenance, setMaintenance] = useState<any>(null);
  const [loadingMaintenance, setLoadingMaintenance] = useState(false);
  const [payingMaintenance, setPayingMaintenance] = useState(false);

  const fetchMaintenance = useCallback(() => {
    if (!order) return;
    setLoadingMaintenance(true);
    const token = localStorage.getItem('token');
    fetch('/api/services/maintenance', {
      headers: token ? { 'Authorization': `Bearer ${token}` } : {}
    })
      .then(res => res.json())
      .then(data => {
        if (data.success) {
          const match = data.data.find((m: any) => m.website_order_id === order.id);
          setMaintenance(match || null);
        }
        setLoadingMaintenance(false);
      })
      .catch(() => setLoadingMaintenance(false));
  }, [order?.id]);

  useEffect(() => {
    if (order) {
      fetchMaintenance();
    }
  }, [order, fetchMaintenance]);

  if (!order) {
    return (
      <div style={{ padding: '40px', textAlign: 'center', color: '#888' }}>
        <h3 style={{ color: 'var(--neon)', fontSize: '16px', textTransform: 'uppercase', letterSpacing: '1.5px', marginBottom: '10px' }}>No Active Website Projects</h3>
        <p style={{ fontSize: '13px', margin: 0 }}>Proposals will appear in your transmission chat history.</p>
      </div>
    );
  }

  let milestones: any[] = [];
  try {
    milestones = typeof order.milestones === 'string' ? JSON.parse(order.milestones) : (order.milestones || []);
  } catch (e) {
    milestones = [];
  }
  
  const handlePayment = async (stage: 'advance' | 'final') => {
    setPaying(true);
    try {
      const token = localStorage.getItem('token');
      const response = await fetch('/api/services/orders/create-payment', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {})
        },
        body: JSON.stringify({ orderId: order.id, stage })
      });
      const orderJson = await response.json();
      if (!orderJson.success) {
        alert(orderJson.message || 'Payment initiation failed');
        setPaying(false);
        return;
      }

      const loaded = await loadRazorpayScript();
      if (!loaded) {
        alert('Razorpay SDK failed to load. Are you online?');
        setPaying(false);
        return;
      }

      const options = {
        key: orderJson.keyId,
        amount: orderJson.amount,
        currency: orderJson.currency,
        name: 'Take One',
        description: `${order.offer.website_type} - ${stage === 'advance' ? 'Advance Payment' : 'Final Balance'}`,
        order_id: orderJson.orderId,
        handler: async (response: any) => {
          try {
            const verifyRes = await fetch('/api/services/orders/verify-payment', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                ...(token ? { 'Authorization': `Bearer ${token}` } : {})
              },
              body: JSON.stringify({
                razorpay_order_id: response.razorpay_order_id,
                razorpay_payment_id: response.razorpay_payment_id,
                razorpay_signature: response.razorpay_signature,
                orderId: order.id
              })
            });
            const verifyJson = await verifyRes.json();
            if (verifyJson.success) {
              alert('Payment verified and captured successfully!');
              onPaymentSuccess();
            } else {
              alert(verifyJson.message || 'Payment verification failed');
            }
          } catch (err) {
            console.error(err);
            alert('Verification request failed');
          }
        },
        prefill: {
          name: '',
          email: ''
        },
        theme: {
          color: '#ff4d1a'
        }
      };

      const paymentObject = new (window as any).Razorpay(options);
      paymentObject.open();
    } catch (err) {
      console.error(err);
      alert('An error occurred during checkout');
    } finally {
      setPaying(false);
    }
  };

  const handleRenewMaintenance = async () => {
    if (!maintenance) return;
    setPayingMaintenance(true);
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`/api/services/maintenance/${maintenance.id}/renew`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {})
        }
      });
      const rpOrder = await response.json();
      if (!rpOrder.success) {
        alert(rpOrder.message || 'Payment initiation failed');
        setPayingMaintenance(false);
        return;
      }

      const loaded = await loadRazorpayScript();
      if (!loaded) {
        alert('Razorpay SDK failed to load');
        setPayingMaintenance(false);
        return;
      }

      const options = {
        key: rpOrder.keyId,
        amount: rpOrder.amount,
        currency: rpOrder.currency,
        name: 'Take One',
        description: `${maintenance.plan_type} Website Maintenance Plan Renewal`,
        order_id: rpOrder.orderId,
        handler: async (resp: any) => {
          try {
            const verifyRes = await fetch('/api/services/maintenance/verify-payment', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                ...(token ? { 'Authorization': `Bearer ${token}` } : {})
              },
              body: JSON.stringify({
                razorpay_order_id: resp.razorpay_order_id,
                razorpay_payment_id: resp.razorpay_payment_id,
                razorpay_signature: resp.razorpay_signature,
                maintenanceId: maintenance.id,
                action: 'renewal'
              })
            });
            const verifyJson = await verifyRes.json();
            if (verifyJson.success) {
              alert(`${maintenance.plan_type} Maintenance plan renewed successfully!`);
              fetchMaintenance();
              onPaymentSuccess();
            } else {
              alert(verifyJson.message || 'Payment verification failed');
            }
          } catch (err) {
            console.error(err);
            alert('Verification request failed');
          }
        },
        theme: {
          color: '#ff4d1a'
        }
      };

      const paymentObject = new (window as any).Razorpay(options);
      paymentObject.open();
    } catch (e) {
      console.error(e);
      alert('Checkout error');
    } finally {
      setPayingMaintenance(false);
    }
  };

  const handlePurchaseMaintenance = async () => {
    if (!maintenance) return;
    setPayingMaintenance(true);
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`/api/services/maintenance/${maintenance.id}/pay`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {})
        }
      });
      const rpOrder = await response.json();
      if (!rpOrder.success) {
        alert(rpOrder.message || 'Payment failed to initiate');
        setPayingMaintenance(false);
        return;
      }

      const loaded = await loadRazorpayScript();
      if (!loaded) {
        alert('Razorpay SDK failed to load');
        setPayingMaintenance(false);
        return;
      }

      const options = {
        key: rpOrder.keyId,
        amount: rpOrder.amount,
        currency: rpOrder.currency,
        name: 'Take One',
        description: `${maintenance.plan_type} Website Maintenance Plan`,
        order_id: rpOrder.orderId,
        handler: async (resp: any) => {
          try {
            const verifyRes = await fetch('/api/services/maintenance/verify-payment', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                ...(token ? { 'Authorization': `Bearer ${token}` } : {})
              },
              body: JSON.stringify({
                razorpay_order_id: resp.razorpay_order_id,
                razorpay_payment_id: resp.razorpay_payment_id,
                razorpay_signature: resp.razorpay_signature,
                maintenanceId: maintenance.id,
                action: 'purchase'
              })
            });
            const verifyJson = await verifyRes.json();
            if (verifyJson.success) {
              alert(`${maintenance.plan_type} Maintenance plan activated successfully!`);
              fetchMaintenance();
              onPaymentSuccess();
            } else {
              alert(verifyJson.message || 'Payment verification failed');
            }
          } catch (err) {
            console.error(err);
            alert('Verification request failed');
          }
        },
        theme: {
          color: '#ff4d1a'
        }
      };

      const paymentObject = new (window as any).Razorpay(options);
      paymentObject.open();
    } catch (e) {
      console.error(e);
      alert('Checkout error');
    } finally {
      setPayingMaintenance(false);
    }
  };

  const getRemainingDays = (expiryDateStr: string) => {
    const diff = new Date(expiryDateStr).getTime() - new Date().getTime();
    return Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)));
  };

  return (
    <div className="project-tracker-wrap" style={{ padding: '20px', color: '#fff', maxHeight: '100%', overflowY: 'auto' }}>
      {/* Marketing copy banner */}
      <div style={{
        background: 'rgba(255, 77, 26, 0.04)',
        border: '1px solid rgba(255, 77, 26, 0.15)',
        borderRadius: '6px',
        padding: '12px 15px',
        marginBottom: '20px',
        fontSize: '12px',
        color: '#ccc',
        lineHeight: '1.4',
        display: 'flex',
        alignItems: 'center',
        gap: '10px'
      }}>
        <span style={{ fontSize: '18px' }}>💡</span>
        <span>
          Get a professionally developed website with a one-time development fee. Continue worry-free with an optional maintenance plan covering hosting, updates, security, backups, and technical support.
        </span>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: '15px', borderBottom: '1px solid rgba(255,255,255,0.08)', marginBottom: '20px' }}>
        <button
          onClick={() => setActivePanel('development')}
          style={{
            background: 'none',
            border: 'none',
            borderBottom: activePanel === 'development' ? '2px solid var(--neon)' : '2px solid transparent',
            color: activePanel === 'development' ? '#fff' : '#888',
            padding: '10px 15px',
            cursor: 'pointer',
            fontWeight: 'bold',
            fontSize: '13px'
          }}
        >
          Development Details
        </button>
        <button
          onClick={() => setActivePanel('maintenance')}
          style={{
            background: 'none',
            border: 'none',
            borderBottom: activePanel === 'maintenance' ? '2px solid var(--neon)' : '2px solid transparent',
            color: activePanel === 'maintenance' ? '#fff' : '#888',
            padding: '10px 15px',
            cursor: 'pointer',
            fontWeight: 'bold',
            fontSize: '13px'
          }}
        >
          Maintenance Subscription
        </button>
      </div>

      {activePanel === 'development' ? (
        <>
          <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: '15px', borderBottom: '1px solid rgba(255,255,255,0.08)', paddingBottom: '15px', marginBottom: '20px', alignItems: 'center' }}>
            <div>
              <h2 style={{ margin: 0, fontSize: '18px', color: 'var(--neon)' }}>{order.offer.website_type}</h2>
              <p style={{ margin: '5px 0 0 0', fontSize: '11px', color: '#888', fontFamily: 'monospace' }}>
                ORDER ID: #{order.id} | Status: <span style={{ color: '#fff', textTransform: 'uppercase', fontWeight: 'bold' }}>{order.project_status.replace(/_/g, ' ')}</span>
              </p>
            </div>
            
            <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
              {!order.advance_paid && (
                <button
                  onClick={() => handlePayment('advance')}
                  disabled={paying}
                  style={{ background: 'var(--neon)', color: '#000', border: 'none', padding: '10px 20px', borderRadius: '4px', fontWeight: 'bold', fontSize: '11px', textTransform: 'uppercase', cursor: paying ? 'wait' : 'pointer', boxShadow: '0 0 10px rgba(255, 77, 26, 0.3)' }}
                >
                  {paying ? 'Processing...' : `Pay Advance - ₹${Number(order.offer.advance_payment).toLocaleString('en-IN')}`}
                </button>
              )}

              {order.advance_paid && !order.final_paid && order.project_status === 'pending_final_payment' && (
                <button
                  onClick={() => handlePayment('final')}
                  disabled={paying}
                  style={{ background: 'var(--neon)', color: '#000', border: 'none', padding: '10px 20px', borderRadius: '4px', fontWeight: 'bold', fontSize: '11px', textTransform: 'uppercase', cursor: paying ? 'wait' : 'pointer', boxShadow: '0 0 10px rgba(255, 77, 26, 0.3)' }}
                >
                  {paying ? 'Processing...' : `Pay Balance - ₹${Number(order.offer.final_payment).toLocaleString('en-IN')}`}
                </button>
              )}

              {order.advance_paid && !order.final_paid && order.project_status !== 'pending_final_payment' && (
                <span style={{ color: 'var(--neon)', fontWeight: 'bold', fontSize: '11px', border: '1px solid var(--neon)', padding: '6px 12px', borderRadius: '4px', background: 'rgba(255, 77, 26, 0.05)', letterSpacing: '0.5px' }}>
                  Advance Paid (Development In Progress)
                </span>
              )}

              {order.final_paid && (
                <span style={{ color: '#4CAF50', fontWeight: 'bold', fontSize: '11px', border: '1px solid #4CAF50', padding: '6px 12px', borderRadius: '4px', background: 'rgba(76, 175, 80, 0.1)', letterSpacing: '0.5px' }}>
                  Project Fully Paid ✓
                </span>
              )}
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '20px' }}>
            <div className="galaxy-card" style={{ padding: '20px', background: 'rgba(0,0,0,0.2)', border: '1px solid rgba(255,255,255,0.05)' }}>
              <h3 style={{ margin: '0 0 20px 0', fontSize: '12px', textTransform: 'uppercase', letterSpacing: '1.5px', color: '#888' }}>Development Milestones</h3>
              
              <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                {milestones.map((m: any, idx: number) => {
                  const isActive = (order.project_status === 'in_progress' && idx === 1) || 
                                   (order.project_status === 'design_review' && idx === 1) ||
                                   (order.project_status === 'development' && idx === 2) ||
                                   (order.project_status === 'final_review' && idx === 3);
                  return (
                    <div key={m.id} style={{ display: 'flex', gap: '15px', alignItems: 'flex-start' }}>
                      <div style={{
                        width: '24px',
                        height: '24px',
                        borderRadius: '50%',
                        background: m.completed ? '#4CAF50' : isActive ? 'var(--neon)' : 'rgba(255,255,255,0.03)',
                        border: `1px solid ${m.completed ? '#4CAF50' : isActive ? 'var(--neon)' : 'rgba(255,255,255,0.1)'}`,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: '11px',
                        color: m.completed || isActive ? '#000' : '#666',
                        fontWeight: 'bold',
                        marginTop: '2px',
                        boxShadow: isActive ? '0 0 8px var(--neon)' : 'none'
                      }}>
                        {m.completed ? '✓' : idx + 1}
                      </div>
                      <div style={{ flex: 1 }}>
                        <h4 style={{ margin: 0, fontSize: '14px', color: m.completed ? '#fff' : isActive ? 'var(--neon)' : '#888', fontWeight: isActive ? 'bold' : 'normal' }}>
                          {m.title}
                        </h4>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '4px' }}>
                          <span style={{ fontSize: '10px', color: m.completed ? '#4CAF50' : isActive ? 'var(--neon)' : '#555', textTransform: 'uppercase', letterSpacing: '0.5px', fontWeight: 'bold' }}>
                            {m.completed ? 'Completed' : isActive ? 'Active Phase' : 'Pending'}
                          </span>
                          {m.updated_at && (
                            <span style={{ fontSize: '10px', color: '#444' }}>
                              {new Date(m.updated_at).toLocaleDateString('en-IN')}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="galaxy-card" style={{ padding: '20px', display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '15px', textAlign: 'center', background: 'rgba(0,0,0,0.15)', border: '1px solid rgba(255,255,255,0.03)' }}>
              <div>
                <div style={{ fontSize: '10px', color: '#666', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Timeline</div>
                <div style={{ fontSize: '16px', fontWeight: 'bold', marginTop: '5px' }}>{order.offer.timeline_days} Days</div>
              </div>
              <div>
                <div style={{ fontSize: '10px', color: '#666', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Advance Payment</div>
                <div style={{ fontSize: '16px', fontWeight: 'bold', marginTop: '5px', color: order.advance_paid ? '#4CAF50' : '#FF9800' }}>
                  ₹{Number(order.offer.advance_payment).toLocaleString('en-IN')}
                </div>
              </div>
              <div>
                <div style={{ fontSize: '10px', color: '#666', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Final Balance</div>
                <div style={{ fontSize: '16px', fontWeight: 'bold', marginTop: '5px', color: order.final_paid ? '#4CAF50' : '#FF9800' }}>
                  ₹{Number(order.offer.final_payment).toLocaleString('en-IN')}
                </div>
              </div>
            </div>
          </div>
        </>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '20px' }}>
          {loadingMaintenance ? (
            <div style={{ color: '#888', padding: '40px', textAlign: 'center', fontFamily: 'monospace' }}>
              Retrieving maintenance subscriptions...
            </div>
          ) : !maintenance ? (
            <div style={{ padding: '45px 25px', textAlign: 'center', background: 'rgba(0,0,0,0.15)', border: '1px solid rgba(255,255,255,0.03)', borderRadius: '6px' }}>
              <div style={{ fontSize: '32px', marginBottom: '15px' }}>🛡️</div>
              <h3 style={{ color: 'var(--neon)', fontSize: '15px', textTransform: 'uppercase', letterSpacing: '1px', margin: '0 0 10px 0' }}>
                Maintenance Not Offered Yet
              </h3>
              <p style={{ fontSize: '13px', color: '#aaa', margin: '0 auto', maxWidth: '400px', lineHeight: '1.5' }}>
                Your project will be eligible for our maintenance plan once the website development has been completed.
              </p>
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '20px' }}>
              <div style={{
                background: 'linear-gradient(135deg, rgba(20, 20, 25, 0.95), rgba(10, 10, 15, 0.95))',
                border: '1px solid rgba(255, 77, 26, 0.2)',
                borderRadius: '8px',
                padding: '20px',
                boxShadow: '0 4px 20px rgba(0,0,0,0.5)'
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px', borderBottom: '1px solid rgba(255,255,255,0.08)', paddingBottom: '10px' }}>
                  <h4 style={{ margin: 0, color: 'var(--neon)', textTransform: 'uppercase', letterSpacing: '1px', fontSize: '13px' }}>
                    {maintenance.plan_type} Maintenance Plan
                  </h4>
                  <span className={`status-badge status-${maintenance.status}`} style={{
                    fontSize: '9px',
                    textTransform: 'uppercase',
                    letterSpacing: '1px',
                    padding: '2px 8px',
                    borderRadius: '4px',
                    fontWeight: 'bold',
                    background: maintenance.status === 'active' ? 'rgba(76, 175, 80, 0.15)' : maintenance.status === 'declined' ? 'rgba(244, 67, 54, 0.15)' : 'rgba(255, 152, 0, 0.15)',
                    color: maintenance.status === 'active' ? '#4CAF50' : maintenance.status === 'declined' ? '#F44336' : '#FF9800',
                    border: `1px solid ${maintenance.status === 'active' ? '#4CAF50' : maintenance.status === 'declined' ? '#F44336' : '#FF9800'}`
                  }}>
                    {maintenance.status}
                  </span>
                </div>

                {maintenance.description && (
                  <p style={{ fontSize: '13px', color: '#ccc', lineHeight: '1.4', marginBottom: '15px' }}>{maintenance.description}</p>
                )}

                {/* Included Services */}
                {(() => {
                  let incl: string[] = [];
                  try {
                    incl = typeof maintenance.included_services === 'string'
                      ? JSON.parse(maintenance.included_services)
                      : (maintenance.included_services || []);
                  } catch (e) {
                    incl = [];
                  }
                  if (incl.length === 0) return null;
                  return (
                    <div style={{ marginBottom: '20px' }}>
                      <div style={{ fontSize: '10px', color: '#888', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '8px' }}>Services Included</div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', fontSize: '12px', color: '#ccc' }}>
                        {incl.map((s: string, idx: number) => (
                          <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <span style={{ color: 'var(--neon)' }}>✓</span> {s}
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })()}

                {/* Pricing / Validity */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '15px', background: 'rgba(255,255,255,0.02)', padding: '15px', borderRadius: '6px', border: '1px solid rgba(255,255,255,0.05)', marginBottom: '15px' }}>
                  <div>
                    <div style={{ fontSize: '9px', color: '#888', textTransform: 'uppercase' }}>{maintenance.plan_type} Price</div>
                    <div style={{ fontSize: '16px', fontWeight: 'bold', color: 'var(--neon)', marginTop: '2px' }}>
                      ₹{Number(maintenance.custom_price || maintenance.annual_price || 0).toLocaleString('en-IN')}{maintenance.plan_type === 'Annual' ? '/yr' : maintenance.plan_type === 'Quarterly' ? '/quarter' : '/mo'}
                    </div>
                  </div>
                  {maintenance.status === 'active' && maintenance.expiry_date && (
                    <div>
                      <div style={{ fontSize: '9px', color: '#888', textTransform: 'uppercase' }}>Remaining Validity</div>
                      <div style={{ fontSize: '16px', fontWeight: 'bold', color: '#fff', marginTop: '2px' }}>
                        {getRemainingDays(maintenance.expiry_date)} Days Left
                      </div>
                    </div>
                  )}
                </div>

                {maintenance.status === 'active' && maintenance.start_date && maintenance.expiry_date && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: '#666', marginBottom: '15px', fontFamily: 'monospace' }}>
                    <span>START: {new Date(maintenance.start_date).toLocaleDateString('en-IN')}</span>
                    <span>EXPIRY: {new Date(maintenance.expiry_date).toLocaleDateString('en-IN')}</span>
                  </div>
                )}

                {/* Actions */}
                <div style={{ marginTop: '15px' }}>
                  {(maintenance.status === 'pending' || maintenance.status === 'declined') && (
                    <button
                      onClick={handlePurchaseMaintenance}
                      disabled={payingMaintenance}
                      style={{
                        width: '100%',
                        background: 'var(--neon)',
                        color: '#000',
                        border: 'none',
                        borderRadius: '4px',
                        padding: '10px',
                        fontWeight: 'bold',
                        cursor: payingMaintenance ? 'wait' : 'pointer',
                        textTransform: 'uppercase',
                        letterSpacing: '1px',
                        fontSize: '11px'
                      }}
                    >
                      {payingMaintenance ? 'Processing...' : `Activate ${maintenance.plan_type} Maintenance`}
                    </button>
                  )}

                  {maintenance.status === 'active' && (
                    <button
                      onClick={handleRenewMaintenance}
                      disabled={payingMaintenance}
                      style={{
                        width: '100%',
                        background: 'rgba(255,255,255,0.05)',
                        color: '#fff',
                        border: '1px solid rgba(255,255,255,0.1)',
                        borderRadius: '4px',
                        padding: '10px',
                        fontWeight: 'bold',
                        cursor: payingMaintenance ? 'wait' : 'pointer',
                        textTransform: 'uppercase',
                        letterSpacing: '1px',
                        fontSize: '11px'
                      }}
                    >
                      {payingMaintenance ? 'Processing...' : 'Renew Subscription (Extend 1 Year)'}
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default function ChatPage() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConv, setActiveConv] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [showMobileSidebar, setShowMobileSidebar] = useState(true);
  const [newMessage, setNewMessage] = useState('');
  const [user, setUser] = useState<User | null>(null);

  useEffect(() => {
    if (user && typeof (window as any).applyRoleTheme === 'function') {
      (window as any).applyRoleTheme(user.role);
    }
  }, [user]);

  const isFounder = user?.secondary_role?.toLowerCase() === 'founder';
  const [state, setState] = useState<ChatState>('loading');
  const [statusText, setStatusText] = useState('Synchronizing with Community...');
  const [messageLoading, setMessageLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [isGroupModalOpen, setIsGroupModalOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [typingUsers, setTypingUsers] = useState<{[key: number]: string}>({});
  
  // New interaction states
  const [showSearch, setShowSearch] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const [detailsTab, setDetailsTab] = useState<'members' | 'settings'>('members');
  const [showMenu, setShowMenu] = useState(false);
  const [chatSearchQuery, setChatSearchQuery] = useState('');
  const [mutedConvIds, setMutedConvIds] = useState<Set<number>>(new Set());
  const [hasMore, setHasMore] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  

  // Task states
  const [activeTab, setActiveTab] = useState<'chat' | 'feed' | 'tasks' | 'project_tracker'>('chat');
  const [activeOrder, setActiveOrder] = useState<any>(null);
  const [negotiatingOffer, setNegotiatingOffer] = useState<any>(null);
  const [isNegotiateModalOpen, setIsNegotiateModalOpen] = useState(false);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [tasksLoading, setTasksLoading] = useState(false);
  const [isTaskModalOpen, setIsTaskModalOpen] = useState(false);

  // Message Queue System
  const messageQueue = useMessageQueue(true);
  const {
    addToQueue,
    updateMessageStatus,
    removeFromQueue,
    getNextMessageToRetry,
    scheduleRetry,
    isProcessing,
    setProcessing
  } = messageQueue;
  const [pusherConnectionState, setPusherConnectionState] = useState<PusherConnectionState>('disconnected');

  // Community System States
  const [inCommunity, setInCommunity] = useState(false);
  const [communityRole, setCommunityRole] = useState<string | null>(null);
  const [communityData, setCommunityData] = useState<any>(null);
  const communityDataRef = useRef<any>(null);
  useEffect(() => {
    communityDataRef.current = communityData;
  }, [communityData]);
  const [showCommunityDashboard, setShowCommunityDashboard] = useState(false);
  
  // Modals
  const [isCommunityModalOpen, setIsCommunityModalOpen] = useState(false);
  const [isInviteModalOpen, setIsInviteModalOpen] = useState(false);
  const [isCreateGroupModalOpen, setIsCreateGroupModalOpen] = useState(false);

  // Community config
  const [pricingConfigs, setPricingConfigs] = useState<any[]>([]);
  const [selectedPlan, setSelectedPlan] = useState<'Starter' | 'Growth' | 'Custom'>('Starter');
  const [customMembersCount, setCustomMembersCount] = useState(50);
  const [newCommunityName, setNewCommunityName] = useState('');
  const [newCommunityDesc, setNewCommunityDesc] = useState('');
  const [communityCreationStep, setCommunityCreationStep] = useState(1);
  const [activeOrderId, setActiveOrderId] = useState<string | null>(null);

  // Invites & Groups & Multi-Community
  const [myInvitations, setMyInvitations] = useState<any[]>([]);
  const [myCommunities, setMyCommunities] = useState<any[]>([]);
  const [userSearchQuery, setUserSearchQuery] = useState('');
  const [userSearchResults, setUserSearchResults] = useState<any[]>([]);
  const [userSearchLoading, setUserSearchLoading] = useState(false);
  const [inviteLoading, setInviteLoading] = useState(false);
  const [inviteError, setInviteError] = useState('');
  const [inviteSuccess, setInviteSuccess] = useState('');
  const [newGroupName, setNewGroupName] = useState('');
  const [groupLoading, setGroupLoading] = useState(false);
  const [dashboardStats, setDashboardStats] = useState<any>(null);

  // New Multi-Community and Join Request States
  const [allCommunities, setAllCommunities] = useState<any[]>([]);
  const [communitySearchQuery, setCommunitySearchQuery] = useState('');
  const [allCommunitiesLoading, setAllCommunitiesLoading] = useState(false);
  const [myRequests, setMyRequests] = useState<any[]>([]);
  const [isJoinRequestModalOpen, setIsJoinRequestModalOpen] = useState(false);

  // Community Feed / Posts States
  const [communityPosts, setCommunityPosts] = useState<any[]>([]);
  const [postsLoading, setPostsLoading] = useState(false);
  const [isCreatePostOpen, setIsCreatePostOpen] = useState(false);
  const [postCaption, setPostCaption] = useState('');
  const [postFiles, setPostFiles] = useState<FileList | null>(null);
  const [activeCommentsPostId, setActiveCommentsPostId] = useState<number | null>(null);
  const [commentText, setCommentText] = useState('');
  const [showAutoInviteModal, setShowAutoInviteModal] = useState(false);
  const [autoInviteToHandle, setAutoInviteToHandle] = useState<any | null>(null);
  const [viewingGalaxyLanding, setViewingGalaxyLanding] = useState(false);

  const [isInvitationsManagementModalOpen, setIsInvitationsManagementModalOpen] = useState(false);
  const [invitationsList, setInvitationsList] = useState<any[]>([]);
  const [invitationsLoading, setInvitationsLoading] = useState(false);

  const isMessagingRestricted = useMemo(() => {
    if (!activeConv?.is_group) return false;
    const isOwnerOrMod = ['Owner', 'Moderator'].includes(communityRole || '');
    const isGrpAdminOrDir = activeConv.my_role === 'Admin' || activeConv.my_role === 'Director';
    return activeConv.canMembersMessage === false && !isOwnerOrMod && !isGrpAdminOrDir;
  }, [activeConv, communityRole]);

  const communityIdForInvitations = communityData?.id;
  const fetchCommunityInvitations = useCallback(async () => {
    if (!communityIdForInvitations) return;
    setInvitationsLoading(true);
    try {
      const token = typeof window !== 'undefined' ? localStorage.getItem('take_one_token') : null;
      const res = await fetch(`/api/community/invitations?communityId=${communityIdForInvitations}`, {
        headers: token ? { 'Authorization': `Bearer ${token}` } : {}
      });
      const data = await res.json();
      if (data.success) {
        setInvitationsList(data.invitations || []);
      }
    } catch (err) {
      console.error('Error fetching community invitations:', err);
    } finally {
      setInvitationsLoading(false);
    }
  }, [communityIdForInvitations]);

  const cancelInvitation = async (inviteId: number) => {
    try {
      const token = typeof window !== 'undefined' ? localStorage.getItem('take_one_token') : null;
      const res = await fetchWithCSRF(`/api/community/invitations/${inviteId}/cancel`, {
        method: 'POST',
        headers: token ? { 'Authorization': `Bearer ${token}` } : {}
      });
      const data = await res.json();
      if (data.success) {
        alert('Invitation cancelled successfully.');
        fetchCommunityInvitations();
      } else {
        alert(data.message || 'Failed to cancel invitation');
      }
    } catch (err) {
      console.error('Error cancelling invitation:', err);
      alert('Failed to cancel invitation');
    }
  };

  const resendInvitation = async (inviteId: number) => {
    try {
      const token = typeof window !== 'undefined' ? localStorage.getItem('take_one_token') : null;
      const res = await fetchWithCSRF(`/api/community/invitations/${inviteId}/resend`, {
        method: 'POST',
        headers: token ? { 'Authorization': `Bearer ${token}` } : {}
      });
      const data = await res.json();
      if (data.success) {
        alert('Invitation resent successfully.');
        fetchCommunityInvitations();
      } else {
        alert(data.message || 'Failed to resend invitation');
      }
    } catch (err) {
      console.error('Error resending invitation:', err);
      alert('Failed to resend invitation');
    }
  };

  const [pendingJoinRequests, setPendingJoinRequests] = useState<any[]>([]);
  const [joinRequestsLoading, setJoinRequestsLoading] = useState(false);

  const fetchPendingJoinRequests = useCallback(async (convId: number) => {
    setJoinRequestsLoading(true);
    try {
      const token = typeof window !== 'undefined' ? localStorage.getItem('take_one_token') : null;
      const res = await fetch(`/api/chat/conversations/${convId}/join-requests`, {
        headers: token ? { 'Authorization': `Bearer ${token}` } : {}
      });
      const data = await res.json();
      if (data.success) {
        setPendingJoinRequests(data.data || []);
      }
    } catch (err) {
      console.error('Error fetching pending requests:', err);
    } finally {
      setJoinRequestsLoading(false);
    }
  }, []);

  const handleApproveJoinRequest = async (convId: number, requestId: number) => {
    try {
      const token = typeof window !== 'undefined' ? localStorage.getItem('take_one_token') : null;
      const res = await fetchWithCSRF(`/api/chat/conversations/${convId}/join-requests/${requestId}/approve`, {
        method: 'POST',
        headers: token ? { 'Authorization': `Bearer ${token}` } : {}
      });
      const data = await res.json();
      if (data.success) {
        alert('Request approved successfully!');
        fetchPendingJoinRequests(convId);
      } else {
        alert(data.message || 'Failed to approve request');
      }
    } catch (err) {
      console.error('Approve request error:', err);
      alert('Failed to approve request');
    }
  };

  const handleRejectJoinRequest = async (convId: number, requestId: number) => {
    try {
      const token = typeof window !== 'undefined' ? localStorage.getItem('take_one_token') : null;
      const res = await fetchWithCSRF(`/api/chat/conversations/${convId}/join-requests/${requestId}/reject`, {
        method: 'POST',
        headers: token ? { 'Authorization': `Bearer ${token}` } : {}
      });
      const data = await res.json();
      if (data.success) {
        alert('Request rejected successfully!');
        fetchPendingJoinRequests(convId);
      } else {
        alert(data.message || 'Failed to reject request');
      }
    } catch (err) {
      console.error('Reject request error:', err);
      alert('Failed to reject request');
    }
  };

  const handlePromoteMember = async (convId: number, memberUserId: number) => {
    try {
      const token = typeof window !== 'undefined' ? localStorage.getItem('take_one_token') : null;
      const res = await fetchWithCSRF(`/api/chat/conversations/${convId}/member-role`, {
        method: 'PATCH',
        headers: token ? { 'Authorization': `Bearer ${token}` } : {},
        body: JSON.stringify({ userId: memberUserId, role: 'Admin' })
      });
      const data = await res.json();
      if (data.success) {
        alert('Member promoted to Admin successfully.');
      } else {
        alert(data.message || 'Failed to promote member');
      }
    } catch (err) {
      console.error('Promote member error:', err);
      alert('Failed to promote member');
    }
  };

  const handleDemoteMember = async (convId: number, memberUserId: number) => {
    try {
      const token = typeof window !== 'undefined' ? localStorage.getItem('take_one_token') : null;
      const res = await fetchWithCSRF(`/api/chat/conversations/${convId}/member-role`, {
        method: 'PATCH',
        headers: token ? { 'Authorization': `Bearer ${token}` } : {},
        body: JSON.stringify({ userId: memberUserId, role: 'Member' })
      });
      const data = await res.json();
      if (data.success) {
        alert('Member demoted successfully.');
      } else {
        alert(data.message || 'Failed to demote member');
      }
    } catch (err) {
      console.error('Demote member error:', err);
      alert('Failed to demote member');
    }
  };

  const handleRemoveGroupMember = async (convId: number, memberUserId: number) => {
    if (!confirm('Are you sure you want to remove this member from the group?')) return;
    try {
      const token = typeof window !== 'undefined' ? localStorage.getItem('take_one_token') : null;
      const res = await fetchWithCSRF(`/api/chat/conversations/${convId}/remove-member`, {
        method: 'POST',
        headers: token ? { 'Authorization': `Bearer ${token}` } : {},
        body: JSON.stringify({ userId: memberUserId })
      });
      const data = await res.json();
      if (data.success) {
        alert('Member removed successfully.');
      } else {
        alert(data.message || 'Failed to remove member');
      }
    } catch (err) {
      console.error('Remove member error:', err);
      alert('Failed to remove member');
    }
  };

  const handleUpdateSetting = async (convId: number, key: string, value: any) => {
    try {
      const token = typeof window !== 'undefined' ? localStorage.getItem('take_one_token') : null;
      const res = await fetchWithCSRF(`/api/chat/conversations/${convId}/settings`, {
        method: 'PATCH',
        headers: token ? { 'Authorization': `Bearer ${token}` } : { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [key]: value })
      });
      const data = await res.json();
      if (data.success) {
        setActiveConv(prev => {
          if (!prev) return null;
          const currentSettings = prev.groupSettings ? (typeof prev.groupSettings === 'string' ? JSON.parse(prev.groupSettings) : prev.groupSettings) : {};
          const updatedSettings = { ...currentSettings, [key]: value };
          return {
            ...prev,
            groupSettings: updatedSettings,
            ...(key === 'canMembersMessage' ? { canMembersMessage: value === 'Everyone' || value === true } : {})
          };
        });
      } else {
        alert(data.message || 'Failed to update setting');
      }
    } catch (err) {
      console.error('Failed to update setting', err);
      alert('Failed to update setting');
    }
  };

  useEffect(() => {
    if (activeConv?.is_group && showDetails && (activeConv?.my_role === 'Admin' || activeConv?.my_role === 'Director' || ['Owner', 'Moderator'].includes(communityRole || ''))) {
      fetchPendingJoinRequests(activeConv.id);
    }
  }, [activeConv?.id, activeConv?.is_group, activeConv?.my_role, showDetails, communityRole, fetchPendingJoinRequests]);

  const fetchAllCommunities = useCallback(async (search = '') => {
    setAllCommunitiesLoading(true);
    try {
      const token = typeof window !== 'undefined' ? localStorage.getItem('take_one_token') : null;
      const res = await fetch(`/api/community/list-all?search=${encodeURIComponent(search)}`, {
        headers: token ? { 'Authorization': `Bearer ${token}` } : {}
      });
      const data = await res.json();
      if (data.success) {
        setAllCommunities(data.data || []);
      }
    } catch (err) {
      console.error('Error fetching communities:', err);
    } finally {
      setAllCommunitiesLoading(false);
    }
  }, []);

  const fetchMyRequests = useCallback(async () => {
    try {
      const token = typeof window !== 'undefined' ? localStorage.getItem('take_one_token') : null;
      const res = await fetch('/api/community/my-requests', {
        headers: token ? { 'Authorization': `Bearer ${token}` } : {}
      });
      const data = await res.json();
      if (data.success) {
        setMyRequests(data.data || []);
      }
    } catch (err) {
      console.error('Error fetching my requests:', err);
    }
  }, []);


  const handleRequestJoin = async (communityId: number) => {
    try {
      const token = typeof window !== 'undefined' ? localStorage.getItem('take_one_token') : null;
      const res = await fetch('/api/community/join-request', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': token ? `Bearer ${token}` : ''
        },
        body: JSON.stringify({ communityId })
      });
      const data = await res.json();
      if (data.success) {
        alert(data.message || 'Join request submitted successfully!');
        await fetchAllCommunities(communitySearchQuery);
        await fetchMyRequests();
      } else {
        alert(data.message || 'Failed to submit join request');
      }
    } catch (err) {
      console.error('Error requesting to join:', err);
      alert('Error requesting to join community');
    }
  };


  const handleAcceptInvite = async (inviteId: number) => {
    try {
      const token = typeof window !== 'undefined' ? localStorage.getItem('take_one_token') : null;
      const res = await fetch(`/api/community/invitations/${inviteId}/accept`, {
        method: 'POST',
        headers: {
          'Authorization': token ? `Bearer ${token}` : ''
        }
      });
      const data = await res.json();
      if (data.success) {
        alert('Invitation accepted successfully!');
        setShowAutoInviteModal(false);
        setAutoInviteToHandle(null);
        await fetchMyCommunity();
        await fetchMyInvitations();
      } else {
        alert(data.message || 'Failed to accept invitation');
      }
    } catch (err) {
      console.error('Error accepting invitation:', err);
      alert('Error accepting invitation');
    }
  };

  const handleRejectInvite = async (inviteId: number) => {
    try {
      const token = typeof window !== 'undefined' ? localStorage.getItem('take_one_token') : null;
      const res = await fetch(`/api/community/invitations/${inviteId}/reject`, {
        method: 'POST',
        headers: {
          'Authorization': token ? `Bearer ${token}` : ''
        }
      });
      const data = await res.json();
      if (data.success) {
        alert('Invitation rejected successfully!');
        setShowAutoInviteModal(false);
        setAutoInviteToHandle(null);
        await fetchMyInvitations();
      } else {
        alert(data.message || 'Failed to reject invitation');
      }
    } catch (err) {
      console.error('Error rejecting invitation:', err);
      alert('Error rejecting invitation');
    }
  };

  const fetchDashboardStats = useCallback(async (communityId?: number) => {
    try {
      const token = typeof window !== 'undefined' ? localStorage.getItem('take_one_token') : null;
      const targetId = communityId || communityDataRef.current?.id;
      const url = targetId ? `/api/community/dashboard?communityId=${targetId}` : '/api/community/dashboard';
      const res = await fetch(url, {
        headers: token ? { 'Authorization': `Bearer ${token}` } : {}
      });
      const data = await res.json();
      if (data.success) {
        setDashboardStats(data.data);
      }
    } catch (err) {
      console.error('Error fetching dashboard stats:', err);
    }
  }, []);

  // Fetch Community Info
  const fetchMyCommunity = useCallback(async () => {
    try {
      const token = typeof window !== 'undefined' ? localStorage.getItem('take_one_token') : null;
      const res = await fetch('/api/community/my-community', {
        credentials: 'include',
        headers: token ? { 'Authorization': `Bearer ${token}` } : {}
      });
      const json = await res.json();
      if (json.success) {
        setInCommunity(json.inCommunity);
        if (json.inCommunity && json.communities && json.communities.length > 0) {
          setMyCommunities(json.communities);
          setCommunityData((prev: any) => {
            const found = prev ? json.communities.find((c: any) => c.id === prev.id) : null;
            if (found) {
              setCommunityRole(found.role);
              fetchDashboardStats(found.id);
              return found;
            }
            setCommunityRole(json.communities[0].role);
            fetchDashboardStats(json.communities[0].id);
            return json.communities[0];
          });
          return json.communities;
        } else {
          setMyCommunities([]);
          setCommunityData(null);
          setCommunityRole(null);
          return [];
        }
      }
      return [];
    } catch (err) {
      console.error('Error fetching community status:', err);
      return [];
    }
  }, [fetchDashboardStats]);

  const fetchMyInvitations = useCallback(async () => {
    try {
      const token = typeof window !== 'undefined' ? localStorage.getItem('take_one_token') : null;
      const res = await fetch('/api/community/invitations/my-invitations', {
        headers: token ? { 'Authorization': `Bearer ${token}` } : {}
      });
      const json = await res.json();
      if (json.success) {
        setMyInvitations(json.invitations);
        const pending = json.invitations.find((inv: any) => inv.status === 'PENDING');
        if (pending) {
          setAutoInviteToHandle(pending);
          setShowAutoInviteModal(true);
        }
      }
    } catch (err) {
      console.error('Error fetching invitations:', err);
    }
  }, []);

  const fetchPricingConfigs = useCallback(async () => {
    try {
      const token = typeof window !== 'undefined' ? localStorage.getItem('take_one_token') : null;
      const res = await fetch('/api/community/pricing-configs', {
        headers: token ? { 'Authorization': `Bearer ${token}` } : {}
      });
      const data = await res.json();
      if (data.success) {
        setPricingConfigs(data.data);
      }
    } catch (err) {
      console.error('Error fetching pricing config:', err);
    }
  }, []);

  const handleInviteMember = async (targetUserId: number) => {
    if (!communityData?.id) {
      setInviteError('No active community selected');
      return;
    }
    setInviteLoading(true);
    setInviteError('');
    setInviteSuccess('');
    try {
      const token = typeof window !== 'undefined' ? localStorage.getItem('take_one_token') : null;
      const res = await fetch('/api/community/members/invite', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': token ? `Bearer ${token}` : ''
        },
        body: JSON.stringify({ userId: targetUserId, communityId: communityData.id })
      });
      const data = await res.json();
      if (data.success) {
        setInviteSuccess(data.message);
        setUserSearchQuery('');
        setUserSearchResults([]);
      } else {
        setInviteError(data.message || 'Invitation failed');
      }
    } catch {
      setInviteError('Error inviting member');
    } finally {
      setInviteLoading(false);
    }
  };

  const handleAcceptInvitation = async (invitationId: number) => {
    try {
      const token = typeof window !== 'undefined' ? localStorage.getItem('take_one_token') : null;
      const res = await fetch(`/api/community/invitations/${invitationId}/accept`, {
        method: 'POST',
        headers: {
          'Authorization': token ? `Bearer ${token}` : ''
        }
      });
      const data = await res.json();
      if (data.success) {
        alert(data.message || 'Joined community successfully!');
        await fetchMyCommunity();
        await fetchMyInvitations();
        await fetchConversations();
      } else {
        alert(data.message || 'Failed to accept invitation');
      }
    } catch (err) {
      console.error('Error accepting invitation:', err);
    }
  };

  const handleRejectInvitation = async (invitationId: number) => {
    try {
      const token = typeof window !== 'undefined' ? localStorage.getItem('take_one_token') : null;
      const res = await fetch(`/api/community/invitations/${invitationId}/reject`, {
        method: 'POST',
        headers: {
          'Authorization': token ? `Bearer ${token}` : ''
        }
      });
      const data = await res.json();
      if (data.success) {
        alert('Invitation rejected.');
        await fetchMyInvitations();
      } else {
        alert(data.message || 'Failed to reject invitation');
      }
    } catch (err) {
      console.error('Error rejecting invitation:', err);
    }
  };

  const handleUserSearch = async (query: string) => {
    setUserSearchQuery(query);
    if (!query.trim()) {
      setUserSearchResults([]);
      return;
    }
    setUserSearchLoading(true);
    try {
      const token = typeof window !== 'undefined' ? localStorage.getItem('take_one_token') : null;
      const res = await fetch(`/api/users/search?q=${encodeURIComponent(query)}`, {
        headers: token ? { 'Authorization': `Bearer ${token}` } : {}
      });
      const data = await res.json();
      if (data.success) {
        setUserSearchResults(data.users || []);
      }
    } catch (err) {
      console.error('Error searching users:', err);
    } finally {
      setUserSearchLoading(false);
    }
  };

  const handleRemoveMember = async (memberUserId: number) => {
    if (!confirm('Are you sure you want to remove this member?')) return;
    try {
      const token = typeof window !== 'undefined' ? localStorage.getItem('take_one_token') : null;
      const res = await fetch(`/api/community/members/${memberUserId}`, {
        method: 'DELETE',
        headers: token ? { 'Authorization': `Bearer ${token}` } : {}
      });
      const data = await res.json();
      if (data.success) {
        alert('Member removed successfully');
        await fetchMyCommunity();
        await fetchDashboardStats();
      } else {
        alert(data.message || 'Failed to remove member');
      }
    } catch (err) {
      console.error(err);
      alert('Error removing member');
    }
  };

  const handleCreateCommunityGroup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newGroupName.trim()) return;
    setGroupLoading(true);
    try {
      const token = typeof window !== 'undefined' ? localStorage.getItem('take_one_token') : null;
      const res = await fetch('/api/community/groups', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': token ? `Bearer ${token}` : ''
        },
        body: JSON.stringify({ name: newGroupName })
      });
      const data = await res.json();
      if (data.success) {
        setNewGroupName('');
        setIsCreateGroupModalOpen(false);
        await fetchConversations();
        await fetchMyCommunity();
        await fetchDashboardStats();
      } else {
        alert(data.message || 'Failed to create group');
      }
    } catch (err) {
      console.error(err);
      alert('Error creating group');
    } finally {
      setGroupLoading(false);
    }
  };

  const handleDeleteCommunityGroup = async (groupId: number) => {
    if (!confirm('Are you sure you want to delete this group? This will delete all messages.')) return;
    try {
      const token = typeof window !== 'undefined' ? localStorage.getItem('take_one_token') : null;
      const res = await fetch(`/api/community/groups/${groupId}`, {
        method: 'DELETE',
        headers: token ? { 'Authorization': `Bearer ${token}` } : {}
      });
      const data = await res.json();
      if (data.success) {
        alert('Group deleted successfully');
        await fetchConversations();
        await fetchMyCommunity();
        await fetchDashboardStats();
      } else {
        alert(data.message || 'Failed to delete group');
      }
    } catch {
      alert('Error deleting group');
    }
  };

  const fetchCommunityPosts = useCallback(async () => {
    if (!communityDataRef.current?.id) return;
    setPostsLoading(true);
    try {
      const token = typeof window !== 'undefined' ? localStorage.getItem('take_one_token') : null;
      const res = await fetch(`/api/community/${communityDataRef.current.id}/posts`, {
        headers: token ? { 'Authorization': `Bearer ${token}` } : {}
      });
      const data = await res.json();
      if (data.success) {
        setCommunityPosts(data.data);
      }
    } catch (err) {
      console.error('Error fetching community posts:', err);
    } finally {
      setPostsLoading(false);
    }
  }, []);

  const handleCreatePost = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!communityData?.id) return;
    if (!postFiles || postFiles.length === 0) {
      alert('Please upload at least one image');
      return;
    }

    const formData = new FormData();
    formData.append('caption', postCaption);
    for (let i = 0; i < postFiles.length; i++) {
      formData.append('images', postFiles[i]);
    }

    try {
      const token = typeof window !== 'undefined' ? localStorage.getItem('take_one_token') : null;
      const res = await fetch(`/api/community/${communityData.id}/posts`, {
        method: 'POST',
        headers: token ? { 'Authorization': `Bearer ${token}` } : {},
        body: formData
      });
      const data = await res.json();
      if (data.success) {
        alert('Post created successfully!');
        setPostCaption('');
        setPostFiles(null);
        setIsCreatePostOpen(false);
        fetchCommunityPosts();
      } else {
        alert(data.message || 'Failed to create post');
      }
    } catch (err) {
      console.error('Error creating post:', err);
      alert('Error creating post');
    }
  };

  const handleLikePost = async (postId: number) => {
    if (!communityData?.id) return;
    try {
      const token = typeof window !== 'undefined' ? localStorage.getItem('take_one_token') : null;
      const res = await fetch(`/api/community/${communityData.id}/posts/${postId}/like`, {
        method: 'POST',
        headers: token ? { 'Authorization': `Bearer ${token}` } : {}
      });
      const data = await res.json();
      if (data.success) {
        // Toggle like locally
        setCommunityPosts(prev => prev.map(p => {
          if (p.id === postId) {
            const hasLiked = p.likes.some((l: any) => l.user_id === user?.id);
            const nextLikes = hasLiked 
              ? p.likes.filter((l: any) => l.user_id !== user?.id)
              : [...p.likes, { user_id: user?.id }];
            return { ...p, likes: nextLikes };
          }
          return p;
        }));
      }
    } catch (err) {
      console.error('Error liking post:', err);
    }
  };

  const handleAddComment = async (e: React.FormEvent, postId: number) => {
    e.preventDefault();
    if (!commentText.trim() || !communityData?.id) return;
    try {
      const token = typeof window !== 'undefined' ? localStorage.getItem('take_one_token') : null;
      const res = await fetch(`/api/community/${communityData.id}/posts/${postId}/comment`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {})
        },
        body: JSON.stringify({ content: commentText })
      });
      const data = await res.json();
      if (data.success) {
        setCommentText('');
        // Append comment locally
        setCommunityPosts(prev => prev.map(p => {
          if (p.id === postId) {
            return { ...p, comments: [...p.comments, data.data] };
          }
          return p;
        }));
      }
    } catch (err) {
      console.error('Error adding comment:', err);
    }
  };

  const handleDeletePost = async (postId: number) => {
    if (!confirm('Are you sure you want to delete this post?') || !communityData?.id) return;
    try {
      const token = typeof window !== 'undefined' ? localStorage.getItem('take_one_token') : null;
      const res = await fetch(`/api/community/${communityData.id}/posts/${postId}`, {
        method: 'DELETE',
        headers: token ? { 'Authorization': `Bearer ${token}` } : {}
      });
      const data = await res.json();
      if (data.success) {
        setCommunityPosts(prev => prev.filter(p => p.id !== postId));
      }
    } catch (err) {
      console.error('Error deleting post:', err);
    }
  };

  const handlePinPost = async (postId: number) => {
    if (!communityData?.id) return;
    try {
      const token = typeof window !== 'undefined' ? localStorage.getItem('take_one_token') : null;
      const res = await fetch(`/api/community/${communityData.id}/posts/${postId}/pin`, {
        method: 'POST',
        headers: token ? { 'Authorization': `Bearer ${token}` } : {}
      });
      const data = await res.json();
      if (data.success) {
        alert(data.message);
        fetchCommunityPosts();
      }
    } catch (err) {
      console.error('Error pinning post:', err);
    }
  };

  const handlePricingProceed = async () => {
    try {
      const token = typeof window !== 'undefined' ? localStorage.getItem('take_one_token') : null;
      const payload: any = { planType: selectedPlan };
      if (selectedPlan === 'Custom') {
        payload.memberCount = customMembersCount;
      }
      const res = await fetchWithCSRF('/api/community/create-order', {
        method: 'POST',
        headers: {
          'Authorization': token ? `Bearer ${token}` : ''
        },
        body: JSON.stringify(payload)
      });
      
      const json = await res.json();
      if (!res.ok || !json.success) {
        alert(json.message || 'Failed to create order');
        return;
      }

      if (json.is_founder) {
        // Founder role bypass payment verification
        try {
          const verifyRes = await fetchWithCSRF('/api/community/verify-payment', {
            method: 'POST',
            headers: {
              'Authorization': token ? `Bearer ${token}` : ''
            },
            body: JSON.stringify({
              razorpay_order_id: json.order.id,
              razorpay_payment_id: 'founder_bypass',
              razorpay_signature: 'founder_bypass'
            })
          });

          const verifyJson = await verifyRes.json();
          if (verifyJson.success) {
            setActiveOrderId(json.order.id);
            setCommunityCreationStep(2);
          } else {
            alert(verifyJson.message || 'Payment verification failed');
          }
        } catch (verifyErr: any) {
          console.error('Founder bypass verification error:', verifyErr);
          alert('Error performing Founder bypass verification.');
        }
        return;
      }

      // Normal user flow: load Razorpay
      const loaded = await loadRazorpayScript();
      if (!loaded) {
        alert('Razorpay SDK failed to load. Are you online?');
        return;
      }

      const options = {
        key: json.keyId,
        amount: json.order.amount,
        currency: json.order.currency,
        name: 'TAKE ONE',
        description: `Community Subscription - ${selectedPlan}`,
        order_id: json.order.id,
        handler: async function (response: any) {
          try {
            const verifyRes = await fetchWithCSRF('/api/community/verify-payment', {
              method: 'POST',
              headers: {
                'Authorization': token ? `Bearer ${token}` : ''
              },
              body: JSON.stringify({
                razorpay_order_id: response.razorpay_order_id,
                razorpay_payment_id: response.razorpay_payment_id,
                razorpay_signature: response.razorpay_signature
              })
            });

            const verifyJson = await verifyRes.json();
            if (verifyJson.success) {
              setActiveOrderId(json.order.id);
              setCommunityCreationStep(2);
            } else {
              alert(verifyJson.message || 'Payment verification failed');
            }
          } catch (verifyErr: any) {
            console.error('Verification error:', verifyErr);
            alert('Error verifying payment.');
          }
        },
        prefill: {
          name: user?.name || '',
          email: user?.email || ''
        },
        theme: {
          color: '#ff4d1a'
        }
      };

      const paymentObject = new (window as any).Razorpay(options);
      paymentObject.open();
    } catch (err) {
      console.error('Order initialization failed:', err);
      alert('Order initialization failed.');
    }
  };

  const handleInstantiateCommunity = async () => {
    if (!newCommunityName.trim()) {
      alert('Please enter a community name');
      return;
    }

    try {
      const token = typeof window !== 'undefined' ? localStorage.getItem('take_one_token') : null;
      const res = await fetchWithCSRF('/api/community/instantiate', {
        method: 'POST',
        headers: {
          'Authorization': token ? `Bearer ${token}` : ''
        },
        body: JSON.stringify({
          razorpay_order_id: activeOrderId,
          name: newCommunityName,
          description: newCommunityDesc
        })
      });

      const json = await res.json();
      if (json.success) {
        alert('Community established and launched!');
        setIsCommunityModalOpen(false);
        setCommunityCreationStep(1);
        setNewCommunityName('');
        setNewCommunityDesc('');
        setActiveOrderId(null);
        await fetchMyCommunity();
        setShowCommunityDashboard(true);
        await fetchDashboardStats();
      } else {
        alert(json.message || 'Failed to instantiate community.');
      }
    } catch (err) {
      console.error('Instantiation error:', err);
      alert('Error establishing community.');
    }
  };
  
  const handleFounderCreateCommunity = async () => {
    if (!newCommunityName.trim()) {
      alert('Please enter a community name');
      return;
    }
    setGroupLoading(true);
    try {
      const token = typeof window !== 'undefined' ? localStorage.getItem('take_one_token') : null;
      
      // Step 1: Create Order automatically on Custom plan with 1000 members for founder bypass
      const orderRes = await fetchWithCSRF('/api/community/create-order', {
        method: 'POST',
        headers: {
          'Authorization': token ? `Bearer ${token}` : ''
        },
        body: JSON.stringify({
          planType: 'Custom',
          memberCount: 1000
        })
      });
      
      const orderJson = await orderRes.json();
      if (!orderRes.ok || !orderJson.success) {
        alert(orderJson.message || 'Failed to initialize community setup.');
        setGroupLoading(false);
        return;
      }

      // Step 2: Verify Payment Bypass
      const verifyRes = await fetchWithCSRF('/api/community/verify-payment', {
        method: 'POST',
        headers: {
          'Authorization': token ? `Bearer ${token}` : ''
        },
        body: JSON.stringify({
          razorpay_order_id: orderJson.order.id,
          razorpay_payment_id: 'founder_bypass',
          razorpay_signature: 'founder_bypass'
        })
      });

      const verifyJson = await verifyRes.json();
      if (!verifyRes.ok || !verifyJson.success) {
        alert(verifyJson.message || 'Failed to verify founder bypass.');
        setGroupLoading(false);
        return;
      }

      // Step 3: Instantiate Community
      const instRes = await fetchWithCSRF('/api/community/instantiate', {
        method: 'POST',
        headers: {
          'Authorization': token ? `Bearer ${token}` : ''
        },
        body: JSON.stringify({
          razorpay_order_id: orderJson.order.id,
          name: newCommunityName,
          description: newCommunityDesc
        })
      });

      const instJson = await instRes.json();
      if (instJson.success) {
        alert('Community established and launched!');
        setIsCommunityModalOpen(false);
        setNewCommunityName('');
        setNewCommunityDesc('');
        await fetchMyCommunity();
        setShowCommunityDashboard(true);
        await fetchDashboardStats();
      } else {
        alert(instJson.message || 'Failed to establish community.');
      }
    } catch (err) {
      console.error('Founder community creation error:', err);
      alert('Error establishing community.');
    } finally {
      setGroupLoading(false);
    }
  };

  // Group messages by date
  const groupMessagesByDate = (msgs: ChatMessage[]) => {
    const groups: { [key: string]: ChatMessage[] } = {};
    msgs.forEach(msg => {
      const date = format(new Date(msg.created_at), 'yyyy-MM-dd');
      if (!groups[date]) groups[date] = [];
      groups[date].push(msg);
    });
    return groups;
  };

  const getFriendlyDate = (dateStr: string) => {
    const today = format(new Date(), 'yyyy-MM-dd');
    const yesterday = format(new Date(Date.now() - 86400000), 'yyyy-MM-dd');
    if (dateStr === today) return 'TODAY';
    if (dateStr === yesterday) return 'YESTERDAY';
    return format(new Date(dateStr), 'MMMM d, yyyy').toUpperCase();
  };


  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuBtnRef = useRef<HTMLButtonElement>(null);

  const scrollToBottom = (behavior: ScrollBehavior = 'smooth') => {
    messagesEndRef.current?.scrollIntoView({ behavior });
  };

  useEffect(() => {
    if (activeTab === 'chat' && !messageLoading) {
      scrollToBottom('auto');
    }
  }, [messages, activeTab, messageLoading]);
  const pusherRef = useRef<Pusher | null>(null);
  const pusherConfigRef = useRef<{key: string, cluster: string} | null>(null);
  const typingTimeoutRef = useRef<{[key: number]: NodeJS.Timeout}>({});

  const activeRecipient = useMemo(() => {
    if (!activeConv || !user) return null;
    const member = activeConv.users.find((member) => member.id !== user.id);
    if (!member && !activeConv.is_group) {
      return { id: -1, name: 'Deleted User', role: 'Unknown', gender: 'Other' };
    }
    return member || null;
  }, [activeConv, user]);

  const fetchMessages = useCallback(async (convId: number, beforeId: number | null = null) => {
    if (beforeId) setIsLoadingMore(true);
    else setMessageLoading(true);

    try {
      const token = typeof window !== 'undefined' ? localStorage.getItem('take_one_token') : null;
      const url = `/api/chat/messages/${convId}${beforeId ? `?before=${beforeId}` : ''}`;
      const res = await fetch(url, {
        credentials: 'include',
        headers: token ? { 'Authorization': `Bearer ${token}` } : {}
      });

      if (res.status === 401) {
        window.location.href = '/?auth=login';
        return;
      }

      const json = await res.json();

      if (!res.ok || !json.success) {
        setState(res.status === 403 || res.status === 404 ? 'not-found' : 'error');
        setStatusText(json.message || 'Signal lost. Could not load message history.');
        return;
      }

      if (beforeId) {
        setMessages(prev => [...(json.data || []), ...prev]);
      } else {
        setMessages(json.data || []);
      }

      setHasMore(json.hasMore ?? false);
      setState('ready');
      if (!beforeId) setTimeout(() => inputRef.current?.focus(), 100);
    } catch (err: any) {
      console.error('Failed to fetch messages', err);
      setState('error');
      setStatusText(err.message || 'The Community connection was interrupted.');
    } finally {
      setMessageLoading(false);
      setIsLoadingMore(false);
    }
  }, []);

  const fetchActiveOrder = useCallback(async () => {
    try {
      const token = localStorage.getItem('token');
      const response = await fetch('/api/services/orders', {
        headers: token ? { 'Authorization': `Bearer ${token}` } : {}
      });
      const payload = await response.json();
      if (payload.success && payload.data && payload.data.length > 0) {
        const active = payload.data.find((o: any) => o.project_status !== 'completed') || payload.data[0];
        setActiveOrder(active);
      } else {
        setActiveOrder(null);
      }
    } catch (err) {
      console.error('Failed to fetch active order:', err);
    }
  }, []);

  useEffect(() => {
    if (activeConv && activeRecipient?.email === 'system@takeone-nexus.net.in') {
      fetchActiveOrder();
    } else {
      setActiveOrder(null);
    }
  }, [activeConv, activeRecipient, fetchActiveOrder]);

  const handleAcceptOffer = useCallback(async (offer: any, selectedPlan: string) => {
    if (!confirm(`Are you sure you want to accept this proposal with the ${selectedPlan} maintenance plan?`)) return;
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`/api/services/offers/${offer.id}/status`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {})
        },
        body: JSON.stringify({ 
          status: 'accepted',
          selectedMaintenancePlan: selectedPlan
        })
      });
      const payload = await response.json();
      if (payload.success) {
        alert('Proposal accepted! Access the Project Tracker tab to complete your advance payment.');
        if (activeConv) fetchMessages(activeConv.id);
        fetchActiveOrder();
      } else {
        alert(payload.message || 'Failed to accept proposal');
      }
    } catch (err) {
      console.error(err);
      alert('An error occurred');
    }
  }, [activeConv, fetchMessages, fetchActiveOrder]);

  const handleOpenNegotiation = useCallback((offer: any) => {
    setNegotiatingOffer(offer);
    setIsNegotiateModalOpen(true);
  }, []);

  const getDisplayName = useCallback((u: User | null) => {
    if (!u) return 'Unnamed Creator';
    if (u.email === 'system@takeone-nexus.net.in') return 'Take One';
    const name = u.name || 'Anonymous Creator';
    const screenName = u.screen_name || '';
    const preference = u.display_preference || 'Real Name Only';
    
    if (preference === 'Screen Name Only' && screenName) return screenName;
    if (preference === 'Both' && screenName) return `${name} • ${screenName}`;
    return name;
  }, []);

  const getRecipient = useCallback((conv: Conversation) => {
    const member = conv.users.find((member) => member.id !== user?.id);
    if (!member && !conv.is_group) {
      return { id: -1, name: 'Deleted User', role: 'Unknown', gender: 'Other' } as User;
    }
    return member || conv.users[0];
  }, [user?.id]);

  const setActiveConversation = useCallback((conversation: Conversation, updateUrl = true) => {
    setActiveConv(conversation);
    setShowMobileSidebar(false);
    setMessages([]);
    setTasks([]);
    setActiveTab('chat');
    setDetailsTab('members');
    localStorage.setItem('take_one_last_conversation', String(conversation.id));

    // Clear unread for this conversation locally
    setConversations(prev => prev.map(c => c.id === conversation.id ? { ...c, unread: 0 } : c));

    if (updateUrl && typeof window !== 'undefined') {
      const url = `/chat?conversationId=${conversation.id}`;
      window.history.replaceState(null, '', url);
    }
  }, []);

  const fetchTasks = useCallback(async (convId: number) => {
    setTasksLoading(true);
    try {
      const token = typeof window !== 'undefined' ? localStorage.getItem('take_one_token') : null;
      const res = await fetch(`/api/tasks/${convId}`, {
        credentials: 'include',
        headers: token ? { 'Authorization': `Bearer ${token}` } : {}
      });
      const json = await res.json();
      if (json.success) {
        setTasks(json.data || []);
      }
    } catch (err) {
      console.error('Failed to fetch tasks', err);
    } finally {
      setTasksLoading(false);
    }
  }, []);

  const createTask = useCallback(async (taskData: any) => {
    try {
      const token = typeof window !== 'undefined' ? localStorage.getItem('take_one_token') : null;
      const res = await fetchWithCSRF('/api/tasks', {
        method: 'POST',
        headers: token ? { 'Authorization': `Bearer ${token}` } : {},
        body: JSON.stringify(taskData)
      });
      const json = await res.json();
      if (!json.success) {
        alert(json.message || 'Mission failed: Could not assign task.');
      }
    } catch (err) {
      console.error('Failed to create task', err);
    }
  }, []);

  const updateTaskStatus = useCallback(async (taskId: number, status: string) => {
    try {
      const token = typeof window !== 'undefined' ? localStorage.getItem('take_one_token') : null;
      await fetchWithCSRF(`/api/tasks/${taskId}`, {
        method: 'PATCH',
        headers: token ? { 'Authorization': `Bearer ${token}` } : {},
        body: JSON.stringify({ status })
      });
    } catch (err) {
      console.error('Failed to update task status', err);
    }
  }, []);

  const deleteTask = useCallback(async (taskId: number) => {
    if (!confirm('Are you sure you want to abort this mission?')) return;
    try {
      const token = typeof window !== 'undefined' ? localStorage.getItem('take_one_token') : null;
      await fetchWithCSRF(`/api/tasks/${taskId}`, {
        method: 'DELETE',
        headers: token ? { 'Authorization': `Bearer ${token}` } : {}
      });
    } catch (err) {
      console.error('Failed to delete task', err);
    }
  }, []);

  const approveTask = useCallback(async (taskId: number) => {
    try {
      const token = typeof window !== 'undefined' ? localStorage.getItem('take_one_token') : null;
      const res = await fetchWithCSRF(`/api/tasks/${taskId}/approve`, {
        method: 'POST',
        headers: token ? { 'Authorization': `Bearer ${token}` } : {}
      });
      const json = await res.json();
      if (!json.success) {
        alert(json.message || 'Mission failed: Could not approve task.');
      }
    } catch (err) {
      console.error('Failed to approve task', err);
    }
  }, []);

  const loadMoreMessages = useCallback(() => {
    if (hasMore && !isLoadingMore && activeConv && messages.length > 0) {
      const oldestId = typeof messages[0].id === 'number' ? messages[0].id : null;
      if (oldestId) fetchMessages(activeConv.id, oldestId);
    }
  }, [hasMore, isLoadingMore, activeConv, messages, fetchMessages]);


  const fetchConversations = useCallback(async () => {
    try {
      const token = typeof window !== 'undefined' ? localStorage.getItem('take_one_token') : null;
      const res = await fetch('/api/chat/conversations', {
        credentials: 'include',
        headers: token ? { 'Authorization': `Bearer ${token}` } : {}
      });

      if (res.status === 401) {
        window.location.href = '/?auth=login';
        return [];
      }

      const json = await res.json();

      if (!res.ok || !json.success) {
        throw new Error(json.message || 'Could not load conversations');
      }

      if (json.pusherKey && json.pusherCluster) {
        pusherConfigRef.current = { key: json.pusherKey, cluster: json.pusherCluster };
      }

      const loaded = json.data || [];
      setConversations(loaded);
      return loaded as Conversation[];
    } catch (err: any) {
      console.error('Fetch conversations failed:', err);
      throw new Error(err.message || 'The Community frequency is unstable. Please retry.');
    }
  }, []);

  const openDirectConversation = useCallback(async (recipientId: number) => {
    setState('loading');
    setStatusText('Opening direct transmission...');

    const token = typeof window !== 'undefined' ? localStorage.getItem('take_one_token') : null;
    const res = await fetchWithCSRF('/api/chat/conversations/direct', {
      method: 'POST',
      headers: token ? { 'Authorization': `Bearer ${token}` } : {},
      body: JSON.stringify({ recipientId })
    });

    if (res.status === 401) {
      window.location.href = '/?auth=login';
      return;
    }

    const json = await res.json();

    if (!res.ok || !json.success) {
      setState(res.status === 404 ? 'not-found' : 'error');
      setStatusText(json.message || 'Could not open that crew member.');
      return null;
    }

    const conversation = json.data as Conversation;
    setConversations((current) => {
      const withoutDuplicate = current.filter((item) => item.id !== conversation.id);
      return [{ ...conversation, unread: 0 }, ...withoutDuplicate];
    });
    setViewingGalaxyLanding(false);
    setShowCommunityDashboard(false);
    setActiveConversation(conversation);
    return conversation;
  }, [setActiveConversation]);

  const handleDeleteConversation = async (id: number) => {
    if (!confirm('Are you sure you want to delete this conversation? This will remove it from your signal desk.')) return;
    try {
      const token = typeof window !== 'undefined' ? localStorage.getItem('take_one_token') : null;
      const res = await fetchWithCSRF(`/api/chat/conversations/${id}`, { 
        method: 'DELETE',
        headers: token ? { 'Authorization': `Bearer ${token}` } : {}
      });
      if (res.status === 401) { window.location.href = '/?auth=login'; return; }
      if (res.ok) {
        setConversations(prev => prev.filter(c => c.id !== id));
        if (activeConv?.id === id) setActiveConv(null);
      }
    } catch (err) {
      console.error('Failed to delete conversation', err);
    }
  };

  const handleLeaveGroup = async (id: number) => {
    if (!confirm('Are you sure you want to leave this group?')) return;
    try {
      const token = typeof window !== 'undefined' ? localStorage.getItem('take_one_token') : null;
      const res = await fetchWithCSRF(`/api/chat/conversations/${id}/leave`, { 
        method: 'POST',
        headers: token ? { 'Authorization': `Bearer ${token}` } : {}
      });
      if (res.status === 401) { window.location.href = '/?auth=login'; return; }
      if (res.ok) {
        setConversations(prev => prev.filter(c => c.id !== id));
        if (activeConv?.id === id) setActiveConv(null);
        setShowDetails(false);
        setShowMenu(false);
      }
    } catch (err) {
      console.error('Failed to leave group', err);
    }
  };

  const handleClearChat = async (id: number) => {
    if (!confirm('Are you sure you want to clear all messages in this conversation? This will permanently delete messages for ALL participants. Only Directors and Admins can perform this action.')) return;
    try {
      const token = typeof window !== 'undefined' ? localStorage.getItem('take_one_token') : null;
      const res = await fetchWithCSRF(`/api/chat/conversations/${id}/clear`, { 
        method: 'POST',
        headers: token ? { 'Authorization': `Bearer ${token}` } : {}
      });
      if (res.status === 401) { window.location.href = '/?auth=login'; return; }
      if (res.ok) {
        setMessages([]);
        setShowMenu(false);
      } else {
        const json = await res.json();
        alert(json.message || 'Failed to clear chat');
      }
    } catch (err) {
      console.error('Failed to clear chat', err);
    }
  };

  const toggleMute = () => {
    if (!activeConv) return;
    setMutedConvIds(prev => {
      const next = new Set(prev);
      if (next.has(activeConv.id)) next.delete(activeConv.id);
      else next.add(activeConv.id);
      return next;
    });
    setShowMenu(false);
  };


  const handleTyping = (isTyping: boolean) => {
    if (!activeConv) return;
    const token = typeof window !== 'undefined' ? localStorage.getItem('take_one_token') : null;
    fetchWithCSRF('/api/chat/typing', {
      method: 'POST',
      headers: token ? { 'Authorization': `Bearer ${token}` } : {},
      body: JSON.stringify({ conversationId: activeConv.id, isTyping })
    }).catch(() => {});
  };

  const isTypingRef = useRef<{[key: number]: boolean}>({});

  const onInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setNewMessage(e.target.value);
    
    if (!activeConv) return;
    const convId = activeConv.id;

    // Throttle typing events: only send 'true' if we weren't already typing
    if (!isTypingRef.current[convId]) {
      isTypingRef.current[convId] = true;
      handleTyping(true);
    }
    
    if (typingTimeoutRef.current[convId]) {
      clearTimeout(typingTimeoutRef.current[convId]);
    }
    
    typingTimeoutRef.current[convId] = setTimeout(() => {
      handleTyping(false);
      isTypingRef.current[convId] = false;
    }, 2000);
  };

  const handleNavigateToCommunity = async (comm: any) => {
    setInCommunity(true);
    setCommunityData(comm);
    setCommunityRole(comm.role);
    setViewingGalaxyLanding(false);
    setShowCommunityDashboard(true);

    const token = typeof window !== 'undefined' ? localStorage.getItem('take_one_token') : null;
    try {
      const statsRes = await fetch(`/api/community/dashboard?communityId=${comm.id}`, {
        headers: token ? { 'Authorization': `Bearer ${token}` } : {}
      });
      const statsJson = await statsRes.json();
      if (statsJson.success) {
        setDashboardStats(statsJson.data);
      }
    } catch (err) {
      console.error('Error fetching dashboard stats:', err);
    }

    if (comm.groups && comm.groups.length > 0) {
      const generalGroup = comm.groups.find((g: any) => g.name.toLowerCase() === 'general') || comm.groups[0];
      const targetConv = conversations.find(c => c.id === generalGroup.conversation_id);
      if (targetConv) {
        setActiveConversation(targetConv);
        await fetchMessages(targetConv.id);
      } else {
        const loaded = await fetchConversations();
        const found = loaded.find(c => c.id === generalGroup.conversation_id);
        if (found) {
          setActiveConversation(found);
          await fetchMessages(found.id);
        }
      }
    }
  };

  useEffect(() => {
    const initialize = async () => {
      let currentUser: User | null = null;
      const storedUser = localStorage.getItem('take_one_user');

      if (storedUser) {
        try {
          currentUser = JSON.parse(storedUser);
          setUser(currentUser);
        } catch (err) {
          console.error('Failed to parse stored user', err);
        }
      }

      if (!currentUser) {
        try {
          const token = typeof window !== 'undefined' ? localStorage.getItem('take_one_token') : null;
          const res = await fetch('/api/users/me', { 
            credentials: 'include',
            headers: token ? { 'Authorization': `Bearer ${token}` } : {}
          });
          const json = await res.json();

          if (json.success && json.user) {
            currentUser = json.user;
            setUser(currentUser);
            localStorage.setItem('take_one_user', JSON.stringify(json.user));
          } else {
            window.location.href = '/?auth=login';
            return;
          }
        } catch (err) {
          console.error('Failed to fetch session user', err);
          window.location.href = '/?auth=login';
          return;
        }
      }

      try {
        const params = new URLSearchParams(window.location.search);
        const targetUserId = Number(params.get('userId') || params.get('user') || 0);
        const targetConversationId = Number(params.get('conversationId') || 0);
        const loadedConversations = await fetchConversations();
        await fetchMyCommunity();
        await fetchMyInvitations();
        await fetchAllCommunities();
        await fetchMyRequests();

        if (targetUserId) {
          const conversation = await openDirectConversation(targetUserId);
          if (conversation) await fetchMessages(conversation.id);
          return;
        }

        if (targetConversationId) {
          const selected = loadedConversations.find((conversation) => conversation.id === targetConversationId);
          if (!selected) {
            setState('not-found');
            setStatusText('Conversation not found or you do not have access.');
            return;
          }

          setActiveConversation(selected, false);
          await fetchMessages(selected.id);
          return;
        }

        if (loadedConversations.length > 0) {
          setActiveConversation(loadedConversations[0]);
          await fetchMessages(loadedConversations[0].id);
          return;
        }

        setState('ready');
      } catch (err: any) {
        console.error('Failed to initialize chat', err);
        setState('error');
        setStatusText(err.message || 'Signal Error: Could not synchronize with Community.');
      }
    };

    initialize();
  }, [fetchConversations, fetchMessages, openDirectConversation, setActiveConversation, fetchMyCommunity, fetchMyInvitations, fetchAllCommunities, fetchMyRequests]);

  // =========================================================================
  // FIX 1: DEDICATED PUSHER CLIENT CONNECTION DISPOSAL LIFECYCLE HOOK
  // Handles complete websocket disconnection on unmount, layout switches, or logouts.
  // =========================================================================
  useEffect(() => {
    return () => {
      if (pusherRef.current) {
        pusherRef.current.disconnect();
        pusherRef.current = null;
      }
    };
  }, [user?.id]); // Fires on explicit layout unmount or session invalidation (logout)

  // =========================================================================
  // FIX 2: REFACTORED USER CHANNEL SUBSCRIPTION (DETERMINISTIC CLEANUP)
  // =========================================================================
  useEffect(() => {
    const userId = user?.id;
    if (!userId) return;

    if (!pusherRef.current) {
      const pusherKey = pusherConfigRef.current?.key || process.env.NEXT_PUBLIC_PUSHER_KEY;
      const pusherCluster = pusherConfigRef.current?.cluster || process.env.NEXT_PUBLIC_PUSHER_CLUSTER;

      if (pusherKey && pusherCluster) {
        pusherRef.current = new Pusher(pusherKey, {
          cluster: pusherCluster,
          authorizer: (channel) => {
            return {
              authorize: (socketId, callback) => {
                const token = typeof window !== 'undefined' ? localStorage.getItem('take_one_token') : null;
                fetch('/api/chat/pusher/auth', {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json',
                    ...(token ? { 'Authorization': `Bearer ${token}` } : {})
                  },
                  body: JSON.stringify({
                    socket_id: socketId,
                    channel_name: channel.name
                  })
                })
                .then(response => response.json())
                .then(data => {
                  if (data.auth) {
                    callback(null, data);
                  } else {
                    callback(new Error(data.message || 'Authorization failed'), null);
                  }
                })
                .catch(err => {
                  callback(err, null);
                });
              }
            };
          }
        });
      }
    }

    if (!pusherRef.current) return;

    const userChannelName = `user-${userId}`;
    const userChannel = pusherRef.current.subscribe(userChannelName);

    // Named reference allocation to avoid handler replication
    const handleCreditUpdate = (data: { credits: number, change: number, reason: string }) => {
      setUser(prev => prev ? { ...prev, credits: data.credits } : null);
    };

    const handleMessageNotification = (data: any) => {
      const msg: ChatMessage = data.message || data;
      const convId = data.conversationId || msg.conversation_id;
      if (!msg || !convId) return;

      setConversations((current) => {
        const convIndex = current.findIndex((c) => c.id === convId);
        if (convIndex > -1) {
          const conv = current[convIndex];
          const isCurrentActive = activeConv?.id === convId;
          const updatedConv = { 
            ...conv, 
            messages: [msg], 
            unread: isCurrentActive ? 0 : (conv.unread || 0) + 1 
          };
          const newConvs = [...current];
          newConvs.splice(convIndex, 1);
          return [updatedConv, ...newConvs];
        } else {
          fetchConversations();
          return current;
        }
      });
    };

    const handleConversationUpdate = (updatedConv: any) => {
      setConversations(current => {
        const index = current.findIndex(c => c.id === updatedConv.id);
        if (index > -1) {
          const newConvs = [...current];
          newConvs[index] = {
            ...newConvs[index],
            ...updatedConv
          };
          return newConvs;
        }
        return current;
      });
      setActiveConv(current => {
        if (current && current.id === updatedConv.id) {
          return {
            ...current,
            ...updatedConv
          };
        }
        return current;
      });
    };

    const handleOrderUpdate = (data: any) => {
      setActiveOrder((prev: any) => {
        if (prev && prev.id === data.orderId) {
          return {
            ...prev,
            project_status: data.project_status,
            milestones: data.milestones
          };
        }
        return prev;
      });
      fetchActiveOrder();
    };

    // Binding reference listeners
    userChannel.bind('credit-update', handleCreditUpdate);
    userChannel.bind('message-notification', handleMessageNotification);
    userChannel.bind('conversation-update', handleConversationUpdate);
    userChannel.bind('order-update', handleOrderUpdate);

    // Strict explicit event teardown block
    return () => {
      userChannel.unbind('credit-update', handleCreditUpdate);
      userChannel.unbind('message-notification', handleMessageNotification);
      userChannel.unbind('conversation-update', handleConversationUpdate);
      userChannel.unbind('order-update', handleOrderUpdate);
      pusherRef.current?.unsubscribe(userChannelName);
    };
  }, [user?.id, activeConv?.id, fetchConversations, fetchActiveOrder]);

  // =========================================================================
  // FIX 3: REFACTORED CONVERSATION ACTIVE CHANNEL (DETERMINISTIC CLEANUP)
  // =========================================================================

  const attemptSendMessage = useCallback(async (tempId: string, content: string, conversationId: number) => {
    try {
      const token = typeof window !== 'undefined' ? localStorage.getItem('take_one_token') : null;
      const res = await fetchWithCSRF('/api/chat/messages', {
        method: 'POST',
        headers: token ? { 'Authorization': `Bearer ${token}` } : {},
        body: JSON.stringify({
          conversationId,
          content,
          tempId
        })
      });

      if (res.status === 401) {
        window.location.href = '/?auth=login';
        return;
      }

      const json = await res.json();

      if (!res.ok || !json.success) {
        // Permanent error (auth, validation) - mark as failed
        if (res.status === 401 || res.status === 403 || res.status === 400) {
          setMessages(prev => prev.map(m => m.id === tempId ? { ...m, status: 'failed' } : m));
          removeFromQueue(tempId);
          setStatusText(json.message || 'Message failed to send.');
          return;
        }
        
        // Transient error - schedule retry
        scheduleRetry(tempId, 0);
        setMessages(prev => prev.map(m => m.id === tempId ? { ...m, status: 'failed' } : m));
        setStatusText(json.message || 'Message send failed. Retrying...');
        return;
      }

      // Success - remove from queue and mark as sent
      setMessages(prev => prev.map(m => m.id === tempId ? { ...json.data, status: 'sent' } : m));
      removeFromQueue(tempId);
      
      setConversations((current) => {
        const index = current.findIndex(c => c.id === json.data.conversation_id);
        if (index === -1) return current;
        const updated = { ...current[index], messages: [json.data] };
        const next = [...current];
        next.splice(index, 1);
        return [updated, ...next];
      });
      setTimeout(() => inputRef.current?.focus(), 100);
    } catch (err) {
      console.error('[MESSAGE] Failed to send message', err);
      // Network error - schedule retry
      scheduleRetry(tempId, 0);
      setMessages(prev => prev.map(m => m.id === tempId ? { ...m, status: 'failed' } : m));
      setStatusText('Network error. Message will be retried.');
    } finally {
      setSending(false);
    }
  }, [removeFromQueue, scheduleRetry, setMessages, setConversations, setSending, setStatusText]);

  const processMessageQueue = useCallback(async () => {
    if (isProcessing() || pusherConnectionState !== 'connected') return;
    
    setProcessing(true);
    
    try {
      let nextMessage = getNextMessageToRetry();
      
      while (nextMessage) {
        const msg = nextMessage;
        updateMessageStatus(msg.tempId, 'sending');
        setMessages(prev => prev.map(m => 
          m.id === msg.tempId ? { ...m, status: 'sending' } : m
        ));
        
        try {
          const token = typeof window !== 'undefined' ? localStorage.getItem('take_one_token') : null;
          const res = await fetchWithCSRF('/api/chat/messages', {
            method: 'POST',
            headers: token ? { 'Authorization': `Bearer ${token}` } : {},
            body: JSON.stringify({
              conversationId: msg.conversationId,
              content: msg.content,
              tempId: msg.tempId
            })
          });

          const json = await res.json();

          if (res.ok && json.success) {
            // Success
            setMessages(prev => prev.map(m => 
              m.id === msg.tempId ? { ...json.data, status: 'sent' } : m
            ));
            removeFromQueue(msg.tempId);
            
            setConversations((current) => {
              const index = current.findIndex(c => c.id === json.data.conversation_id);
              if (index === -1) return current;
              const updated = { ...current[index], messages: [json.data] };
              const next = [...current];
              next.splice(index, 1);
              return [updated, ...next];
            });
          } else if (res.status === 401 || res.status === 403 || res.status === 400) {
            // Permanent error
            setMessages(prev => prev.map(m => 
              m.id === msg.tempId ? { ...m, status: 'failed' } : m
            ));
            removeFromQueue(msg.tempId);
            break; // Stop processing on auth error
          } else {
            // Transient error
            scheduleRetry(msg.tempId, msg.retryCount + 1);
            if (msg.retryCount >= 4) {
              setMessages(prev => prev.map(m => 
                m.id === msg.tempId ? { ...m, status: 'failed' } : m
              ));
              break; // Max retries reached
            }
          }
        } catch (err) {
          console.error('[QUEUE] Error processing message:', err);
          scheduleRetry(msg.tempId, msg.retryCount + 1);
          if (msg.retryCount >= 4) {
            setMessages(prev => prev.map(m => 
              m.id === msg.tempId ? { ...m, status: 'failed' } : m
            ));
            break;
          }
        }
        
        // Get next message to retry
        nextMessage = getNextMessageToRetry();
        
        // Small delay between retries
        if (nextMessage) {
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      }
    } finally {
      setProcessing(false);
    }
  }, [isProcessing, pusherConnectionState, getNextMessageToRetry, updateMessageStatus, removeFromQueue, scheduleRetry, setMessages, setConversations, setProcessing]);

  // Monitor Pusher connection state and process queue on reconnection
  useEffect(() => {
    if (!pusherRef.current) return;
    
    const handleConnectionStateChange = (state: any) => {
      const newState: PusherConnectionState = state.current;
      setPusherConnectionState(newState);
      
      if (newState === 'connected') {
        processMessageQueue();
      }
    };
    
    pusherRef.current.connection.bind('state_change', handleConnectionStateChange);
    
    const currentState = pusherRef.current.connection.state as PusherConnectionState;
    setPusherConnectionState(currentState);
    
    return () => {
      pusherRef.current?.connection.unbind('state_change', handleConnectionStateChange);
    };
  }, [processMessageQueue]); // Added processMessageQueue safely here
  useEffect(() => {
    if (!activeConv) return;

    if (!pusherRef.current) {
      const pusherKey = pusherConfigRef.current?.key || process.env.NEXT_PUBLIC_PUSHER_KEY;
      const pusherCluster = pusherConfigRef.current?.cluster || process.env.NEXT_PUBLIC_PUSHER_CLUSTER;

      if (pusherKey && pusherCluster) {
        pusherRef.current = new Pusher(pusherKey, {
          cluster: pusherCluster,
          authorizer: (channel) => {
            return {
              authorize: (socketId, callback) => {
                const token = typeof window !== 'undefined' ? localStorage.getItem('take_one_token') : null;
                fetch('/api/chat/pusher/auth', {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json',
                    ...(token ? { 'Authorization': `Bearer ${token}` } : {})
                  },
                  body: JSON.stringify({
                    socket_id: socketId,
                    channel_name: channel.name
                  })
                })
                .then(response => response.json())
                .then(data => {
                  if (data.auth) {
                    callback(null, data);
                  } else {
                    callback(new Error(data.message || 'Authorization failed'), null);
                  }
                })
                .catch(err => {
                  callback(err, null);
                });
              }
            };
          }
        });
      }
    }

    if (!pusherRef.current) return;

    const channelName = `conversation-${activeConv.id}`;
    const channel = pusherRef.current.subscribe(channelName);

    // Named handlers to allow precise runtime stack unbinding
    const handleNewMessage = (data: any) => {
      const msg: ChatMessage = data.message || data;
      if (!msg || !msg.conversation_id) return;

      if (activeConv.id === msg.conversation_id) {
        setMessages((prev) => {
          // Check if message already exists by ID
          if (prev.find((message) => message.id === msg.id)) return prev;
          
          // Check if this is a reply to a queued message (match by tempId)
          if (msg.tempId) {
            return prev.map(m => 
              m.id === msg.tempId || m.tempId === msg.tempId
                ? { ...msg, status: 'sent' }
                : m
            );
          }
          
          return [...prev, msg];
        });
      }
      
      setConversations((current) => {
        const convIndex = current.findIndex((c) => c.id === msg.conversation_id);
        if (convIndex > -1) {
          const conv = current[convIndex];
          const updatedConv = { 
            ...conv, 
            messages: [msg],
            unread: activeConv.id === conv.id ? 0 : (conv.unread || 0) + 1
          };
          const newConvs = [...current];
          newConvs.splice(convIndex, 1);
          return [updatedConv, ...newConvs];
        }
        return current;
      });
    };

    const handleUserTyping = (data: { userId: number, userName: string, isTyping: boolean }) => {
      if (data.userId === user?.id) return;
      setTypingUsers(prev => {
        const next = { ...prev };
        if (data.isTyping) next[data.userId] = data.userName;
        else delete next[data.userId];
        return next;
      });
    };

    const handleTaskUpdate = (data: { type: string, task: Task, taskId?: number }) => {
      if (data.type === 'TASK_CREATED') {
        setTasks(prev => [data.task, ...prev]);
      } else if (data.type === 'TASK_UPDATED' || data.type === 'TASK_APPROVED') {
        setTasks(prev => prev.map(t => t.id === data.task.id ? data.task : t));
      } else if (data.type === 'TASK_DELETED') {
        setTasks(prev => prev.filter(t => t.id !== data.taskId));
      }
    };

    const handleSettingsUpdated = (data: { conversationId: number, canMembersMessage: boolean, conversation?: any }) => {
      setActiveConv(prev => {
        if (prev && prev.id === data.conversationId) {
          return { ...prev, canMembersMessage: data.canMembersMessage, ...(data.conversation || {}) };
        }
        return prev;
      });
      setConversations(prev => prev.map(c => {
        if (c.id === data.conversationId) {
          return { ...c, canMembersMessage: data.canMembersMessage, ...(data.conversation || {}) };
        }
        return c;
      }));
    };

    // Binding reference handlers
    channel.bind('new-message', handleNewMessage);
    channel.bind('user-typing', handleUserTyping);
    channel.bind('task-update', handleTaskUpdate);
    channel.bind('settings-updated', handleSettingsUpdated);

    // Explicit channel and handler teardown phase
    return () => {
      channel.unbind('new-message', handleNewMessage);
      channel.unbind('user-typing', handleUserTyping);
      channel.unbind('task-update', handleTaskUpdate);
      channel.unbind('settings-updated', handleSettingsUpdated);
      pusherRef.current?.unsubscribe(channelName);
    };
  }, [activeConv, user?.id]);
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, messageLoading]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setShowSearch(false);
        setShowMenu(false);
        setShowDetails(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    const timeouts = typingTimeoutRef.current;
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      // Clean up all typing timeouts
      Object.values(timeouts).forEach(timeout => clearTimeout(timeout));
    };
  }, []);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (!showMenu) return;
      const target = e.target as Node;
      if (menuRef.current?.contains(target)) return;
      if (menuBtnRef.current?.contains(target)) return;
      setShowMenu(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showMenu]);

  useEffect(() => {
    if (state === 'ready' && activeConv) {

      inputRef.current?.focus();
    }
  }, [activeConv, state]);

  const sendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMessage.trim() || !activeConv || sending || !user) return;

    const content = newMessage.trim();
    const tempId = crypto.randomUUID();
    
    const optimisticMessage: ChatMessage = {
      id: tempId,
      conversation_id: activeConv.id,
      sender_id: user.id,
      content,
      created_at: new Date().toISOString(),
      sender: user,
      status: pusherConnectionState === 'connected' ? 'sending' : 'pending',
      tempId
    };

    setNewMessage('');
    setMessages(prev => [...prev, optimisticMessage]);
    setSending(true);
    
    const queuedMessage: QueuedMessage = {
      tempId,
      content,
      conversationId: activeConv.id,
      senderId: user.id,
      createdAt: new Date().toISOString(),
      status: pusherConnectionState === 'connected' ? 'sending' : 'pending',
      retryCount: 0,
      nextRetryAt: Date.now()
    };

    // Add to queue
    addToQueue(queuedMessage);

    // If connected, attempt send immediately; otherwise mark as pending
    if (pusherConnectionState === 'connected') {
      await attemptSendMessage(tempId, content, activeConv.id);
    } else {
      updateMessageStatus(tempId, 'pending');
      setSending(false);
      setStatusText('Message queued. Will send when connection is restored.');
    }
  };

  // Periodic retry check for queued messages
  useEffect(() => {
    if (!user?.id || pusherConnectionState !== 'connected' || messageLoading) return;
    
    const interval = setInterval(() => {
      if (messageLoading) return;
      const nextMessage = getNextMessageToRetry();
      if (nextMessage) {
        processMessageQueue();
      }
    }, 2000); // Check every 2 seconds
    
    return () => clearInterval(interval);
  }, [user?.id, pusherConnectionState, getNextMessageToRetry, processMessageQueue, messageLoading]);

  if (state === 'loading') return <div className="chat-loading">{statusText}</div>;

  return (
    <div className="chat-page">
      <header className="global-header">
        <a href="/" className="logo">TAKE <span>ONE</span></a>
        <nav>
          <a href="/#explore">Discover Projects</a>
          <a href="/crew">Find Crew</a>
          <a href="/leaderboard">Leaderboard</a>
          <a href="/chat" className="active">Community</a>
          {(!user?.role || ['director', 'writer', 'producer'].includes(user.role.toLowerCase())) ? (
            <a href="/#upload">Share Your Script</a>
          ) : (
            <a href="/#explore">Workspace</a>
          )}
          <a href="/profile">Profile</a>
          {user?.secondary_role && ['admin', 'founder'].includes(user.secondary_role.toLowerCase()) && (
            <a href="https://admin.takeone-nexus.net.in" style={{ color: 'var(--neon)', fontWeight: 'bold' }}>Admin Panel</a>
          )}
          <button onClick={() => window.location.href = '/profile'} className="nav-cta">
            My Signal
          </button>
        </nav>
      </header>

      <div className="chat-container">
        {/* Community Switcher Rail */}
        <div className="community-rail">
          {/* Community Global Icon */}
          <div className={`rail-item-wrapper ${!inCommunity && !viewingGalaxyLanding ? 'active' : ''}`}>
            <div className="rail-pill" />
            <button 
              className="rail-item" 
              onClick={() => {
                setInCommunity(false);
                setViewingGalaxyLanding(false);
                setShowCommunityDashboard(false);
              }}
              title="Community Global Chat"
            >
              N
            </button>
          </div>

          <div className="rail-separator" />

          {/* User's joined communities */}
          {myCommunities.map((comm) => {
            const isActive = inCommunity && communityData?.id === comm.id && !viewingGalaxyLanding;
            const initials = comm.name.charAt(0).toUpperCase();
            return (
              <div key={comm.id} className={`rail-item-wrapper ${isActive ? 'active' : ''}`}>
                <div className="rail-pill" />
                <button 
                  className="rail-item" 
                  onClick={() => handleNavigateToCommunity(comm)}
                  title={comm.name}
                >
                  {comm.logo_url ? (
                    <img src={cacheBustUrl(comm.logo_url, comm.updated_at)} alt={comm.name} />
                  ) : (
                    initials
                  )}
                </button>
              </div>
            );
          })}

          <div className="rail-separator" />

          {/* Galaxy Landing / Find Communities Button */}
          <div className={`rail-item-wrapper ${viewingGalaxyLanding ? 'active' : ''}`}>
            <div className="rail-pill" />
            <button 
              className="rail-item" 
              onClick={() => {
                setViewingGalaxyLanding(true);
                fetchAllCommunities(communitySearchQuery);
              }}
              style={{ fontSize: '20px' }}
              title="Explore Galaxy Communities"
            >
              🌌
            </button>
          </div>

          {/* My Requests Dashboard Button */}
          <div className="rail-item-wrapper">
            <button 
              className="rail-item" 
              onClick={() => {
                fetchMyRequests();
                setIsJoinRequestModalOpen(true);
              }}
              style={{ fontSize: '20px' }}
              title="My Community Requests"
            >
              📋
            </button>
          </div>
        </div>

        <aside
  className={`chat-sidebar ${
    !showMobileSidebar ? 'mobile-hidden' : ''
  }`}
>
          <div className="sidebar-header">
            <div className="sidebar-title-row">
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <h2>NEXUS</h2>
                <div 
                  className={`connection-indicator ${pusherConnectionState}`}
                  title={`Community Connection: ${pusherConnectionState}`}
                  style={{
                    width: '8px',
                    height: '8px',
                    borderRadius: '50%',
                    background: pusherConnectionState === 'connected' ? '#00ff88' : pusherConnectionState === 'connecting' ? '#ffa620' : '#ff3232',
                    boxShadow: pusherConnectionState === 'connected' 
                      ? '0 0 8px #00ff88' 
                      : pusherConnectionState === 'connecting' 
                        ? '0 0 8px #ffa620' 
                        : '0 0 8px #ff3232',
                    transition: 'all 0.3s ease',
                    animation: pusherConnectionState === 'connecting' ? 'pulse-opacity 1.5s infinite' : 'none'
                  }}
                />
              </div>
              <div style={{ display: 'flex', gap: '6px' }}>
                <button onClick={() => setIsGroupModalOpen(true)} className="nav-cta group-add-btn" aria-label="Create Group" title="Create Group">+</button>
              </div>
            </div>

            <div className="sidebar-tabs" style={{ display: 'flex', borderBottom: '1px solid rgba(255, 255, 255, 0.1)', marginTop: '12px', marginBottom: '8px' }}>
              <button 
                onClick={() => { 
                  setViewingGalaxyLanding(false); 
                  setShowCommunityDashboard(false); 
                }} 
                className={`tab-btn ${!viewingGalaxyLanding && !showCommunityDashboard ? 'active' : ''}`}
                style={{ flex: 1, padding: '8px', background: (!viewingGalaxyLanding && !showCommunityDashboard) ? 'rgba(255,77,26,0.1)' : 'transparent', border: 'none', color: '#fff', borderBottom: (!viewingGalaxyLanding && !showCommunityDashboard) ? '2px solid var(--neon)' : 'none', cursor: 'pointer', fontSize: '13px', fontWeight: 'bold' }}
              >
                Chats
              </button>
              <button 
                onClick={() => {
                  const targetState = !viewingGalaxyLanding;
                  setViewingGalaxyLanding(targetState);
                  setShowCommunityDashboard(false);
                  if (targetState) {
                    fetchAllCommunities(communitySearchQuery);
                  }
                }} 
                className={`tab-btn ${viewingGalaxyLanding ? 'active' : ''}`}
                style={{ flex: 1, padding: '8px', background: viewingGalaxyLanding ? 'rgba(255,77,26,0.1)' : 'transparent', border: 'none', color: '#fff', borderBottom: viewingGalaxyLanding ? '2px solid var(--neon)' : 'none', cursor: 'pointer', fontSize: '13px', fontWeight: 'bold' }}
              >
                Community
              </button>
            </div>

            {!showCommunityDashboard && (
              <div className="sidebar-search-wrap">
                <svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" strokeWidth="2" fill="none"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
                <input 
                  type="text" 
                  className="sidebar-search-input" 
                  placeholder="Search Community..." 
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
              </div>
            )}
          </div>
          
          {showCommunityDashboard ? (
            <div className="conversation-list community-sidebar-view" style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '16px', overflowY: 'auto', height: 'calc(100% - 130px)' }}>
              {inCommunity && communityData ? (
                <>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '8px', borderBottom: '1px solid rgba(255, 255, 255, 0.1)', paddingBottom: '12px' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', marginTop: '4px' }}>
                      <AvatarUploader
                        type="community"
                        targetId={communityData.id}
                        currentUrl={communityData.logo_url}
                        isAdmin={['Owner', 'Moderator'].includes(communityRole || '')}
                        size={64}
                        shape="rounded"
                        onSuccess={async (newUrl) => {
                          await fetchMyCommunity();
                          // Update myCommunities list state as well
                          setMyCommunities(prev => prev.map(c => c.id === communityData.id ? { ...c, logo_url: newUrl } : c));
                        }}
                      />
                    </div>
                  </div>

                  {myCommunities.length > 1 && (
                    <div style={{ marginBottom: '12px' }}>
                      <label style={{ fontSize: '10px', color: '#888', display: 'block', marginBottom: '4px' }}>Active Community</label>
                      <select 
                        value={communityData.id} 
                        onChange={async (e) => {
                          const selectedId = Number(e.target.value);
                          const found = myCommunities.find(c => c.id === selectedId);
                          if (found) {
                            setCommunityData(found);
                            setCommunityRole(found.role);
                            const token = typeof window !== 'undefined' ? localStorage.getItem('take_one_token') : null;
                            const statsRes = await fetch(`/api/community/dashboard?communityId=${selectedId}`, {
                              headers: token ? { 'Authorization': `Bearer ${token}` } : {}
                            });
                            const statsJson = await statsRes.json();
                            if (statsJson.success) {
                              setDashboardStats(statsJson.data);
                            }
                          }
                        }}
                        style={{ width: '100%', padding: '6px', background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '4px', color: '#fff', fontSize: '12px' }}
                      >
                        {myCommunities.map(c => (
                          <option key={c.id} value={c.id}>{c.name}</option>
                        ))}
                      </select>
                    </div>
                  )}

                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                      <h4 style={{ margin: 0, fontSize: '11px', textTransform: 'uppercase', letterSpacing: '1px', color: '#888', fontWeight: 'bold' }}>Groups ({communityData.groups?.length || 0})</h4>
                      {['Owner', 'Moderator'].includes(communityRole || '') && (
                        <button 
                          onClick={() => setIsCreateGroupModalOpen(true)} 
                          style={{ background: 'transparent', border: 'none', color: 'var(--neon)', fontSize: '18px', cursor: 'pointer', padding: '0 4px', lineHeight: 1 }}
                          title="Create Group"
                        >
                          +
                        </button>
                      )}
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                      {communityData.groups?.map((group: any) => (
                        <div 
                          key={group.id}
                          style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 10px', borderRadius: '6px', background: activeConv?.id === group.conversation_id ? 'rgba(255,77,26,0.12)' : 'rgba(255,255,255,0.02)', cursor: 'pointer', transition: 'background 0.2s' }}
                          onClick={() => {
                            const targetConv = conversations.find(c => c.id === group.conversation_id);
                            if (targetConv) {
                              setActiveConversation(targetConv);
                              fetchMessages(targetConv.id);
                            } else {
                              fetchConversations().then(loaded => {
                                const found = loaded.find(c => c.id === group.conversation_id);
                                if (found) {
                                  setActiveConversation(found);
                                  fetchMessages(found.id);
                                } else {
                                  alert("You do not have access to this group.");
                                }
                              });
                            }
                          }}
                        >
                          <span style={{ fontSize: '13px', fontWeight: activeConv?.id === group.conversation_id ? 'bold' : 'normal', color: activeConv?.id === group.conversation_id ? 'var(--neon)' : '#ccc' }}>
                            # {group.name}
                          </span>
                          {['Owner', 'Moderator'].includes(communityRole || '') && group.name !== 'General' && (
                            <button 
                              onClick={(e) => {
                                e.stopPropagation();
                                handleDeleteCommunityGroup(group.id);
                              }}
                              style={{ background: 'transparent', border: 'none', color: '#ff3333', fontSize: '11px', cursor: 'pointer', opacity: 0.7 }}
                              title="Delete Group"
                            >
                              ✕
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>

                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                      <h4 style={{ margin: 0, fontSize: '11px', textTransform: 'uppercase', letterSpacing: '1px', color: '#888', fontWeight: 'bold' }}>Members ({communityData.members?.length || 0})</h4>
                      {['Owner', 'Moderator'].includes(communityRole || '') && (
                        <div style={{ display: 'flex', gap: '8px' }}>
                          <button 
                            onClick={() => {
                              fetchCommunityInvitations();
                              setIsInvitationsManagementModalOpen(true);
                            }} 
                            style={{ background: 'transparent', border: 'none', color: 'var(--cream)', fontSize: '11px', cursor: 'pointer', fontWeight: 'bold' }}
                          >
                            Manage
                          </button>
                          <button 
                            onClick={() => setIsInviteModalOpen(true)} 
                            style={{ background: 'transparent', border: 'none', color: 'var(--neon)', fontSize: '11px', cursor: 'pointer', fontWeight: 'bold' }}
                          >
                            Invite
                          </button>
                        </div>
                      )}
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                      {communityData.members?.map((member: any) => (
                        <div 
                          key={member.id}
                          style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 8px', borderRadius: '4px', background: 'rgba(255,255,255,0.01)' }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
                            <img 
                              src={getAvatarUrl(member.user?.name || 'User', member.user?.gender || 'Other', member.user?.avatar_url)} 
                              alt="" 
                              style={{ width: '22px', height: '22px', borderRadius: '50%', flexShrink: 0 }}
                            />
                            <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                              <span style={{ fontSize: '12px', fontWeight: 'bold', color: '#eee', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{member.user?.name}</span>
                              <span style={{ fontSize: '9px', color: member.role === 'Owner' ? 'var(--neon)' : '#999' }}>{member.role}</span>
                            </div>
                          </div>
                          {['Owner', 'Moderator'].includes(communityRole || '') && member.user_id !== user?.id && (
                            !(communityRole === 'Moderator' && ['Owner', 'Moderator'].includes(member.role)) && (
                              <button 
                                onClick={() => handleRemoveMember(member.user_id)}
                                style={{ background: 'transparent', border: 'none', color: '#ff4d4d', fontSize: '10px', cursor: 'pointer', fontWeight: 'bold' }}
                                title="Remove from Community"
                              >
                                Kick
                              </button>
                            )
                          )}
                        </div>
                      ))}
                    </div>
                  </div>

                  {['Owner', 'Moderator'].includes(communityRole || '') && (
                    <div style={{ borderTop: '1px solid rgba(255,255,255,0.1)', paddingTop: '12px', marginTop: 'auto' }}>
                      <div style={{ background: 'rgba(255,77,26,0.03)', border: '1px solid rgba(255,77,26,0.15)', padding: '10px', borderRadius: '6px', fontSize: '11px', color: '#ccc' }}>
                        <div style={{ fontWeight: 'bold', color: 'var(--neon)', marginBottom: '4px', fontSize: '12px' }}>Dashboard: {dashboardStats?.planType || 'Owner'}</div>
                        <div style={{ marginBottom: '2px' }}>Members: <strong>{dashboardStats?.memberCount || 0} / {dashboardStats?.max_members || 0}</strong></div>
                        <div>Groups: <strong>{dashboardStats?.groupCount || 0} / 50</strong></div>
                      </div>
                    </div>
                  )}

                  <div style={{ borderTop: '1px solid rgba(255,255,255,0.1)', paddingTop: '12px', marginTop: dashboardStats ? '12px' : 'auto' }}>
                    <button 
                      onClick={() => {
                        if (!isFounder) {
                          fetchPricingConfigs();
                        }
                        setIsCommunityModalOpen(true);
                      }}
                      style={{ width: '100%', background: 'transparent', border: '1px dashed rgba(255,77,26,0.4)', color: 'var(--neon)', padding: '8px', borderRadius: '6px', fontSize: '11px', fontWeight: 'bold', cursor: 'pointer' }}
                    >
                      + Create Another Community
                    </button>
                  </div>
                </>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', height: '100%', justifyContent: 'center', alignItems: 'center', textAlign: 'center', padding: '20px 0' }}>
                  <div style={{ width: '64px', height: '64px', borderRadius: '50%', background: 'rgba(255,77,26,0.05)', border: '1px solid rgba(255,77,26,0.2)', display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
                    <svg viewBox="0 0 24 24" width="28" height="28" stroke="var(--neon)" strokeWidth="2" fill="none"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M23 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path></svg>
                  </div>
                  <div>
                    <h3 style={{ margin: '0 0 8px 0', fontSize: '16px', color: 'var(--neon)' }}>No Community Yet</h3>
                    <p style={{ margin: 0, fontSize: '12px', color: '#888', lineHeight: '1.5' }}>Launch a community to host custom groups, invite crew, and collaborate on scripts.</p>
                  </div>
                  <button 
                    onClick={() => {
                      if (!isFounder) {
                        fetchPricingConfigs();
                      }
                      setIsCommunityModalOpen(true);
                    }}
                    style={{ background: 'var(--neon)', border: 'none', padding: '10px 20px', borderRadius: '6px', color: '#fff', fontWeight: 'bold', fontSize: '13px', cursor: 'pointer' }}
                  >
                    Launch Community
                  </button>
                </div>
              )}

              {myInvitations.length > 0 && (
                <div style={{ borderTop: '1px solid rgba(255, 255, 255, 0.1)', paddingTop: '16px', marginTop: '12px' }}>
                  <h4 style={{ margin: '0 0 10px 0', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '1px', color: '#888', fontWeight: 'bold' }}>Pending Invitations ({myInvitations.length})</h4>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {myInvitations.map((inv: any) => (
                      <div 
                        key={inv.id} 
                        style={{ 
                          padding: '10px', 
                          background: 'rgba(255,77,26,0.03)', 
                          border: '1px solid rgba(255,77,26,0.15)', 
                          borderRadius: '8px',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '8px'
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          {inv.community.logo_url ? (
                            <img src={cacheBustUrl(inv.community.logo_url, inv.community.updated_at)} alt="" style={{ width: '28px', height: '28px', borderRadius: '4px', objectFit: 'cover' }} />
                          ) : (
                            <div style={{ width: '28px', height: '28px', borderRadius: '4px', background: 'rgba(255,255,255,0.05)', display: 'flex', justifyContent: 'center', alignItems: 'center', fontSize: '11px', fontWeight: 'bold', color: 'var(--neon)' }}>
                              {inv.community.name.charAt(0).toUpperCase()}
                            </div>
                          )}
                          <div style={{ minWidth: 0, flex: 1 }}>
                            <div style={{ fontSize: '12px', fontWeight: 'bold', color: '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{inv.community.name}</div>
                            <div style={{ fontSize: '10px', color: '#888' }}>Invited by {inv.inviter?.name || 'Owner'}</div>
                          </div>
                        </div>
                        <div style={{ display: 'flex', gap: '6px' }}>
                          <button 
                            onClick={() => handleAcceptInvitation(inv.id)}
                            style={{ flex: 1, background: 'var(--neon)', border: 'none', padding: '4px', borderRadius: '4px', color: '#fff', fontSize: '11px', fontWeight: 'bold', cursor: 'pointer' }}
                          >
                            Accept
                          </button>
                          <button 
                            onClick={() => handleRejectInvitation(inv.id)}
                            style={{ flex: 1, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', padding: '4px', borderRadius: '4px', color: '#ccc', fontSize: '11px', cursor: 'pointer' }}
                          >
                            Decline
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="conversation-list">
            {conversations
              .filter(c => {
                const recipient = getRecipient(c);
                const name = c.is_group ? c.name : getDisplayName(recipient);
                return name?.toLowerCase().includes(searchQuery.toLowerCase());
              })
              .map((conv) => {
                const recipient = getRecipient(conv);
                const lastMsg = conv.messages[0]?.content || 'No messages yet';
                const lastTime = conv.messages[0] ? new Date(conv.messages[0].created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
                
                return (
                  <button
                    key={conv.id}
                    type="button"
                    className={`conversation-item ${activeConv?.id === conv.id ? 'active' : ''} ${!conv.is_group ? `role-theme-${getRoleSlug(recipient?.role)}` : ''}`}
                    onClick={() => {
                      setViewingGalaxyLanding(false);
                      setShowCommunityDashboard(false);
                      setActiveConversation(conv);
                      fetchMessages(conv.id);
                    }}
                    aria-pressed={activeConv?.id === conv.id}
                  >
                    <img
                      src={conv.is_group ? (cacheBustUrl(conv.avatar_url, conv.updated_at) || '/assets/default-group.png') : getAvatarUrl(recipient?.name || 'User', recipient?.gender || 'Other', recipient?.avatar_url)}
                      alt=""
                      className="conv-avatar"
                      loading="lazy" decoding="async"
                    />
                    <div className="conv-info">
                      <div className="conv-name">{conv.is_group ? conv.name : getDisplayName(recipient)}</div>
                      <div className="conv-role">{conv.is_group ? `${conv.users.length} Members` : (recipient?.role || 'Crew Member')}</div>
                      <div className="conv-last-msg">{lastMsg}</div>
                    </div>
                    <div className="conv-meta">
                      {lastTime && <div className="conv-time">{lastTime}</div>}
                      <div className="conv-meta-icons">
                        {mutedConvIds.has(conv.id) && (
                          <svg className="conv-mute-icon" viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M13.73 21a2 2 0 0 1-3.46 0"></path>
                            <path d="M18.63 13A17.89 17.89 0 0 1 18 8"></path>
                            <path d="M6.26 6.26A5.86 5.86 0 0 0 6 8c0 7-3 9-3 9h14"></path>
                            <path d="M18 8a6 6 0 0 0-9.33-5"></path>
                            <line x1="1" y1="1" x2="23" y2="23"></line>
                          </svg>
                        )}
                        {conv.unread ? <div className="unread-badge">{conv.unread > 9 ? '9+' : conv.unread}</div> : null}
                      </div>
                    </div>
                  </button>
                );
              })}
            {conversations.length === 0 && (
              <div className="sidebar-empty">No active transmissions yet. Open a crew profile and send the first message.</div>
            )}
          </div>
          )}
        </aside>

        <main className={`chat-window ${activeConv && !activeConv.is_group ? `role-theme-${getRoleSlug(activeRecipient?.role)}` : ''}`}>
          {viewingGalaxyLanding ? (
            <div className="galaxy-container">
              <div className="galaxy-stars"></div>

              <div className="galaxy-main-view">
                {/* Left side: Discover Communities list */}
                <div className="galaxy-card">
                  <h2 style={{ fontFamily: 'Bebas Neue', fontSize: '28px', color: 'var(--cream)', letterSpacing: '0.05em', marginBottom: '8px' }}>
                    🌌 Discover Communities
                  </h2>
                  <p style={{ fontSize: '13px', color: '#888', marginBottom: '20px' }}>
                    Browse available communities or request to join.
                  </p>

                  <div className="sidebar-search-wrap" style={{ marginBottom: '20px' }}>
                    <svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" strokeWidth="2" fill="none"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
                    <input 
                      type="text" 
                      className="sidebar-search-input" 
                      placeholder="Search available communities..." 
                      value={communitySearchQuery}
                      onChange={(e) => {
                        setCommunitySearchQuery(e.target.value);
                        fetchAllCommunities(e.target.value);
                      }}
                    />
                  </div>

                  {allCommunitiesLoading ? (
                    <div style={{ color: 'var(--neon)', fontSize: '12px', textAlign: 'center', padding: '20px' }}>Loading systems...</div>
                  ) : (
                    <div className="community-grid-list">
                      {allCommunities.map((comm) => {
                        const status = comm.joinStatus; // PENDING, ACCEPTED, REJECTED or null
                        const isMember = myCommunities.some(c => c.id === comm.id);

                        return (
                          <div key={comm.id} className="community-card-item">
                            <div className="community-card-info">
                              {comm.avatar_url ? (
                                <img src={comm.avatar_url} alt="" className="community-card-logo" />
                              ) : (
                                <div className="community-card-initials">
                                  {comm.name.charAt(0).toUpperCase()}
                                </div>
                              )}
                              <div>
                                <h3 style={{ margin: '0 0 4px 0', fontSize: '16px', color: 'var(--cream)', fontWeight: 'bold' }}>
                                  {comm.name}
                                </h3>
                                <p style={{ margin: 0, fontSize: '12px', color: '#aaa', lineHeight: '1.4' }}>
                                  {comm.description || 'No description provided.'}
                                </p>
                              </div>
                            </div>

                            <div>
                              {isMember ? (
                                <span className="request-badge accepted">Joined</span>
                              ) : status === 'PENDING' ? (
                                <span className="request-badge pending">Pending Request</span>
                              ) : status === 'REJECTED' ? (
                                <span className="request-badge rejected">Rejected</span>
                              ) : (
                                <button 
                                  onClick={() => handleRequestJoin(comm.id)}
                                  className="nav-cta"
                                  style={{ padding: '6px 16px', fontSize: '11px', borderRadius: '4px' }}
                                >
                                  Join
                                </button>
                              )}
                            </div>
                          </div>
                        );
                      })}
                      {allCommunities.length === 0 && (
                        <div style={{ color: '#666', fontSize: '12px', textAlign: 'center', padding: '20px' }}>No communities found.</div>
                      )}
                    </div>
                  )}
                </div>

                {/* Right side: Subscription pricing tiers selector */}
                <div className="galaxy-card" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
                  <div>
                    <h2 style={{ fontFamily: 'Bebas Neue', fontSize: '28px', color: 'var(--cream)', letterSpacing: '0.05em', marginBottom: '8px' }}>
                      💳 Select a Subscription Plan
                    </h2>
                    <p style={{ fontSize: '13px', color: '#888', marginBottom: '24px' }}>
                      Choose the plan that suits your creative goals. Every community is billed on a standard 3-month cycle.
                    </p>

                    <div className="pricing-cards">
                      <div 
                        className={`pricing-card ${selectedPlan === 'Starter' ? 'selected' : ''}`}
                        onClick={() => {
                          setSelectedPlan('Starter');
                          if (!isFounder) {
                            fetchPricingConfigs();
                          }
                          setIsCommunityModalOpen(true);
                        }}
                        style={{ cursor: 'pointer' }}
                      >
                        <div>
                          <h3>Starter</h3>
                          <div className="price">₹{pricingConfigs.find(c => c.plan_type === 'Starter')?.base_price || '59'}</div>
                          <div className="duration">Per 3 Months</div>
                        </div>
                        <ul className="features" style={{ marginTop: '16px', textAlign: 'left', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                          <li>✓ 20 Members limit</li>
                          <li>✓ Standard group posting</li>
                          <li>✓ Basic script sharing</li>
                          <li>✓ Group chat channels</li>
                        </ul>
                      </div>

                      <div 
                        className={`pricing-card ${selectedPlan === 'Growth' ? 'selected' : ''}`}
                        onClick={() => {
                          setSelectedPlan('Growth');
                          if (!isFounder) {
                            fetchPricingConfigs();
                          }
                          setIsCommunityModalOpen(true);
                        }}
                        style={{ cursor: 'pointer' }}
                      >
                        <div>
                          <h3>Growth</h3>
                          <div className="price">₹{pricingConfigs.find(c => c.plan_type === 'Growth')?.base_price || '99'}</div>
                          <div className="duration">Per 3 Months</div>
                        </div>
                        <ul className="features" style={{ marginTop: '16px', textAlign: 'left', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                          <li>✓ 35 Members limit</li>
                          <li>✓ Custom member roles</li>
                          <li>✓ Priority feedback channel</li>
                          <li>✓ Advanced group moderation</li>
                        </ul>
                      </div>

                      <div 
                        className={`pricing-card ${selectedPlan === 'Custom' ? 'selected' : ''}`}
                        onClick={() => {
                          setSelectedPlan('Custom');
                          if (!isFounder) {
                            fetchPricingConfigs();
                          }
                          setIsCommunityModalOpen(true);
                        }}
                        style={{ cursor: 'pointer' }}
                      >
                        <div>
                          <h3>Custom</h3>
                          <div className="price">
                            ₹{(() => {
                              const customCfg = pricingConfigs.find(c => c.plan_type === 'Custom');
                              const base = customCfg ? Number(customCfg.base_price) : 99;
                              const per = customCfg ? Number(customCfg.per_member_price) : 2;
                              return base + (50 * per); // Default calculated for 50 members (₹199)
                            })()}*
                          </div>
                          <div className="duration">Per 3 Months</div>
                        </div>
                        <ul className="features" style={{ marginTop: '16px', textAlign: 'left', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                          <li>✓ Dynamic member scaling</li>
                          <li>✓ ₹99 Base + ₹2 / member</li>
                          <li>✓ Scale up to 1000 members</li>
                          <li>✓ Dedicated support agent</li>
                        </ul>
                      </div>
                    </div>
                  </div>

                  <div style={{ marginTop: '30px', borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: '20px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: '#888', marginBottom: '12px' }}>
                      <span>Standard Billing Interval:</span>
                      <span style={{ color: 'var(--neon)', fontWeight: 'bold' }}>3 Months</span>
                    </div>
                    <div style={{ fontSize: '11px', color: '#666', lineHeight: '1.4' }}>
                      * Billed automatically every 3 months. Cancel anytime. Rates include all taxes.
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ) : state === 'error' || state === 'not-found' ? (
            <div className="chat-empty">
              <div className="empty-kicker">{state === 'not-found' ? 'Conversation Not Found' : 'Signal Error'}</div>
              <h3>Channel Unavailable</h3>
              <p>{statusText}</p>
              <a href="/crew.htm" className="chat-empty-action">Browse Crew</a>
            </div>
          ) : activeConv ? (
            <>
              <header className="chat-header">
                <button
  className="mobile-back-btn"
  onClick={() => setShowMobileSidebar(true)}
>
  ←
</button>
                <div className="header-left">
                  <div className="header-avatar-container" onClick={() => setShowDetails(!showDetails)} style={{ cursor: 'pointer' }}>
                    <img
                      src={activeConv.is_group ? (cacheBustUrl(activeConv.avatar_url, activeConv.updated_at) || '/assets/default-group.png') : getAvatarUrl(activeRecipient?.name || 'User', activeRecipient?.gender || 'Other', activeRecipient?.avatar_url)}
                      alt=""
                      className="header-avatar"
                      loading="lazy" decoding="async"
                    />
                    {!activeConv.is_group && <span className="presence-dot online"></span>}
                  </div>
                  <div className="header-info">
                    <div className="header-primary-row">
                      <h3 className="header-display-name" onClick={() => setShowDetails(!showDetails)} style={{ cursor: 'pointer' }}>
                        {activeConv?.is_group ? activeConv.name : getDisplayName(activeRecipient)}
                      </h3>
                      {!activeConv.is_group && activeRecipient?.role && (
                        <span className="header-role-tag">{activeRecipient.role}</span>
                      )}
                    </div>
                    
                    <div className="header-secondary-row">
                      <div className="chat-tabs">
                        <button 
                          className={`chat-tab ${activeTab === 'chat' ? 'active' : ''}`}
                          onClick={() => setActiveTab('chat')}
                        >
                          Transmission
                        </button>
                        {inCommunity && (
                          <button 
                            className={`chat-tab ${activeTab === 'feed' ? 'active' : ''}`}
                            onClick={() => {
                              setActiveTab('feed');
                              fetchCommunityPosts();
                            }}
                          >
                            Feed
                          </button>
                        )}
                        <button 
                          className={`chat-tab ${activeTab === 'tasks' ? 'active' : ''}`}
                          onClick={() => {
                            setActiveTab('tasks');
                            if (tasks.length === 0) fetchTasks(activeConv.id);
                          }}
                        >
                          Tasks
                          {tasks.filter(t => t.status !== 'Done').length > 0 && (
                            <span className="tab-badge">{tasks.filter(t => t.status !== 'Done').length}</span>
                          )}
                        </button>
                        {activeRecipient?.email === 'system@takeone-nexus.net.in' && (
                          <button 
                            className={`chat-tab ${activeTab === 'project_tracker' ? 'active' : ''}`}
                            onClick={() => {
                              setActiveTab('project_tracker');
                              fetchActiveOrder();
                            }}
                          >
                            Project Tracker
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                </div>


                <div className="header-actions">
                  <button 
                    className={`header-action-btn ${showSearch ? 'active' : ''}`} 
                    title="Search Transmission"
                    onClick={() => {
                      setShowSearch(!showSearch);
                      setShowMenu(false);
                      setShowDetails(false);
                    }}
                  >
                    <svg viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" strokeWidth="2" fill="none"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
                  </button>
                  {activeConv.is_group ? (
                    <>
                      <button 
                        className={`header-action-btn ${showDetails ? 'active' : ''}`} 
                        title="Group Settings"
                        onClick={() => {
                          setShowDetails(!showDetails);
                          setShowSearch(false);
                          setShowMenu(false);
                        }}
                      >
                        <svg viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" strokeWidth="2" fill="none"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>
                      </button>
                      <button 
                        ref={menuBtnRef}
                        className={`header-action-btn ${showMenu ? 'active' : ''}`} 
                        title="More Options"
                        onClick={(e) => { e.stopPropagation(); setShowMenu(!showMenu); }}
                      >
                        <svg viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" strokeWidth="2" fill="none"><circle cx="12" cy="12" r="1"></circle><circle cx="12" cy="5" r="1"></circle><circle cx="12" cy="19" r="1"></circle></svg>
                      </button>
                    </>
                  ) : (
                    <>
                      <button 
                        ref={menuBtnRef}
                        className={`header-action-btn ${showMenu ? 'active' : ''}`} 
                        title="More Options"
                        onClick={(e) => { e.stopPropagation(); setShowMenu(!showMenu); }}
                      >
                        <svg viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" strokeWidth="2" fill="none"><circle cx="12" cy="12" r="1"></circle><circle cx="12" cy="5" r="1"></circle><circle cx="12" cy="19" r="1"></circle></svg>
                      </button>
                    </>
                  )}
                </div>

              </header>

              <div className="messages-area">
                {showSearch && (
                  <div className="chat-message-search">
                    <div className="search-bar-inner">
                      <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" strokeWidth="2" fill="none"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
                      <input 
                        type="text" 
                        placeholder="Search messages..." 
                        value={chatSearchQuery}
                        onChange={(e) => setChatSearchQuery(e.target.value)}
                        autoFocus
                      />
                      <button onClick={() => { setShowSearch(false); setChatSearchQuery(''); }} className="close-search">
                        <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" strokeWidth="2" fill="none"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                      </button>
                    </div>
                  </div>
                )}

                {showMenu && (
                  <div ref={menuRef} className="chat-dropdown-menu" onClick={(e) => e.stopPropagation()}>
                    {activeConv.is_group ? (
                      <>
                        <button onClick={() => { setShowDetails(true); setShowMenu(false); }}>Group Info</button>
                        <button onClick={() => toggleMute()}>{mutedConvIds.has(activeConv.id) ? 'Unmute Group' : 'Mute Group'}</button>
                        <button onClick={() => handleClearChat(activeConv.id)}>Clear Chat</button>
                        <button className="danger" onClick={() => handleLeaveGroup(activeConv.id)}>Leave Group</button>
                      </>
                    ) : (
                      <>
                        <button onClick={() => { 
                          if (activeRecipient?.id) window.location.href = `/profile?id=${activeRecipient.id}`;
                          else setShowDetails(true); 
                          setShowMenu(false); 
                        }}>View Profile</button>
                        <button onClick={() => toggleMute()}>{mutedConvIds.has(activeConv.id) ? 'Unmute Signal' : 'Mute Signal'}</button>
                        <button onClick={() => handleClearChat(activeConv.id)}>Clear History</button>
                        <button className="danger" onClick={() => handleDeleteConversation(activeConv.id)}>Delete Transmission</button>
                      </>
                    )}
                  </div>
                )}

                {activeTab === 'chat' ? (
                  <>
                    {messageLoading ? (
                      <div className="message-state">
                        <div className="skeleton-loader">
                          <div className="skeleton-item sent"></div>
                          <div className="skeleton-item received"></div>
                          <div className="skeleton-item sent"></div>
                        </div>
                        <span>Synchronizing Message History...</span>
                      </div>
                    ) : messages.length === 0 ? (
                      <div className="message-state">No messages yet. Start the conversation.</div>
                    ) : (
                      <>
                        {hasMore && (
                          <div style={{ textAlign: 'center', padding: '12px 0' }}>
                            <button
                              onClick={loadMoreMessages}
                              disabled={isLoadingMore}
                              style={{
                                background: 'transparent',
                                border: '1px solid rgba(255,255,255,0.1)',
                                color: 'rgba(255,255,255,0.5)',
                                fontFamily: "'Space Mono', monospace",
                                fontSize: '10px',
                                letterSpacing: '0.2em',
                                padding: '8px 20px',
                                cursor: isLoadingMore ? 'not-allowed' : 'pointer',
                                textTransform: 'uppercase',
                                transition: 'all 0.3s ease'
                              }}
                            >
                              {isLoadingMore ? 'Loading...' : '↑ Load Earlier Messages'}
                            </button>
                          </div>
                        )}
                        {Object.entries(groupMessagesByDate(
                          messages.filter(msg => (msg.content || '').toLowerCase().includes(chatSearchQuery.toLowerCase()))
                        )).map(([dateStr, dateMsgs]) => (
                          <div key={dateStr} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                            <div className="date-separator-wrap">
                              <span>
                                {getFriendlyDate(dateStr)}
                              </span>
                            </div>
                            {dateMsgs.map((msg) => (
                              <div key={msg.id} className={`message-bubble ${msg.sender_id === user?.id ? 'sent' : 'received'} ${msg.status || ''}`}>
                                {(activeConv?.is_group || msg.sender?.email === 'system@takeone-nexus.net.in') && msg.sender_id !== user?.id && (
                                  <div className="msg-sender-row" style={{ display: 'flex', alignItems: 'center', marginBottom: '4px' }}>
                                    <span className="msg-sender-name" style={{ color: msg.sender?.email === 'system@takeone-nexus.net.in' ? 'var(--neon)' : 'inherit' }}>
                                      {getDisplayName(msg.sender)}
                                    </span>
                                    {msg.sender?.email === 'system@takeone-nexus.net.in' && (
                                      <span className="msg-verified-badge" style={{
                                        background: 'rgba(255, 77, 26, 0.1)',
                                        border: '1px solid var(--neon)',
                                        color: 'var(--neon)',
                                        borderRadius: '4px',
                                        padding: '1px 5px',
                                        fontSize: '8px',
                                        fontWeight: 'bold',
                                        letterSpacing: '1px',
                                        marginLeft: '6px',
                                        textTransform: 'uppercase'
                                      }}>✓ Verified</span>
                                    )}
                                    {msg.sender?.role && <span className="msg-role-badge">{msg.sender.role}</span>}
                                    {['admin', 'founder'].includes(String(msg.sender?.secondary_role || '').toLowerCase()) && (
                                      <span className="msg-director-badge" style={{
                                        background: 'rgba(255, 77, 26, 0.15)',
                                        border: '1px solid var(--neon)',
                                        color: 'var(--neon)',
                                        boxShadow: '0 0 5px rgba(255, 77, 26, 0.3)',
                                        borderRadius: '4px',
                                        padding: '1px 5px',
                                        fontSize: '9px',
                                        fontWeight: 'bold',
                                        letterSpacing: '1px',
                                        marginLeft: '6px',
                                        textTransform: 'uppercase'
                                      }}>Admin</span>
                                    )}
                                  </div>
                                )}
                                <div className="msg-content">
                                  {msg.content && msg.content.includes('[WEBSITE_OFFER:') ? (
                                    <OfferCard 
                                      message={msg} 
                                      onAccept={handleAcceptOffer} 
                                      onNegotiate={handleOpenNegotiation} 
                                    />
                                  ) : msg.content && msg.content.includes('[MAINTENANCE_OFFER:') ? (
                                    <MaintenanceOfferCard 
                                      message={msg} 
                                      onPaymentSuccess={fetchActiveOrder} 
                                    />
                                  ) : (
                                    msg.content
                                  )}
                                  {msg.status === 'sending' && <span className="msg-status-icon sending">...</span>}
                                  {msg.status === 'failed' && (
                                    <span className="msg-status-icon error" title="Failed to send. Click to retry." onClick={() => {
                                      setNewMessage(msg.content);
                                      setMessages(prev => prev.filter(m => m.id !== msg.id));
                                    }}>!</span>
                                  )}
                                </div>
                                <small className="msg-time">{new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</small>
                              </div>
                            ))}
                          </div>
                        ))}
                      </>
                    )}
                  </>
                ) : activeTab === 'feed' ? (
                  <div className="feed-area" style={{ padding: '20px', overflowY: 'auto', height: '100%', display: 'flex', flexDirection: 'column', gap: '20px', backgroundColor: '#0b0c10' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid rgba(255,255,255,0.1)', paddingBottom: '12px' }}>
                      <h2 style={{ fontFamily: 'var(--font-mono)', fontSize: '24px', letterSpacing: '0.05em', color: 'var(--cream)', margin: 0, textTransform: 'uppercase' }}>Community Feed</h2>
                      {['Owner', 'Admin', 'Moderator'].includes(communityRole || '') && (
                        <button 
                          onClick={() => setIsCreatePostOpen(true)}
                          style={{
                            background: 'var(--neon)',
                            border: 'none',
                            color: '#fff',
                            padding: '8px 16px',
                            borderRadius: '6px',
                            fontWeight: 'bold',
                            cursor: 'pointer',
                            fontSize: '13px',
                            textTransform: 'uppercase',
                            letterSpacing: '1px',
                            boxShadow: '0 0 10px rgba(255, 77, 26, 0.4)'
                          }}
                        >
                          New Post +
                        </button>
                      )}
                    </div>

                    {postsLoading ? (
                      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', flex: 1, color: 'var(--neon)', fontSize: '14px' }}>
                        Loading feed transmissions...
                      </div>
                    ) : communityPosts.length === 0 ? (
                      <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', flex: 1, color: '#888', padding: '40px', textAlign: 'center' }}>
                        <div style={{ fontSize: '48px', marginBottom: '16px' }}>📸</div>
                        <h3 style={{ color: '#ccc', margin: '0 0 8px 0' }}>No posts yet</h3>
                        <p style={{ fontSize: '13px', maxWidth: '300px', margin: 0 }}>Admins and moderators can share behind-the-scenes content, announcements, and updates here.</p>
                      </div>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '24px', maxWidth: '600px', margin: '0 auto', width: '100%' }}>
                        {communityPosts.map((post) => {
                          const hasLiked = post.likes.some((l: any) => l.user_id === user?.id);
                          const mediaList = Array.isArray(post.media_urls) ? post.media_urls : [];
                          return (
                            <div 
                              key={post.id}
                              style={{
                                background: '#121212',
                                border: post.is_pinned ? '1px solid var(--neon)' : '1px solid rgba(255,255,255,0.05)',
                                borderRadius: '12px',
                                overflow: 'hidden',
                                display: 'flex',
                                flexDirection: 'column'
                              }}
                            >
                              {/* Header */}
                              <div style={{ padding: '12px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid rgba(255,255,255,0.03)' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                  <img 
                                    src={getAvatarUrl(post.author.name, 'Other', post.author.avatar_url)} 
                                    alt="" 
                                    style={{ width: '36px', height: '36px', borderRadius: '50%', objectFit: 'cover' }}
                                  />
                                  <div>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                      <span style={{ fontSize: '13px', fontWeight: 'bold', color: '#fff' }}>
                                        {post.author.screen_name || post.author.name}
                                      </span>
                                      {post.author.role && (
                                        <span style={{ fontSize: '10px', background: 'rgba(255,255,255,0.08)', padding: '2px 6px', borderRadius: '4px', color: '#aaa' }}>
                                          {post.author.role}
                                        </span>
                                      )}
                                    </div>
                                    <div style={{ fontSize: '10px', color: '#666', marginTop: '2px' }}>
                                      {new Date(post.created_at).toLocaleDateString()} at {new Date(post.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                    </div>
                                  </div>
                                </div>
                                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                                  {post.is_pinned && (
                                    <span style={{ fontSize: '10px', background: 'rgba(255, 77, 26, 0.1)', color: 'var(--neon)', border: '1px solid var(--neon)', padding: '2px 6px', borderRadius: '4px', fontWeight: 'bold' }}>
                                      📌 Pinned
                                    </span>
                                  )}
                                  {['Owner', 'Admin', 'Moderator'].includes(communityRole || '') && (
                                    <button 
                                      onClick={() => handlePinPost(post.id)}
                                      style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: '#888', fontSize: '14px', padding: '4px' }}
                                      title={post.is_pinned ? 'Unpin post' : 'Pin post'}
                                    >
                                      📌
                                    </button>
                                  )}
                                  {(post.author_id === user?.id || ['Owner', 'Admin', 'Moderator'].includes(communityRole || '')) && (
                                    <button 
                                      onClick={() => handleDeletePost(post.id)}
                                      style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: '#ff4d4d', fontSize: '14px', padding: '4px' }}
                                      title="Delete post"
                                    >
                                      🗑️
                                    </button>
                                  )}
                                </div>
                              </div>

                              {/* Media Slider/Image */}
                              {mediaList.length > 0 && (
                                <div style={{ position: 'relative', width: '100%', paddingBottom: '100%', background: '#000' }}>
                                  <img 
                                    src={mediaList[0]} 
                                    alt="Post Content" 
                                    style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', objectFit: 'contain' }}
                                  />
                                  {mediaList.length > 1 && (
                                    <div style={{ position: 'absolute', bottom: '12px', right: '12px', background: 'rgba(0,0,0,0.6)', padding: '4px 8px', borderRadius: '12px', fontSize: '11px', color: '#fff', fontWeight: 'bold' }}>
                                      1 / {mediaList.length}
                                    </div>
                                  )}
                                </div>
                              )}

                              {/* Action Bar */}
                              <div style={{ padding: '12px 16px 8px 16px', display: 'flex', alignItems: 'center', gap: '16px' }}>
                                <button 
                                  onClick={() => handleLikePost(post.id)}
                                  style={{ background: 'transparent', border: 'none', padding: 0, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px', color: hasLiked ? 'var(--neon)' : '#ccc', fontSize: '18px', fontWeight: 'bold' }}
                                >
                                  {hasLiked ? '❤️' : '🤍'}
                                  <span style={{ fontSize: '13px', color: '#aaa' }}>{post.likes.length}</span>
                                </button>
                                <button 
                                  onClick={() => setActiveCommentsPostId(activeCommentsPostId === post.id ? null : post.id)}
                                  style={{ background: 'transparent', border: 'none', padding: 0, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px', color: '#ccc', fontSize: '18px' }}
                                >
                                  💬
                                  <span style={{ fontSize: '13px', color: '#aaa' }}>{post.comments.length}</span>
                                </button>
                                <button 
                                  onClick={() => {
                                    navigator.clipboard.writeText(`${window.location.origin}/chat`);
                                    alert('Link copied to clipboard!');
                                  }}
                                  style={{ background: 'transparent', border: 'none', padding: 0, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px', color: '#ccc', fontSize: '18px', marginLeft: 'auto' }}
                                  title="Share Post"
                                >
                                  🔗
                                </button>
                              </div>

                              {/* Caption */}
                              {post.caption && (
                                <div style={{ padding: '0 16px 12px 16px', fontSize: '13px', lineHeight: '1.5', color: '#ccc' }}>
                                  <span style={{ fontWeight: 'bold', color: '#fff', marginRight: '8px' }}>
                                    {post.author.screen_name || post.author.name}
                                  </span>
                                  {post.caption.split(' ').map((word: string, i: number) => {
                                    if (word.startsWith('#')) {
                                      return <span key={i} style={{ color: 'var(--neon)', marginRight: '4px' }}>{word}</span>;
                                    } else if (word.startsWith('@')) {
                                      return <span key={i} style={{ color: '#66fcf1', marginRight: '4px' }}>{word}</span>;
                                    }
                                    return word + ' ';
                                  })}
                                </div>
                              )}

                              {/* Comments Accordion */}
                              {activeCommentsPostId === post.id && (
                                <div style={{ borderTop: '1px solid rgba(255,255,255,0.03)', background: 'rgba(0,0,0,0.1)', padding: '12px 16px' }}>
                                  <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', maxHeight: '200px', overflowY: 'auto', marginBottom: '12px' }}>
                                    {post.comments.length === 0 ? (
                                      <div style={{ fontSize: '11px', color: '#666', textAlign: 'center', padding: '10px' }}>No comments yet. Be the first to comment!</div>
                                    ) : (
                                      post.comments.map((comment: any) => (
                                        <div key={comment.id} style={{ display: 'flex', gap: '8px', fontSize: '12px', alignItems: 'flex-start' }}>
                                          <img 
                                            src={getAvatarUrl(comment.user.name, 'Other', comment.user.avatar_url)} 
                                            alt="" 
                                            style={{ width: '24px', height: '24px', borderRadius: '50%', objectFit: 'cover', marginTop: '2px' }}
                                          />
                                          <div style={{ flex: 1 }}>
                                            <span style={{ fontWeight: 'bold', color: '#fff', marginRight: '6px' }}>
                                              {comment.user.screen_name || comment.user.name}
                                            </span>
                                            <span style={{ color: '#ccc' }}>{comment.content}</span>
                                          </div>
                                        </div>
                                      ))
                                    )}
                                  </div>
                                  <form onSubmit={(e) => handleAddComment(e, post.id)} style={{ display: 'flex', gap: '8px' }}>
                                    <input 
                                      type="text" 
                                      placeholder="Add a comment..." 
                                      value={commentText}
                                      onChange={(e) => setCommentText(e.target.value)}
                                      style={{
                                        flex: 1,
                                        background: 'rgba(0,0,0,0.3)',
                                        border: '1px solid rgba(255,255,255,0.1)',
                                        borderRadius: '4px',
                                        padding: '6px 10px',
                                        fontSize: '12px',
                                        color: '#fff'
                                      }}
                                    />
                                    <button 
                                      type="submit"
                                      style={{
                                        background: 'var(--neon)',
                                        border: 'none',
                                        color: '#fff',
                                        padding: '6px 12px',
                                        borderRadius: '4px',
                                        fontWeight: 'bold',
                                        cursor: 'pointer',
                                        fontSize: '11px'
                                      }}
                                    >
                                      Post
                                    </button>
                                  </form>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                ) : activeTab === 'tasks' ? (
                  <div className="tasks-area">
                    <div className="tasks-header">
                      <h3>Active Missions</h3>
                      {activeConv && (
                        (!activeConv.is_group || 
                        (['admin'].includes(user?.role?.toLowerCase() || '') || ['admin', 'founder'].includes(user?.secondary_role?.toLowerCase() || '')) || 
                        ['Director', 'Admin'].includes(activeConv.my_role || '')) && (
                          <button onClick={() => setIsTaskModalOpen(true)} className="add-task-btn">Assign Task +</button>
                        )
                      )}
                    </div>
                    {tasksLoading ? (
                      <div className="message-state">Accessing mission records...</div>
                    ) : tasks.length === 0 ? (
                      <div className="message-state">No missions assigned yet.</div>
                    ) : (
                      <div className="tasks-list">
                        {tasks.map(task => {
                          const assignee = activeConv?.users.find(u => u.id === task.assignee_id);
                          const isCreator = task.creator_id === user?.id;
                          const isAdmin = ['admin'].includes(user?.role?.toLowerCase() || '') || 
                                          ['admin', 'founder'].includes(user?.secondary_role?.toLowerCase() || '');
                          const isManageable = isCreator || isAdmin;
                          const isAssignee = task.assignee_id === user?.id;

                          return (
                            <div key={task.id} className={`task-card priority-${task.priority.toLowerCase()}`}>
                              <div className="task-main">
                                <div className="task-top-row">
                                  <div className="task-title">{task.title}</div>
                                  {isManageable && (
                                    <button onClick={() => deleteTask(task.id)} className="task-delete-btn" title="Abort Mission">
                                      <svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" strokeWidth="2" fill="none"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                                    </button>
                                  )}
                                </div>
                                
                                {task.description && <div className="task-desc">{task.description}</div>}
                                
                                <div className="task-assignee">
                                  <label>Assigned Operative</label>
                                  <div className="assignee-val">
                                    {assignee ? (
                                      <>
                                        <img src={getAvatarUrl(assignee.name, assignee.gender || 'Other', assignee.avatar_url)} alt="" className="mini-avatar" />
                                        <span>{assignee.name}</span>
                                      </>
                                    ) : (
                                      <span className="unassigned">Field Operative Required</span>
                                    )}
                                  </div>
                                </div>

                                <div className="task-footer">
                                  <div className="task-status-wrap">
                                    {isManageable || isAssignee ? (
                                      <select 
                                        value={task.status} 
                                        onChange={(e) => updateTaskStatus(task.id, e.target.value)}
                                        className={`status-select status-${task.status.toLowerCase().replace(' ', '')}`}
                                        disabled={task.approval_status === 'Approved'}
                                      >
                                        <option value="Todo">Todo</option>
                                        <option value="In Progress">In Progress</option>
                                        <option value="Review">Review</option>
                                        <option value="Done">Done</option>
                                      </select>
                                    ) : (
                                      <span className={`task-status status-${task.status.toLowerCase().replace(' ', '')}`}>{task.status}</span>
                                    )}

                                    {task.status === 'Done' && (
                                      <div className="approval-status">
                                        {task.approval_status === 'Approved' ? (
                                          <span className="badge approved">✓ Approved</span>
                                        ) : (
                                          <span className="badge pending">⌛ Pending Approval</span>
                                        )}
                                      </div>
                                    )}
                                  </div>

                                  <div className="task-tags">
                                    {task.reward_credits > 0 && (
                                      <span className="task-reward-tag">✦ {task.reward_credits} Credits</span>
                                    )}
                                    <span className="task-priority-tag">{task.priority}</span>
                                    {task.due_date && <span className="task-due-tag">Deadline: {new Date(task.due_date).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' })}</span>}
                                  </div>
                                </div>

                                {task.status === 'Done' && task.approval_status !== 'Approved' && isManageable && (
                                  <button 
                                    className="task-approve-btn"
                                    onClick={() => approveTask(task.id)}
                                  >
                                    Grant Rewards & Close Mission
                                  </button>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="project-tracker-area" style={{ height: '100%', overflow: 'hidden' }}>
                    <ProjectTracker order={activeOrder} onPaymentSuccess={fetchActiveOrder} />
                  </div>
                )}
                {Object.keys(typingUsers).length > 0 && activeTab === 'chat' && (
                  <div className="typing-indicator">
                    {Object.values(typingUsers).join(', ')} {Object.keys(typingUsers).length > 1 ? 'are' : 'is'} typing...
                  </div>
                )}
                <div ref={messagesEndRef} />
              </div>

              {showDetails && activeConv && (
                <div className="chat-details-panel">
                  <header className="details-header">
                    <h3>{activeConv.is_group ? 'Group Details' : 'Crew Member'}</h3>
                    <button onClick={() => setShowDetails(false)} className="close-details">
                      <svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" strokeWidth="2" fill="none"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                    </button>
                  </header>
                  <div className="details-content">
                    <div className="details-main-info">
                      <div className="details-avatar-wrapper">
                        <img 
                          src={activeConv.is_group ? (cacheBustUrl(activeConv.avatar_url, activeConv.updated_at) || '/assets/default-group.png') : getAvatarUrl(activeRecipient?.name || 'User', activeRecipient?.gender || 'Other', activeRecipient?.avatar_url)} 
                          alt="" 
                          className="details-avatar" 
                          loading="lazy" decoding="async"
                          style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }}
                        />
                      </div>
                      <h4>{activeConv.is_group ? activeConv.name : (activeRecipient?.name || 'Crew Member')}</h4>
                      {!activeConv.is_group && <span className="details-role">{activeRecipient?.role || 'Crew Member'}</span>}
                      
                      {activeConv.is_group && (
                        <div style={{ marginTop: '12px', display: 'flex', flexDirection: 'column', gap: '8px', width: '100%', alignItems: 'center' }}>
                          <AvatarUploader
                            type="group"
                            targetId={activeConv.id}
                            currentUrl={activeConv.avatar_url}
                            isAdmin={activeConv.my_role === 'Admin' || activeConv.my_role === 'Director' || ['Owner', 'Moderator'].includes(communityRole || '')}
                            size={72}
                            shape="rounded"
                            onSuccess={(newUrl) => {
                              setActiveConv(prev => prev ? { ...prev, avatar_url: newUrl || undefined } : null);
                              setConversations(prev => prev.map(c => c.id === activeConv.id ? { ...c, avatar_url: newUrl || undefined } : c));
                            }}
                          />
                        </div>
                      )}
                    </div>

                    {/* Tab Navigation for Group Details */}
                    {activeConv.is_group && (activeConv.my_role === 'Admin' || activeConv.my_role === 'Director' || ['Owner', 'Moderator'].includes(communityRole || '')) && (
                      <div style={{ display: 'flex', borderBottom: '1px solid rgba(232,232,224,0.1)', width: '100%', marginBottom: '16px' }}>
                        <button 
                          onClick={() => setDetailsTab('members')}
                          style={{
                            flex: 1,
                            padding: '10px 0',
                            background: 'none',
                            border: 'none',
                            borderBottom: detailsTab === 'members' ? '2px solid var(--neon)' : '2px solid transparent',
                            color: detailsTab === 'members' ? 'var(--neon)' : '#a0a0a0',
                            fontSize: '13px',
                            fontWeight: 'bold',
                            cursor: 'pointer',
                            transition: 'all 0.2s'
                          }}
                        >
                          Members
                        </button>
                        <button 
                          onClick={() => setDetailsTab('settings')}
                          style={{
                            flex: 1,
                            padding: '10px 0',
                            background: 'none',
                            border: 'none',
                            borderBottom: detailsTab === 'settings' ? '2px solid var(--neon)' : '2px solid transparent',
                            color: detailsTab === 'settings' ? 'var(--neon)' : '#a0a0a0',
                            fontSize: '13px',
                            fontWeight: 'bold',
                            cursor: 'pointer',
                            transition: 'all 0.2s'
                          }}
                        >
                          Settings
                        </button>
                      </div>
                    )}

                    {activeConv.is_group ? (
                      detailsTab === 'members' ? (
                        <div className="details-section">
                          {/* Pending join requests section */}
                          {(activeConv.my_role === 'Admin' || activeConv.my_role === 'Director' || ['Owner', 'Moderator'].includes(communityRole || '')) && (joinRequestsLoading || pendingJoinRequests.length > 0) && (
                            <div style={{ marginBottom: '20px', background: 'rgba(255,255,255,0.03)', borderRadius: '8px', padding: '12px', border: '1px solid rgba(255,255,255,0.05)' }}>
                              <div className="section-title" style={{ color: 'var(--neon)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                <span>Join Requests {pendingJoinRequests.length > 0 && `(${pendingJoinRequests.length})`}</span>
                              </div>
                              {joinRequestsLoading ? (
                                <div style={{ fontSize: '12px', color: '#888', marginTop: '10px' }}>Loading requests...</div>
                              ) : (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginTop: '10px' }}>
                                  {pendingJoinRequests.map(req => (
                                    <div key={req.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px', background: 'rgba(0,0,0,0.2)', borderRadius: '6px' }}>
                                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                        <img src={getAvatarUrl(req.user.name, req.user.gender || 'Other', req.user.avatar_url)} alt="" className="mini-avatar" style={{ width: '28px', height: '28px', borderRadius: '50%' }} />
                                        <span style={{ fontSize: '13px', color: '#e8e8e0' }}>{req.user.name}</span>
                                      </div>
                                      <div style={{ display: 'flex', gap: '6px' }}>
                                        <button 
                                          onClick={() => handleApproveJoinRequest(activeConv.id, req.id)}
                                          style={{ background: '#22c55e', color: '#fff', border: 'none', borderRadius: '4px', padding: '4px 8px', fontSize: '11px', cursor: 'pointer' }}
                                        >
                                          Approve
                                        </button>
                                        <button 
                                          onClick={() => handleRejectJoinRequest(activeConv.id, req.id)}
                                          style={{ background: '#ef4444', color: '#fff', border: 'none', borderRadius: '4px', padding: '4px 8px', fontSize: '11px', cursor: 'pointer' }}
                                        >
                                          Reject
                                        </button>
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          )}

                          <div className="section-title">Members ({activeConv.users.length})</div>
                          <div className="details-members-list">
                            {activeConv.users.map(u => {
                              const isMe = u.id === user?.id;
                              const canManageUser = !isMe && (activeConv.my_role === 'Director' || ['Owner', 'Moderator'].includes(communityRole || ''));
                              return (
                                <div key={u.id} className="member-item" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid rgba(255,255,255,0.02)' }}>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                    <img src={getAvatarUrl(u.name, u.gender || 'Other', u.avatar_url)} alt="" className="mini-avatar" loading="lazy" decoding="async" />
                                    <div className="member-info">
                                      <span className="member-name" style={{ color: isMe ? 'var(--neon)' : '#e8e8e0' }}>{u.name} {isMe && '(You)'}</span>
                                      <span className="member-role" style={{ 
                                        fontSize: '11px', 
                                        color: u.role_in_group === 'Director' ? '#ef4444' : u.role_in_group === 'Admin' ? 'var(--neon)' : '#888',
                                        background: u.role_in_group === 'Director' ? 'rgba(239,68,68,0.1)' : u.role_in_group === 'Admin' ? 'rgba(0,255,200,0.1)' : 'transparent',
                                        padding: '2px 6px',
                                        borderRadius: '4px',
                                        marginLeft: '4px'
                                      }}>
                                        {u.role_in_group || 'Member'}
                                      </span>
                                    </div>
                                  </div>
                                  
                                  {canManageUser && (
                                    <div style={{ display: 'flex', gap: '4px' }}>
                                      {u.role_in_group !== 'Admin' && u.role_in_group !== 'Director' && (
                                        <button 
                                          onClick={() => handlePromoteMember(activeConv.id, u.id)}
                                          style={{ background: 'rgba(0,255,200,0.15)', color: 'var(--neon)', border: '1px solid var(--neon)', borderRadius: '4px', padding: '2px 6px', fontSize: '10px', cursor: 'pointer' }}
                                          title="Promote to Admin"
                                        >
                                          Promote
                                        </button>
                                      )}
                                      {u.role_in_group === 'Admin' && (
                                        <button 
                                          onClick={() => handleDemoteMember(activeConv.id, u.id)}
                                          style={{ background: 'rgba(255,255,255,0.1)', color: '#ccc', border: '1px solid #555', borderRadius: '4px', padding: '2px 6px', fontSize: '10px', cursor: 'pointer' }}
                                          title="Demote to Member"
                                        >
                                          Demote
                                        </button>
                                      )}
                                      {u.role_in_group !== 'Director' && (
                                        <button 
                                          onClick={() => handleRemoveGroupMember(activeConv.id, u.id)}
                                          style={{ background: 'rgba(239,68,68,0.15)', color: '#ef4444', border: '1px solid #ef4444', borderRadius: '4px', padding: '2px 6px', fontSize: '10px', cursor: 'pointer' }}
                                          title="Remove from Group"
                                        >
                                          Remove
                                        </button>
                                      )}
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                          <div className="details-actions" style={{ marginTop: '16px' }}>
                            <button className="details-btn danger" onClick={() => handleLeaveGroup(activeConv.id)}>Leave Group</button>
                          </div>
                        </div>
                      ) : (
                        /* Settings Tab */
                        <div className="details-section" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                          {(() => {
                            const settings = activeConv.groupSettings ? (typeof activeConv.groupSettings === 'string' ? JSON.parse(activeConv.groupSettings) : activeConv.groupSettings) : {};
                            return (
                              <>
                                {/* 1. Visibility */}
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                                  <label style={{ fontSize: '12px', color: '#aaa', fontWeight: 'bold' }}>Group Visibility</label>
                                  <select 
                                    value={settings.visibility || 'Public'}
                                    onChange={(e) => handleUpdateSetting(activeConv.id, 'visibility', e.target.value)}
                                    style={{ background: '#111', border: '1px solid #333', color: '#fff', borderRadius: '4px', padding: '8px', fontSize: '13px' }}
                                  >
                                    <option value="Public">Public (Anyone can view in list)</option>
                                    <option value="Private">Private (Hidden from lists)</option>
                                  </select>
                                </div>

                                {/* 2. Who Can Join */}
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                                  <label style={{ fontSize: '12px', color: '#aaa', fontWeight: 'bold' }}>Who Can Join</label>
                                  <select 
                                    value={settings.joinPolicy || 'Everyone'}
                                    onChange={(e) => handleUpdateSetting(activeConv.id, 'joinPolicy', e.target.value)}
                                    style={{ background: '#111', border: '1px solid #333', color: '#fff', borderRadius: '4px', padding: '8px', fontSize: '13px' }}
                                  >
                                    <option value="Everyone">Everyone</option>
                                    <option value="Approval Required">Approval Required</option>
                                    <option value="Invite Only">Invite Only</option>
                                  </select>
                                </div>

                                {/* 3. Who Can Send Messages */}
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                                  <label style={{ fontSize: '12px', color: '#aaa', fontWeight: 'bold' }}>Who Can Send Messages</label>
                                  <select 
                                    value={settings.canMembersMessage === false || settings.canMembersMessage === 'Admins Only' ? 'Admins Only' : 'Everyone'}
                                    onChange={(e) => handleUpdateSetting(activeConv.id, 'canMembersMessage', e.target.value)}
                                    style={{ background: '#111', border: '1px solid #333', color: '#fff', borderRadius: '4px', padding: '8px', fontSize: '13px' }}
                                  >
                                    <option value="Everyone">Everyone</option>
                                    <option value="Admins Only">Admins Only</option>
                                  </select>
                                </div>

                                {/* 4. Who Can Add Members */}
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                                  <label style={{ fontSize: '12px', color: '#aaa', fontWeight: 'bold' }}>Who Can Invite Members</label>
                                  <select 
                                    value={settings.canMembersInvite === false || settings.canMembersInvite === 'Admins Only' ? 'Admins Only' : 'Everyone'}
                                    onChange={(e) => handleUpdateSetting(activeConv.id, 'canMembersInvite', e.target.value)}
                                    style={{ background: '#111', border: '1px solid #333', color: '#fff', borderRadius: '4px', padding: '8px', fontSize: '13px' }}
                                  >
                                    <option value="Everyone">Everyone</option>
                                    <option value="Admins Only">Admins Only</option>
                                  </select>
                                </div>

                                {/* 5. Who Can Edit Group Details */}
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                                  <label style={{ fontSize: '12px', color: '#aaa', fontWeight: 'bold' }}>Who Can Edit Group Details</label>
                                  <select 
                                    value={settings.canMembersEdit || 'Admins and Owner'}
                                    onChange={(e) => handleUpdateSetting(activeConv.id, 'canMembersEdit', e.target.value)}
                                    style={{ background: '#111', border: '1px solid #333', color: '#fff', borderRadius: '4px', padding: '8px', fontSize: '13px' }}
                                  >
                                    <option value="Owner Only">Owner Only</option>
                                    <option value="Admins and Owner">Admins and Owner</option>
                                  </select>
                                </div>
                              </>
                            );
                          })()}
                        </div>
                      )
                    ) : (
                      <div className="details-section">
                        <div className="section-title">Field Intel</div>
                        <div className="intel-grid">
                          <div className="intel-cell">
                            <label>Credits</label>
                            <span>{activeRecipient?.credits || 0}</span>
                          </div>
                          <div className="intel-cell">
                            <label>College</label>
                            <span>{activeRecipient?.college || 'N/A'}</span>
                          </div>
                          <div className="intel-cell">
                            <label>City</label>
                            <span>{activeRecipient?.city || 'N/A'}</span>
                          </div>
                          <div className="intel-cell">
                            <label>Joined</label>
                            <span>{activeRecipient?.created_at ? new Date(activeRecipient.created_at).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' }) : 'Recently'}</span>
                          </div>
                        </div>
                        {activeRecipient?.skills && (
                          <div className="intel-skills">
                            <label>Skills</label>
                            <div className="skills-wrap">
                              {(activeRecipient.skills || '').split(',').map((s: string) => <span key={s} className="skill-tag">{s.trim()}</span>)}
                            </div>
                          </div>
                        )}
                        <div className="details-actions">
                          <button className="details-btn" onClick={() => window.location.href = `/profile?id=${activeRecipient?.id}`}>View Profile</button>
                          <button className="details-btn danger" onClick={() => handleDeleteConversation(activeConv.id)}>Delete History</button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {activeTab === 'chat' && (
                <form className="chat-input-wrap" onSubmit={sendMessage}>
                  <div className="input-container">
                    <input
                      ref={inputRef}
                      type="text"
                      className="chat-input"
                      placeholder={
                        (!activeConv?.is_group && activeRecipient?.id === -1) 
                          ? 'This user is no longer available.' 
                          : isMessagingRestricted 
                            ? 'Only admins can send messages in this group.' 
                            : `Message ${activeConv?.is_group ? activeConv.name : (activeRecipient?.name || 'crew member')}...`
                      }
                      value={newMessage}
                      onChange={onInputChange}
                      disabled={sending || (!activeConv?.is_group && activeRecipient?.id === -1) || isMessagingRestricted}
                    />
                    <button 
                      type="submit" 
                      className="send-btn" 
                      disabled={!newMessage.trim() || sending || (!activeConv?.is_group && activeRecipient?.id === -1) || isMessagingRestricted} 
                      aria-label="Send message"
                    >
                      <svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round"><line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon></svg>
                    </button>
                  </div>
                </form>
              )}
            </>
          ) : (
            <div className="chat-empty">
              <div className="empty-icon-wrap">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>
                <div className="pulse-ring"></div>
              </div>
              <div className="empty-kicker">Secure Signal Desk</div>
              <h3>Channel Idle</h3>
              <p>Select a transmission from the sidebar or message someone from the Crew page.</p>
              <div className="empty-status-grid">
                <div className="status-cell">
                  <span className="cell-label">Encrypted</span>
                  <span className="cell-value">AES-256</span>
                </div>
                <div className="status-cell">
                  <span className="cell-label">Uptime</span>
                  <span className="cell-value">99.9%</span>
                </div>
              </div>
            </div>
          )}
        </main>
      </div>
      <NewDirectMessageModal 
        isOpen={isGroupModalOpen} 
        onClose={() => setIsGroupModalOpen(false)} 
        onSelectUser={async (userId) => {
          setIsGroupModalOpen(false);
          const conversation = await openDirectConversation(userId);
          if (conversation) {
            await fetchMessages(conversation.id);
          }
        }} 
      />
      <TaskModal 
        isOpen={isTaskModalOpen} 
        onClose={() => setIsTaskModalOpen(false)} 
        conversationId={activeConv?.id || 0} 
        members={activeConv?.users || []} 
        onCreate={createTask} 
      />

      {isNegotiateModalOpen && negotiatingOffer && (
        <div style={{
          position: 'fixed',
          top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(0,0,0,0.85)',
          backdropFilter: 'blur(8px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 9999,
          padding: '20px'
        }}>
          <div style={{
            background: '#0d0d12',
            border: '1px solid rgba(255, 77, 26, 0.2)',
            borderRadius: '8px',
            padding: '30px',
            width: '100%',
            maxWidth: '480px',
            boxShadow: '0 10px 40px rgba(0,0,0,0.8)',
            position: 'relative'
          }}>
            <h3 style={{ margin: '0 0 20px 0', color: 'var(--neon)', textTransform: 'uppercase', letterSpacing: '1.5px', fontSize: '15px' }}>
              Propose Proposal Adjustments
            </h3>
            
            <form onSubmit={async (e) => {
              e.preventDefault();
              const formData = new FormData(e.currentTarget);
              const proposedBudget = parseFloat(formData.get('proposedBudget') as string);
              const message = formData.get('message') as string;
              const reason = formData.get('reason') as string;

              if (isNaN(proposedBudget) || proposedBudget <= 0) {
                alert('Please enter a valid budget');
                return;
              }

              try {
                const token = localStorage.getItem('token');
                const response = await fetch(`/api/services/offers/${negotiatingOffer.id}/status`, {
                  method: 'PATCH',
                  headers: {
                    'Content-Type': 'application/json',
                    ...(token ? { 'Authorization': `Bearer ${token}` } : {})
                  },
                  body: JSON.stringify({
                    status: 'negotiating',
                    proposedBudget,
                    message,
                    reason
                  })
                });
                const payload = await response.json();
                if (payload.success) {
                  alert('Negotiation proposal sent!');
                  setIsNegotiateModalOpen(false);
                  setNegotiatingOffer(null);
                  if (activeConv) fetchMessages(activeConv.id);
                } else {
                  alert(payload.message || 'Failed to submit proposal adjustments');
                }
              } catch (err) {
                console.error(err);
                alert('An error occurred');
              }
            }}>
              <div style={{ marginBottom: '20px' }}>
                <label style={{ display: 'block', fontSize: '10px', color: '#888', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '8px' }}>Proposed Budget (INR)</label>
                <input
                  name="proposedBudget"
                  type="number"
                  required
                  defaultValue={negotiatingOffer.price}
                  style={{
                    width: '100%',
                    background: 'rgba(255,255,255,0.03)',
                    border: '1px solid rgba(255,255,255,0.1)',
                    borderRadius: '4px',
                    padding: '12px',
                    color: '#fff',
                    fontSize: '14px',
                    outline: 'none'
                  }}
                />
              </div>

              <div style={{ marginBottom: '20px' }}>
                <label style={{ display: 'block', fontSize: '10px', color: '#888', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '8px' }}>Reason / Request</label>
                <input
                  name="reason"
                  type="text"
                  placeholder="e.g. Budget constraints, add custom animations, etc."
                  required
                  style={{
                    width: '100%',
                    background: 'rgba(255,255,255,0.03)',
                    border: '1px solid rgba(255,255,255,0.1)',
                    borderRadius: '4px',
                    padding: '12px',
                    color: '#fff',
                    fontSize: '14px',
                    outline: 'none'
                  }}
                />
              </div>

              <div style={{ marginBottom: '25px' }}>
                <label style={{ display: 'block', fontSize: '10px', color: '#888', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '8px' }}>Additional Message</label>
                <textarea
                  name="message"
                  rows={3}
                  placeholder="Enter a message detailing your request..."
                  style={{
                    width: '100%',
                    background: 'rgba(255,255,255,0.03)',
                    border: '1px solid rgba(255,255,255,0.1)',
                    borderRadius: '4px',
                    padding: '12px',
                    color: '#fff',
                    fontSize: '14px',
                    outline: 'none',
                    resize: 'none'
                  }}
                />
              </div>

              <div style={{ display: 'flex', gap: '10px' }}>
                <button
                  type="submit"
                  style={{
                    flex: 1,
                    background: 'var(--neon)',
                    color: '#000',
                    border: 'none',
                    borderRadius: '4px',
                    padding: '12px',
                    fontWeight: 'bold',
                    cursor: 'pointer',
                    textTransform: 'uppercase',
                    fontSize: '11px',
                    letterSpacing: '1px'
                  }}
                >
                  Submit Adjustments
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setIsNegotiateModalOpen(false);
                    setNegotiatingOffer(null);
                  }}
                  style={{
                    background: 'rgba(255,255,255,0.05)',
                    color: '#fff',
                    border: '1px solid rgba(255,255,255,0.1)',
                    borderRadius: '4px',
                    padding: '12px 20px',
                    fontWeight: 'bold',
                    cursor: 'pointer',
                    textTransform: 'uppercase',
                    fontSize: '11px',
                    letterSpacing: '1px'
                  }}
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {isCommunityModalOpen && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.85)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1000, backdropFilter: 'blur(8px)' }}>
          <div style={{ background: '#121212', border: '1px solid rgba(255, 77, 26, 0.3)', borderRadius: '12px', padding: '24px', width: '500px', maxWidth: '90%', display: 'flex', flexDirection: 'column', gap: '16px', color: '#fff', boxShadow: '0 8px 32px rgba(255, 77, 26, 0.15)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h2 style={{ margin: 0, fontSize: '20px', color: 'var(--neon)' }}>
                {isFounder 
                  ? 'Establish Crew Community' 
                  : communityCreationStep === 1 
                    ? 'Establish Crew Community' 
                    : 'Configure Community Details'}
              </h2>
              <button 
                onClick={() => {
                  setIsCommunityModalOpen(false);
                  setCommunityCreationStep(1);
                  setActiveOrderId(null);
                  setNewCommunityName('');
                  setNewCommunityDesc('');
                }} 
                style={{ background: 'transparent', border: 'none', color: '#aaa', fontSize: '18px', cursor: 'pointer' }}
              >
                ✕
              </button>
            </div>
            
            {!isFounder && communityCreationStep === 1 && (
              <>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <label style={{ fontSize: '12px', color: '#aaa', textTransform: 'uppercase' }}>Select Community Tier</label>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px' }}>
                    <div 
                      onClick={() => setSelectedPlan('Starter')}
                      style={{ border: `1px solid ${selectedPlan === 'Starter' ? 'var(--neon)' : 'rgba(255,255,255,0.1)'}`, background: selectedPlan === 'Starter' ? 'rgba(255,77,26,0.08)' : 'rgba(255,255,255,0.02)', padding: '12px', borderRadius: '8px', cursor: 'pointer', textAlign: 'center', transition: 'border-color 0.2s' }}
                    >
                      <div style={{ fontWeight: 'bold', fontSize: '14px' }}>Starter</div>
                      <div style={{ fontSize: '11px', color: '#aaa', margin: '4px 0' }}>20 Members</div>
                      <div style={{ fontSize: '14px', color: 'var(--neon)', fontWeight: 'bold' }}>₹{pricingConfigs.find(c => c.plan_type === 'Starter')?.base_price || '59'} / 3 Months</div>
                    </div>
                    <div 
                      onClick={() => setSelectedPlan('Growth')}
                      style={{ border: `1px solid ${selectedPlan === 'Growth' ? 'var(--neon)' : 'rgba(255,255,255,0.1)'}`, background: selectedPlan === 'Growth' ? 'rgba(255,77,26,0.08)' : 'rgba(255,255,255,0.02)', padding: '12px', borderRadius: '8px', cursor: 'pointer', textAlign: 'center', transition: 'border-color 0.2s' }}
                    >
                      <div style={{ fontWeight: 'bold', fontSize: '14px' }}>Growth</div>
                      <div style={{ fontSize: '11px', color: '#aaa', margin: '4px 0' }}>35 Members</div>
                      <div style={{ fontSize: '14px', color: 'var(--neon)', fontWeight: 'bold' }}>₹{pricingConfigs.find(c => c.plan_type === 'Growth')?.base_price || '99'} / 3 Months</div>
                    </div>
                    <div 
                      onClick={() => setSelectedPlan('Custom')}
                      style={{ border: `1px solid ${selectedPlan === 'Custom' ? 'var(--neon)' : 'rgba(255,255,255,0.1)'}`, background: selectedPlan === 'Custom' ? 'rgba(255,77,26,0.08)' : 'rgba(255,255,255,0.02)', padding: '12px', borderRadius: '8px', cursor: 'pointer', textAlign: 'center', transition: 'border-color 0.2s' }}
                    >
                      <div style={{ fontWeight: 'bold', fontSize: '14px' }}>Custom</div>
                      <div style={{ fontSize: '11px', color: '#aaa', margin: '4px 0' }}>Dynamic Scaling</div>
                      <div style={{ fontSize: '14px', color: 'var(--neon)', fontWeight: 'bold' }}>
                        ₹{(() => {
                          const customCfg = pricingConfigs.find(c => c.plan_type === 'Custom');
                          const base = customCfg ? Number(customCfg.base_price) : 99;
                          const per = customCfg ? Number(customCfg.per_member_price) : 2;
                          return base + (customMembersCount * per);
                        })()} / 3 Months
                      </div>
                    </div>
                  </div>
                </div>

                {selectedPlan === 'Custom' && (() => {
                  const customCfg = pricingConfigs.find(c => c.plan_type === 'Custom');
                  const basePrice = customCfg ? Number(customCfg.base_price) : 99;
                  const perMemberPrice = customCfg ? Number(customCfg.per_member_price) : 2;
                  const maxLimit = customCfg ? Number(customCfg.max_members) : 1000;
                  const calculatedPrice = basePrice + (customMembersCount * perMemberPrice);
                  const isInvalid = isNaN(customMembersCount) || customMembersCount < 1 || customMembersCount > maxLimit;

                  return (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)', borderRadius: '8px', padding: '16px', marginTop: '8px' }}>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                        <label style={{ fontSize: '12px', color: '#aaa', textTransform: 'uppercase' }}>Desired Members</label>
                        <input 
                          type="number" 
                          min={1}
                          max={maxLimit}
                          value={customMembersCount}
                          onChange={(e) => setCustomMembersCount(parseInt(e.target.value) || 0)}
                          style={{ padding: '8px 12px', background: 'rgba(255,255,255,0.05)', border: `1px solid ${isInvalid ? '#ff4d1a' : 'rgba(255,255,255,0.1)'}`, borderRadius: '6px', color: '#fff', fontSize: '14px', width: '100%' }}
                        />
                        {isInvalid && (
                          <div style={{ fontSize: '11px', color: '#ff4d1a', marginTop: '2px' }}>
                            {customMembersCount < 1 ? 'Minimum 1 member required' : `Maximum limit is ${maxLimit} members`}
                          </div>
                        )}
                      </div>

                      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: '10px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', color: '#aaa' }}>
                          <span>Base Price:</span>
                          <span>₹{basePrice}</span>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', color: '#aaa' }}>
                          <span>Per Member Charge:</span>
                          <span>₹{perMemberPrice}</span>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', color: '#aaa' }}>
                          <span>Member Multiplier:</span>
                          <span>{customMembersCount} × ₹{perMemberPrice} = ₹{customMembersCount * perMemberPrice}</span>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '14px', fontWeight: 'bold', color: 'var(--neon)', borderTop: '1px dotted rgba(255,255,255,0.1)', paddingTop: '6px', marginTop: '4px' }}>
                          <span>Total Price:</span>
                          <span>₹{calculatedPrice} / 3 Months</span>
                        </div>
                      </div>
                    </div>
                  );
                })()}

                <div style={{ borderTop: '1px solid rgba(255,255,255,0.1)', paddingTop: '16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <span style={{ fontSize: '12px', color: '#aaa' }}>Total Due (3 Months Subscription):</span>
                      <div style={{ fontSize: '20px', fontWeight: 'bold', color: 'var(--neon)' }}>
                        ₹{selectedPlan === 'Starter' 
                          ? (pricingConfigs.find(c => c.plan_type === 'Starter')?.base_price || '59') 
                          : selectedPlan === 'Growth' 
                            ? (pricingConfigs.find(c => c.plan_type === 'Growth')?.base_price || '99') 
                            : (() => {
                                const customCfg = pricingConfigs.find(c => c.plan_type === 'Custom');
                                const base = customCfg ? Number(customCfg.base_price) : 99;
                                const per = customCfg ? Number(customCfg.per_member_price) : 2;
                                return base + (customMembersCount * per);
                              })()}
                      </div>
                    </div>
                    <button 
                      onClick={handlePricingProceed}
                      disabled={selectedPlan === 'Custom' && (isNaN(customMembersCount) || customMembersCount < 1 || customMembersCount > (pricingConfigs.find(c => c.plan_type === 'Custom')?.max_members || 1000))}
                      style={{ 
                        background: (selectedPlan === 'Custom' && (isNaN(customMembersCount) || customMembersCount < 1 || customMembersCount > (pricingConfigs.find(c => c.plan_type === 'Custom')?.max_members || 1000))) ? '#555' : 'var(--neon)', 
                        border: 'none', 
                        padding: '12px 24px', 
                        borderRadius: '6px', 
                        color: '#fff', 
                        fontWeight: 'bold', 
                        cursor: (selectedPlan === 'Custom' && (isNaN(customMembersCount) || customMembersCount < 1 || customMembersCount > (pricingConfigs.find(c => c.plan_type === 'Custom')?.max_members || 1000))) ? 'not-allowed' : 'pointer', 
                        transition: 'filter 0.2s' 
                      }}
                      onMouseOver={(e) => {
                        if (!(selectedPlan === 'Custom' && (isNaN(customMembersCount) || customMembersCount < 1 || customMembersCount > (pricingConfigs.find(c => c.plan_type === 'Custom')?.max_members || 1000)))) {
                          e.currentTarget.style.filter = 'brightness(1.1)';
                        }
                      }}
                      onMouseOut={(e) => e.currentTarget.style.filter = 'brightness(1.0)'}
                    >
                      Proceed to Payment
                    </button>
                  </div>
                  <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.6)', background: 'rgba(255, 77, 26, 0.05)', border: '1px solid rgba(255, 77, 26, 0.2)', padding: '10px', borderRadius: '6px', lineHeight: '1.4' }}>
                    <strong>Subscription Interval:</strong> Community subscriptions are charged once every 3 months. The payment covers full access to the selected member tier for a 3-month cycle.
                  </div>
                </div>
              </>
            )}

            {(isFounder || communityCreationStep === 2) && (
              <>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <label style={{ fontSize: '12px', color: '#aaa', textTransform: 'uppercase' }}>Community Name</label>
                  <input 
                    type="text" 
                    placeholder="e.g. Dream Team Productions" 
                    value={newCommunityName}
                    onChange={(e) => setNewCommunityName(e.target.value)}
                    style={{ padding: '10px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '6px', color: '#fff', fontSize: '14px' }}
                  />
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <label style={{ fontSize: '12px', color: '#aaa', textTransform: 'uppercase' }}>Description</label>
                  <textarea 
                    placeholder="Describe your community..." 
                    value={newCommunityDesc}
                    onChange={(e) => setNewCommunityDesc(e.target.value)}
                    rows={4}
                    style={{ padding: '10px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '6px', color: '#fff', fontSize: '14px', resize: 'none' }}
                  />
                </div>

                <div style={{ borderTop: '1px solid rgba(255,255,255,0.1)', paddingTop: '16px', display: 'flex', justifyContent: 'flex-end', gap: '12px', alignItems: 'center' }}>
                  <button 
                    onClick={isFounder ? handleFounderCreateCommunity : handleInstantiateCommunity}
                    disabled={groupLoading}
                    style={{ background: groupLoading ? '#555' : 'var(--neon)', border: 'none', padding: '12px 24px', borderRadius: '6px', color: '#fff', fontWeight: 'bold', cursor: groupLoading ? 'not-allowed' : 'pointer', transition: 'filter 0.2s' }}
                    onMouseOver={(e) => {
                      if (!groupLoading) e.currentTarget.style.filter = 'brightness(1.1)';
                    }}
                    onMouseOut={(e) => e.currentTarget.style.filter = 'brightness(1.0)'}
                  >
                    {groupLoading ? 'Establishing...' : 'Finalize & Launch Community'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {isCreatePostOpen && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.85)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1000, backdropFilter: 'blur(8px)' }}>
          <div style={{ background: '#121212', border: '1px solid rgba(255, 77, 26, 0.3)', borderRadius: '12px', padding: '24px', width: '500px', maxWidth: '90%', display: 'flex', flexDirection: 'column', gap: '16px', color: '#fff', boxShadow: '0 8px 32px rgba(255, 77, 26, 0.15)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h2 style={{ margin: 0, fontSize: '20px', color: 'var(--neon)', fontFamily: 'var(--font-mono)', textTransform: 'uppercase' }}>Create Community Post</h2>
              <button onClick={() => { setIsCreatePostOpen(false); setPostCaption(''); setPostFiles(null); }} style={{ background: 'transparent', border: 'none', color: '#aaa', fontSize: '18px', cursor: 'pointer' }}>✕</button>
            </div>
            <form onSubmit={handleCreatePost} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <label style={{ fontSize: '12px', color: '#aaa', textTransform: 'uppercase' }}>Caption / Update Details</label>
                <textarea 
                  placeholder="Share what is happening behind-the-scenes, announcements, hashtags..." 
                  value={postCaption}
                  onChange={(e) => setPostCaption(e.target.value)}
                  rows={4}
                  style={{
                    background: 'rgba(0,0,0,0.3)',
                    border: '1px solid rgba(255,255,255,0.1)',
                    borderRadius: '6px',
                    padding: '10px',
                    color: '#fff',
                    fontSize: '13px',
                    fontFamily: 'inherit',
                    resize: 'vertical'
                  }}
                />
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <label style={{ fontSize: '12px', color: '#aaa', textTransform: 'uppercase' }}>Images (Select up to 10)</label>
                <input 
                  type="file" 
                  multiple 
                  accept="image/*"
                  onChange={(e) => setPostFiles(e.target.files)}
                  style={{
                    color: '#ccc',
                    fontSize: '13px'
                  }}
                />
                {postFiles && postFiles.length > 0 && (
                  <div style={{ fontSize: '11px', color: 'var(--neon)', marginTop: '4px' }}>
                    Selected {postFiles.length} file(s) ready to upload.
                  </div>
                )}
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', marginTop: '10px' }}>
                <button 
                  type="button"
                  onClick={() => { setIsCreatePostOpen(false); setPostCaption(''); setPostFiles(null); }}
                  style={{ background: 'transparent', border: '1px solid rgba(255,255,255,0.1)', color: '#ccc', padding: '8px 16px', borderRadius: '6px', cursor: 'pointer', fontSize: '13px' }}
                >
                  Cancel
                </button>
                <button 
                  type="submit"
                  style={{ background: 'var(--neon)', border: 'none', color: '#fff', padding: '8px 24px', borderRadius: '6px', fontWeight: 'bold', cursor: 'pointer', fontSize: '13px' }}
                >
                  Publish Post
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {isInviteModalOpen && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.8)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1000, backdropFilter: 'blur(6px)' }}>
          <div style={{ background: '#121212', border: '1px solid rgba(255, 77, 26, 0.3)', borderRadius: '12px', padding: '24px', width: '450px', maxWidth: '90%', display: 'flex', flexDirection: 'column', gap: '16px', color: '#fff' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ margin: 0, fontSize: '18px', color: 'var(--neon)' }}>Invite Members</h3>
              <button onClick={() => { setIsInviteModalOpen(false); setUserSearchQuery(''); setUserSearchResults([]); setInviteError(''); setInviteSuccess(''); }} style={{ background: 'transparent', border: 'none', color: '#aaa', fontSize: '18px', cursor: 'pointer' }}>✕</button>
            </div>
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <label style={{ fontSize: '12px', color: '#aaa' }}>Search Platform Users</label>
              <input 
                type="text" 
                placeholder="Search by name, username, or role..." 
                value={userSearchQuery}
                onChange={(e) => handleUserSearch(e.target.value)}
                style={{ padding: '10px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '6px', color: '#fff', fontSize: '14px' }}
              />
            </div>

            {userSearchLoading && <div style={{ fontSize: '12px', color: 'var(--neon)', textAlign: 'center' }}>Searching users...</div>}

            <div style={{ maxHeight: '250px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {userSearchResults.map((user: any) => (
                <div 
                  key={user.id} 
                  style={{ 
                    display: 'flex', 
                    alignItems: 'center', 
                    justifyContent: 'space-between', 
                    padding: '8px 12px', 
                    background: 'rgba(255,255,255,0.02)', 
                    border: '1px solid rgba(255,255,255,0.05)', 
                    borderRadius: '8px' 
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    {user.avatar_url ? (
                      <img src={user.avatar_url} alt={user.name} style={{ width: '40px', height: '40px', borderRadius: '50%', objectFit: 'cover' }} />
                    ) : (
                      <div style={{ width: '40px', height: '40px', borderRadius: '50%', background: 'rgba(255,77,26,0.1)', border: '1px solid var(--neon)', display: 'flex', justifyContent: 'center', alignItems: 'center', fontWeight: 'bold', color: 'var(--neon)', fontSize: '14px' }}>
                        {user.name.charAt(0).toUpperCase()}
                      </div>
                    )}
                    <div>
                      <div style={{ fontWeight: 'bold', fontSize: '14px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                        {user.name}
                        {user.email_verified === true && (
                          <span title="Verified User" style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: 'var(--neon)', color: '#000', borderRadius: '50%', width: '14px', height: '14px', fontSize: '8px', fontWeight: 'bold' }}>✓</span>
                        )}
                      </div>
                      <div style={{ fontSize: '11px', color: '#888' }}>
                        @{user.screen_name || 'username'} • {user.role || 'Member'}
                      </div>
                    </div>
                  </div>
                  <button 
                    onClick={() => handleInviteMember(user.id)}
                    disabled={inviteLoading}
                    style={{ 
                      background: 'rgba(255, 77, 26, 0.15)', 
                      border: '1px solid var(--neon)', 
                      padding: '6px 12px', 
                      borderRadius: '4px', 
                      color: '#fff', 
                      fontSize: '12px', 
                      fontWeight: 'bold', 
                      cursor: 'pointer' 
                    }}
                  >
                    Invite
                  </button>
                </div>
              ))}
              {!userSearchLoading && userSearchQuery && userSearchResults.length === 0 && (
                <div style={{ fontSize: '12px', color: '#aaa', textAlign: 'center', padding: '16px' }}>No users found matching "{userSearchQuery}"</div>
              )}
            </div>

            {inviteError && <div style={{ color: '#ff4d4d', fontSize: '12px', textAlign: 'center' }}>{inviteError}</div>}
            {inviteSuccess && <div style={{ color: '#4dff4d', fontSize: '12px', textAlign: 'center' }}>{inviteSuccess}</div>}
          </div>
        </div>
      )}

      {isCreateGroupModalOpen && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.8)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1000, backdropFilter: 'blur(6px)' }}>
          <div style={{ background: '#121212', border: '1px solid rgba(255, 77, 26, 0.3)', borderRadius: '12px', padding: '24px', width: '400px', maxWidth: '90%', display: 'flex', flexDirection: 'column', gap: '16px', color: '#fff' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ margin: 0, fontSize: '18px', color: 'var(--neon)' }}>Create Community Group</h3>
              <button onClick={() => setIsCreateGroupModalOpen(false)} style={{ background: 'transparent', border: 'none', color: '#aaa', fontSize: '18px', cursor: 'pointer' }}>✕</button>
            </div>
            <form onSubmit={handleCreateCommunityGroup} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <label style={{ fontSize: '12px', color: '#aaa' }}>Group Name</label>
                <input 
                  type="text" 
                  required 
                  placeholder="e.g. marketing-discussion" 
                  value={newGroupName}
                  onChange={(e) => setNewGroupName(e.target.value)}
                  style={{ padding: '10px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '6px', color: '#fff' }}
                />
              </div>
              <button 
                type="submit" 
                disabled={groupLoading}
                style={{ background: 'var(--neon)', border: 'none', padding: '10px', borderRadius: '6px', color: '#fff', fontWeight: 'bold', cursor: 'pointer' }}
              >
                {groupLoading ? 'Creating...' : 'Create Group'}
              </button>
            </form>
          </div>
        </div>
      )}

      {isJoinRequestModalOpen && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.85)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1010, backdropFilter: 'blur(8px)' }}>
          <div style={{ background: '#121212', border: '1px solid rgba(255, 77, 26, 0.3)', borderRadius: '12px', padding: '24px', width: '600px', maxWidth: '90%', display: 'flex', flexDirection: 'column', gap: '20px', color: '#fff', boxShadow: '0 8px 32px rgba(255, 77, 26, 0.15)', maxHeight: '80vh' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h2 style={{ margin: 0, fontSize: '20px', color: 'var(--neon)', fontFamily: 'Bebas Neue', letterSpacing: '0.05em' }}>
                📋 My Community Requests
              </h2>
              <button 
                onClick={() => setIsJoinRequestModalOpen(false)} 
                style={{ background: 'transparent', border: 'none', color: '#aaa', fontSize: '18px', cursor: 'pointer' }}
              >
                ✕
              </button>
            </div>
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', overflowY: 'auto', flex: 1, paddingRight: '4px' }}>
              {/* PENDING REQUESTS */}
              <div>
                <h3 style={{ fontSize: '14px', textTransform: 'uppercase', color: 'var(--neon)', borderBottom: '1px solid rgba(255,77,26,0.2)', paddingBottom: '6px', marginBottom: '12px' }}>
                  Pending Requests
                </h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {myRequests.filter(r => r.status === 'PENDING').map(req => (
                    <div key={req.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'rgba(255,255,255,0.02)', padding: '10px 16px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.05)' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                        {req.community?.avatar_url ? (
                          <img src={req.community.avatar_url} alt="" style={{ width: '36px', height: '36px', borderRadius: '6px', objectFit: 'cover' }} />
                        ) : (
                          <div style={{ width: '36px', height: '36px', borderRadius: '6px', background: 'rgba(255,77,26,0.1)', display: 'flex', justifyContent: 'center', alignItems: 'center', fontSize: '14px', fontWeight: 'bold', color: 'var(--neon)' }}>
                            {req.community?.name?.charAt(0).toUpperCase()}
                          </div>
                        )}
                        <div>
                          <div style={{ fontWeight: 'bold', fontSize: '14px' }}>{req.community?.name}</div>
                          <div style={{ fontSize: '11px', color: '#888' }}>Requested: {new Date(req.createdAt).toLocaleDateString()}</div>
                        </div>
                      </div>
                      <span className="request-badge pending" style={{ fontSize: '11px', padding: '4px 8px' }}>Pending</span>
                    </div>
                  ))}
                  {myRequests.filter(r => r.status === 'PENDING').length === 0 && (
                    <div style={{ fontSize: '12px', color: '#666', fontStyle: 'italic' }}>No pending requests.</div>
                  )}
                </div>
              </div>

              {/* ACCEPTED REQUESTS */}
              <div>
                <h3 style={{ fontSize: '14px', textTransform: 'uppercase', color: '#4dff4d', borderBottom: '1px solid rgba(77,255,77,0.2)', paddingBottom: '6px', marginBottom: '12px' }}>
                  Accepted Requests
                </h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {myRequests.filter(r => r.status === 'ACCEPTED').map(req => (
                    <div key={req.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'rgba(255,255,255,0.02)', padding: '10px 16px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.05)' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                        {req.community?.avatar_url ? (
                          <img src={req.community.avatar_url} alt="" style={{ width: '36px', height: '36px', borderRadius: '6px', objectFit: 'cover' }} />
                        ) : (
                          <div style={{ width: '36px', height: '36px', borderRadius: '6px', background: 'rgba(77,255,77,0.1)', display: 'flex', justifyContent: 'center', alignItems: 'center', fontSize: '14px', fontWeight: 'bold', color: '#4dff4d' }}>
                            {req.community?.name?.charAt(0).toUpperCase()}
                          </div>
                        )}
                        <div>
                          <div style={{ fontWeight: 'bold', fontSize: '14px' }}>{req.community?.name}</div>
                          <div style={{ fontSize: '11px', color: '#888' }}>Accepted: {new Date(req.updatedAt || req.createdAt).toLocaleDateString()}</div>
                        </div>
                      </div>
                      <button
                        onClick={async () => {
                          setIsJoinRequestModalOpen(false);
                          const communities = await fetchMyCommunity();
                          if (communities && communities.length > 0) {
                            const joined = communities.find((c: any) => c.id === req.community.id);
                            if (joined) {
                              handleNavigateToCommunity(joined);
                            } else {
                              handleNavigateToCommunity(communities[0]);
                            }
                          }
                        }}
                        className="nav-cta"
                        style={{ padding: '6px 12px', fontSize: '11px', borderRadius: '4px', background: '#4dff4d', color: '#000', border: 'none' }}
                      >
                        Join Community
                      </button>
                    </div>
                  ))}
                  {myRequests.filter(r => r.status === 'ACCEPTED').length === 0 && (
                    <div style={{ fontSize: '12px', color: '#666', fontStyle: 'italic' }}>No accepted requests yet.</div>
                  )}
                </div>
              </div>

              {/* REJECTED REQUESTS */}
              <div>
                <h3 style={{ fontSize: '14px', textTransform: 'uppercase', color: '#ff4d4d', borderBottom: '1px solid rgba(255,77,24,0.2)', paddingBottom: '6px', marginBottom: '12px' }}>
                  Rejected Requests
                </h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {myRequests.filter(r => r.status === 'REJECTED').map(req => (
                    <div key={req.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'rgba(255,255,255,0.02)', padding: '10px 16px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.05)' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                        {req.community?.avatar_url ? (
                          <img src={req.community.avatar_url} alt="" style={{ width: '36px', height: '36px', borderRadius: '6px', objectFit: 'cover' }} />
                        ) : (
                          <div style={{ width: '36px', height: '36px', borderRadius: '6px', background: 'rgba(255,77,77,0.1)', display: 'flex', justifyContent: 'center', alignItems: 'center', fontSize: '14px', fontWeight: 'bold', color: '#ff4d4d' }}>
                            {req.community?.name?.charAt(0).toUpperCase()}
                          </div>
                        )}
                        <div>
                          <div style={{ fontWeight: 'bold', fontSize: '14px' }}>{req.community?.name}</div>
                          <div style={{ fontSize: '11px', color: '#888' }}>Rejected: {new Date(req.updatedAt || req.createdAt).toLocaleDateString()}</div>
                        </div>
                      </div>
                      <span className="request-badge rejected" style={{ fontSize: '11px', padding: '4px 8px' }}>Rejected</span>
                    </div>
                  ))}
                  {myRequests.filter(r => r.status === 'REJECTED').length === 0 && (
                    <div style={{ fontSize: '12px', color: '#666', fontStyle: 'italic' }}>No rejected requests.</div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {isInvitationsManagementModalOpen && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.85)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1010, backdropFilter: 'blur(8px)' }}>
          <div style={{ background: '#121212', border: '1px solid rgba(255, 77, 26, 0.3)', borderRadius: '12px', padding: '24px', width: '650px', maxWidth: '95%', display: 'flex', flexDirection: 'column', gap: '20px', color: '#fff', boxShadow: '0 8px 32px rgba(255, 77, 26, 0.15)', maxHeight: '80vh' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h2 style={{ margin: 0, fontSize: '20px', color: 'var(--neon)', fontFamily: 'Bebas Neue', letterSpacing: '0.05em' }}>
                ✉️ Community Invitations Dashboard
              </h2>
              <button 
                onClick={() => setIsInvitationsManagementModalOpen(false)} 
                style={{ background: 'transparent', border: 'none', color: '#aaa', fontSize: '18px', cursor: 'pointer' }}
              >
                ✕
              </button>
            </div>
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', overflowY: 'auto', flex: 1, paddingRight: '4px' }}>
              {invitationsLoading ? (
                <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '150px', color: 'var(--neon)', fontSize: '14px' }}>
                  Loading invitations...
                </div>
              ) : invitationsList.length === 0 ? (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '150px', color: '#666', fontStyle: 'italic', gap: '8px' }}>
                  <span>No invitations found for this community.</span>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  {invitationsList.map((inv: any) => {
                    const isExpired = inv.expiresAt ? new Date(inv.expiresAt) < new Date() : false;
                    const canCancel = inv.status === 'PENDING' && !isExpired;
                    const canResend = inv.status === 'PENDING' || inv.status === 'CANCELLED' || isExpired;

                    return (
                      <div 
                        key={inv.id} 
                        style={{ 
                          display: 'flex', 
                          flexDirection: 'column', 
                          gap: '10px', 
                          background: 'rgba(255,255,255,0.02)', 
                          padding: '12px 16px', 
                          borderRadius: '8px', 
                          border: '1px solid rgba(255,255,255,0.05)',
                          transition: 'border-color 0.2s ease-in-out' 
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '8px' }}>
                          <div>
                            <div style={{ fontWeight: 'bold', fontSize: '14px', color: 'var(--cream)' }}>
                              Invited: {inv.invitee ? `${inv.invitee.name} (@${inv.invitee.screen_name})` : inv.email}
                            </div>
                            <div style={{ fontSize: '11px', color: '#888', marginTop: '4px' }}>
                              Sent by: <strong>{inv.inviter?.name || 'Owner'}</strong> • Created: {new Date(inv.createdAt).toLocaleDateString()}
                            </div>
                            {inv.expiresAt && (
                              <div style={{ fontSize: '11px', color: isExpired ? '#ff4d4d' : '#888', marginTop: '2px' }}>
                                {isExpired ? 'Expired' : `Expires: ${new Date(inv.expiresAt).toLocaleString()}`}
                              </div>
                            )}
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <span 
                              style={{ 
                                fontSize: '10px', 
                                padding: '3px 8px', 
                                borderRadius: '12px', 
                                fontWeight: 'bold',
                                textTransform: 'uppercase',
                                background: isExpired 
                                  ? 'rgba(255,77,77,0.1)' 
                                  : inv.status === 'ACCEPTED' 
                                    ? 'rgba(77,255,77,0.1)' 
                                    : inv.status === 'REJECTED' 
                                      ? 'rgba(255,77,77,0.1)' 
                                      : 'rgba(255,255,255,0.05)',
                                color: isExpired 
                                  ? '#ff4d4d' 
                                  : inv.status === 'ACCEPTED' 
                                    ? '#4dff4d' 
                                    : inv.status === 'REJECTED' 
                                      ? '#ff4d4d' 
                                      : '#e8e8e0',
                                border: `1px solid ${
                                  isExpired 
                                    ? 'rgba(255,77,77,0.2)' 
                                    : inv.status === 'ACCEPTED' 
                                      ? 'rgba(77,255,77,0.2)' 
                                      : inv.status === 'REJECTED' 
                                        ? 'rgba(255,77,77,0.2)' 
                                        : 'rgba(255,255,255,0.1)'
                                }`
                              }}
                            >
                              {isExpired ? 'EXPIRED' : inv.status}
                            </span>
                          </div>
                        </div>

                        {/* Actions */}
                        {(canCancel || canResend) && (
                          <div style={{ display: 'flex', gap: '8px', borderTop: '1px solid rgba(255,255,255,0.03)', paddingTop: '8px', marginTop: '4px' }}>
                            {canCancel && (
                              <button
                                onClick={() => cancelInvitation(inv.id)}
                                style={{ 
                                  padding: '5px 12px', 
                                  fontSize: '11px', 
                                  borderRadius: '4px', 
                                  background: 'transparent', 
                                  color: '#ff4d4d', 
                                  border: '1px solid rgba(255,77,77,0.3)', 
                                  fontWeight: 'bold', 
                                  cursor: 'pointer',
                                  transition: 'all 0.2s' 
                                }}
                              >
                                Cancel Invitation
                              </button>
                            )}
                            {canResend && (
                              <button
                                onClick={() => resendInvitation(inv.id)}
                                style={{ 
                                  padding: '5px 12px', 
                                  fontSize: '11px', 
                                  borderRadius: '4px', 
                                  background: 'rgba(255,77,26,0.15)', 
                                  color: '#fff', 
                                  border: '1px solid var(--neon)', 
                                  fontWeight: 'bold', 
                                  cursor: 'pointer',
                                  transition: 'all 0.2s' 
                                }}
                              >
                                Resend Invitation
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {showAutoInviteModal && autoInviteToHandle && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.85)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1020, backdropFilter: 'blur(8px)' }}>
          <div style={{ background: '#121212', border: '1px solid var(--neon)', borderRadius: '12px', padding: '30px', width: '450px', maxWidth: '90%', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '24px', color: '#fff', textAlign: 'center', boxShadow: '0 8px 32px rgba(255, 77, 26, 0.25)' }}>
            <div>
              <div style={{ fontSize: '40px', marginBottom: '16px' }}>✉️</div>
              <h2 style={{ margin: '0 0 8px 0', fontSize: '22px', color: 'var(--cream)', fontFamily: 'Bebas Neue', letterSpacing: '0.05em' }}>
                You're Invited!
              </h2>
              <p style={{ margin: 0, fontSize: '14px', color: '#aaa', lineHeight: '1.5' }}>
                You have been invited to join the <strong>{autoInviteToHandle.community?.name}</strong> community.
              </p>
            </div>

            {autoInviteToHandle.community?.logo_url ? (
              <img src={cacheBustUrl(autoInviteToHandle.community.logo_url, autoInviteToHandle.community.updated_at)} alt="" style={{ width: '80px', height: '80px', borderRadius: '12px', objectFit: 'cover', border: '1px solid rgba(255,255,255,0.1)' }} />
            ) : (
              <div style={{ width: '80px', height: '80px', borderRadius: '12px', background: 'rgba(255,77,26,0.1)', border: '1px solid var(--neon)', display: 'flex', justifyContent: 'center', alignItems: 'center', fontSize: '32px', fontWeight: 'bold', color: 'var(--neon)' }}>
                {autoInviteToHandle.community?.name?.charAt(0).toUpperCase()}
              </div>
            )}

            {autoInviteToHandle.inviter && (
              <div style={{ fontSize: '13px', color: '#888', background: 'rgba(255,255,255,0.02)', padding: '8px 16px', borderRadius: '20px', border: '1px solid rgba(255,255,255,0.05)' }}>
                Invited by: <strong>{autoInviteToHandle.inviter.name}</strong> (@{autoInviteToHandle.inviter.screen_name})
              </div>
            )}

            <div style={{ display: 'flex', gap: '12px', width: '100%' }}>
              <button
                onClick={() => handleRejectInvite(autoInviteToHandle.id)}
                style={{ flex: 1, padding: '12px', borderRadius: '6px', background: 'transparent', border: '1px solid rgba(255,255,255,0.1)', color: '#fff', fontWeight: 'bold', cursor: 'pointer', transition: 'all 0.2s' }}
              >
                Decline
              </button>
              <button
                onClick={() => handleAcceptInvite(autoInviteToHandle.id)}
                style={{ flex: 1, padding: '12px', borderRadius: '6px', background: 'var(--neon)', border: 'none', color: '#fff', fontWeight: 'bold', cursor: 'pointer', transition: 'all 0.2s' }}
              >
                Accept Invite
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
