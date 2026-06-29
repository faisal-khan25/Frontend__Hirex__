/**
 * LiveInterviewInviteCard.jsx
 *
 * NEW FILE
 *
 * The floating notification card that appears on the applicant's dashboard
 * when a recruiter starts a live interview.
 *
 * Shows:
 *   - "Live Interview Started"
 *   - Company name
 *   - Recruiter name
 *   - Job title
 *   - [Join Interview] button  → navigates to /live-interview/candidate/{token}
 *   - [✕] dismiss button
 *
 * Usage in MyApplications.jsx:
 *   import LiveInterviewInviteCard from '../../components/LiveInterviewInviteCard';
 *   import { useLiveInterviewNotification } from '../../hooks/useLiveInterviewNotification';
 *
 *   const { invite, clearInvite } = useLiveInterviewNotification(authToken);
 *   ...
 *   {invite && (
 *     <LiveInterviewInviteCard invite={invite} onDismiss={clearInvite} />
 *   )}
 */

import React, { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';

// Inline styles are used so this component has zero extra CSS dependencies.
const styles = {
  overlay: {
    position: 'fixed',
    top: 0,
    left: 0,
    width: '100%',
    height: '100%',
    background: 'rgba(0,0,0,0.45)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 9999,
    backdropFilter: 'blur(2px)',
  },
  card: {
    background: '#fff',
    borderRadius: 16,
    boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
    padding: '32px 36px',
    maxWidth: 420,
    width: '92%',
    position: 'relative',
    animation: 'slideUp 0.25s ease-out',
    textAlign: 'center',
  },
  badge: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    background: '#fee2e2',
    color: '#dc2626',
    borderRadius: 999,
    padding: '4px 14px',
    fontSize: 12,
    fontWeight: 700,
    letterSpacing: 0.5,
    marginBottom: 14,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: '50%',
    background: '#dc2626',
    animation: 'pulse 1.2s infinite',
  },
  title: {
    fontSize: 20,
    fontWeight: 700,
    color: '#111827',
    marginBottom: 6,
  },
  company: {
    fontSize: 16,
    fontWeight: 600,
    color: '#4f46e5',
    marginBottom: 4,
  },
  meta: {
    fontSize: 14,
    color: '#6b7280',
    marginBottom: 24,
  },
  joinBtn: {
    width: '100%',
    padding: '14px 0',
    borderRadius: 10,
    background: 'linear-gradient(135deg, #4f46e5, #7c3aed)',
    color: '#fff',
    fontSize: 16,
    fontWeight: 700,
    border: 'none',
    cursor: 'pointer',
    marginBottom: 10,
    transition: 'opacity 0.15s',
  },
  dismissBtn: {
    background: 'none',
    border: 'none',
    color: '#9ca3af',
    fontSize: 13,
    cursor: 'pointer',
    textDecoration: 'underline',
  },
  closeBtn: {
    position: 'absolute',
    top: 14,
    right: 14,
    background: 'none',
    border: 'none',
    fontSize: 18,
    color: '#9ca3af',
    cursor: 'pointer',
    lineHeight: 1,
  },
};

// Keyframes injected once
const KEYFRAMES = `
@keyframes slideUp {
  from { opacity: 0; transform: translateY(30px); }
  to   { opacity: 1; transform: translateY(0); }
}
@keyframes pulse {
  0%, 100% { opacity: 1; }
  50%       { opacity: 0.3; }
}
`;

let injected = false;
function injectKeyframes() {
  if (injected) return;
  const style = document.createElement('style');
  style.textContent = KEYFRAMES;
  document.head.appendChild(style);
  injected = true;
}

/**
 * @param {{ invite: object, onDismiss: () => void }} props
 */
export default function LiveInterviewInviteCard({ invite, onDismiss }) {
  const navigate    = useNavigate();
  const hasInjected = useRef(false);

  useEffect(() => {
    if (!hasInjected.current) {
      injectKeyframes();
      hasInjected.current = true;
    }
  }, []);

  if (!invite) return null;

  const handleJoin = () => {
    onDismiss();
    navigate(`/live-interview/candidate/${invite.sessionToken}`);
  };

  return (
    <div style={styles.overlay} onClick={onDismiss}>
      {/* Stop click-through to overlay */}
      <div style={styles.card} onClick={(e) => e.stopPropagation()}>
        <button style={styles.closeBtn} onClick={onDismiss} aria-label="Dismiss">✕</button>

        {/* LIVE badge */}
        <div style={styles.badge}>
          <span style={styles.dot} />
          LIVE NOW
        </div>

        <div style={styles.title}>🎥 Live Interview Started</div>

        <div style={styles.company}>{invite.companyName || 'Company'}</div>

        <div style={styles.meta}>
          {invite.recruiterName && (
            <div>Recruiter: <strong>{invite.recruiterName}</strong></div>
          )}
          {invite.jobTitle && (
            <div style={{ marginTop: 2 }}>Role: <strong>{invite.jobTitle}</strong></div>
          )}
        </div>

        <button
          style={styles.joinBtn}
          onClick={handleJoin}
          onMouseEnter={e => (e.target.style.opacity = '0.9')}
          onMouseLeave={e => (e.target.style.opacity = '1')}
        >
          🚀 Join Interview
        </button>

        <button style={styles.dismissBtn} onClick={onDismiss}>
          I'll join later
        </button>
      </div>
    </div>
  );
}
