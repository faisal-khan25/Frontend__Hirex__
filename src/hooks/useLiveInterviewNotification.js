/**
 * useLiveInterviewNotification.js
 *
 * NEW FILE — handles real-time WebSocket notification for the applicant.
 *
 * What it does:
 *   1. Connects to the STOMP/SockJS WebSocket with the applicant's JWT.
 *   2. Subscribes to /user/queue/live-interview-invite.
 *   3. Exposes:
 *        invite    — the current active invite object, or null
 *        clearInvite — dismiss the invite card manually
 *
 * The applicant's dashboard (MyApplications) calls this hook.  When the
 * recruiter clicks "Start Live Interview", the backend pushes a message of
 * type "INVITE" here and the card appears instantly without any page refresh.
 *
 * When the recruiter ends the interview (or the session expires), the backend
 * pushes type "ENDED" and the card is removed automatically.
 *
 * Reconnection is handled by @stomp/stompjs built-in reconnectDelay.
 * The hook also stores the latest invite in sessionStorage so a browser
 * refresh within the same tab still shows the card.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { Client } from '@stomp/stompjs';
import SockJS from 'sockjs-client';

const BACKEND_URL = import.meta.env.VITE_API_URL || 'http://localhost:8080';
const STORAGE_KEY = 'hirex_live_invite';

function readStoredInvite() {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeStoredInvite(invite) {
  try {
    if (invite) {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(invite));
    } else {
      sessionStorage.removeItem(STORAGE_KEY);
    }
  } catch {
    /* ignore */
  }
}

/**
 * @param {string|null} token  — JWT of the logged-in applicant.
 *                               Pass null/undefined when the user is not logged in.
 */
export function useLiveInterviewNotification(token) {
  // Restore invite from sessionStorage so a page refresh preserves the card.
  const [invite, setInvite] = useState(() => readStoredInvite());
  const clientRef           = useRef(null);
  const subRef              = useRef(null);

  const handleMessage = useCallback((notification) => {
    if (!notification) return;

    if (notification.type === 'INVITE') {
      setInvite(notification);
      writeStoredInvite(notification);
    } else if (notification.type === 'ENDED' || notification.type === 'CANCELLED') {
      // Dismiss the invite card and clear sessionStorage so a page refresh
      // after the interview ends never shows a stale "Join Interview" card.
      setInvite(prev => {
        if (prev && prev.liveSessionId === notification.liveSessionId) {
          writeStoredInvite(null);
          return null;
        }
        return prev;
      });
      // Always clear storage regardless of whether the invite was showing,
      // because the user might be in CandidateInterviewRoom right now.
      writeStoredInvite(null);
    }
  }, []);

  useEffect(() => {
    if (!token) {
      // User logged out — clear everything
      setInvite(null);
      writeStoredInvite(null);
      return;
    }

    const client = new Client({
      webSocketFactory: () => new SockJS(`${BACKEND_URL}/ws`),
      connectHeaders: { login: token },
      heartbeatIncoming: 10000,
      heartbeatOutgoing: 10000,
      reconnectDelay: 5000,

      onConnect: () => {
        // Subscribe to the personal invite queue
        subRef.current = client.subscribe(
          '/user/queue/live-interview-invite',
          (frame) => {
            try {
              handleMessage(JSON.parse(frame.body));
            } catch {
              /* ignore malformed frames */
            }
          }
        );
      },

      onStompError: (frame) => {
        console.warn('[LiveInvite] STOMP error:', frame.headers?.message);
      },

      onWebSocketError: () => {
        // reconnectDelay handles reconnection automatically
      },
    });

    client.activate();
    clientRef.current = client;

    return () => {
      if (subRef.current) {
        try { subRef.current.unsubscribe(); } catch { /* ignore */ }
        subRef.current = null;
      }
      client.deactivate();
      clientRef.current = null;
    };
  }, [token, handleMessage]);

  const clearInvite = useCallback(() => {
    setInvite(null);
    writeStoredInvite(null);
  }, []);

  return { invite, clearInvite };
}

export default useLiveInterviewNotification;
