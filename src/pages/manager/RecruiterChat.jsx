import { useState, useEffect, useRef, useCallback, memo } from 'react';
import { useNavigate } from 'react-router-dom';
import api, { assignInterviewToAll } from '../../services/api';
import liveInterviewApi from '../../services/liveInterviewApi';

import ChatWindow from '../../components/chat/ChatWindow';
import './RecruiterChat.css';

// ─── Module-level conversation cache ─────────────────────────
let convCache    = null;
let stubsFetched = false;

export function invalidateConvCache() {
  convCache    = null;
  stubsFetched = false;
}

/* ─── ConvItem ───────────────────────────────────────────────── */
const ConvItem = memo(function ConvItem({ conv, isActive, onSelect, formatTime }) {
  return (
    <div
      className={`rc-conv-item ${isActive ? 'rc-conv-item--active' : ''} ${conv.unreadCount > 0 ? 'rc-conv-item--unread' : ''}`}
      onClick={() => onSelect(conv)}
    >
      <div className="rc-conv-avatar">{conv.candidateName?.charAt(0)?.toUpperCase()}</div>
      <div className="rc-conv-info">
        <div className="rc-conv-top">
          <span className="rc-conv-name">{conv.candidateName}</span>
          <span className="rc-conv-time">{formatTime(conv.lastMessageAt)}</span>
        </div>
        <div className="rc-conv-job">{conv.jobTitle}</div>
        <div className="rc-conv-bottom">
          <span className="rc-conv-preview">
            {conv.lastMessage || (conv._fromApplicants
              ? '✅ Shortlisted — start the conversation'
              : 'No messages yet')}
          </span>
          {conv.unreadCount > 0 && (
            <span className="rc-unread-badge">{conv.unreadCount}</span>
          )}
        </div>
      </div>
    </div>
  );
});

/* ─── Main Component ─────────────────────────────────────────── */
export default function RecruiterChat() {
  const [conversations, setConversations] = useState(() =>
    convCache ? [...convCache.values()] : []
  );
  const [loading,  setLoading]  = useState(!convCache);
  const [error,    setError]    = useState('');
  const [selected, setSelected] = useState(null);

  const [bulkAssigning, setBulkAssigning] = useState(false);
  const [bulkMsg,       setBulkMsg]       = useState('');
  const [bulkModal,     setBulkModal]     = useState(false);

  const navigate = useNavigate();
  const [liveLoading, setLiveLoading] = useState(false);
  const [liveError,   setLiveError]   = useState('');

  // ─── Applicant Picker Modal (for assigning live interview) ───────────
  const [showApplicantPicker, setShowApplicantPicker]   = useState(false);
  const [pickerApplicants,    setPickerApplicants]      = useState([]);
  const [pickerLoading,       setPickerLoading]         = useState(false);
  const [pickerError,         setPickerError]           = useState('');
  const [selectedApplicants,  setSelectedApplicants]    = useState(new Set());
  const [pickerInterviewId,   setPickerInterviewId]     = useState(null);

  // Step 1: Recruiter clicks "Start Live Interview" — load assignable applicants
  const handleStartLiveInterview = useCallback(async () => {
    if (!selected) return;
    setLiveError('');
    setPickerLoading(true);
    setPickerError('');
    setSelectedApplicants(new Set());
    // Clear any previous interviewSessionId so we default to jobId path
    setPickerInterviewId(null);

    try {
      // PRIMARY PATH: use jobId directly to fetch shortlisted applicants.
      // This works regardless of whether an AI interview has been scheduled.
      // If the candidate already has an AI interview session, we'll capture it
      // below as a bonus (for backward-compat with the old createSession path).
      let jobId = selected.jobId;

      // Fallback: if jobId is missing from the cached conversation object
      // (can happen with old cached stubs or before the ChatDto fix was deployed),
      // look it up from the application record.
      if (!jobId) {
        try {
          const appRes = await api.get(`/api/manager/jobs`);
          // Try to find it from the applicants list for each job
          const jobs = appRes.data || [];
          for (const job of jobs) {
            try {
              const appsRes = await api.get(`/api/manager/jobs/${job.id}/applicants`);
              const match = (appsRes.data || []).find(a => a.id === selected.applicationId);
              if (match) { jobId = job.id; break; }
            } catch { /* continue */ }
          }
        } catch { /* ignore */ }
      }

      if (!jobId) {
        throw new Error('Could not determine the job for this conversation. Please refresh and try again.');
      }

      // Fetch assignable applicants by jobId — does NOT require an AI session
      const applicantsRes = await liveInterviewApi.getAssignableApplicantsByJob(jobId);
      const applicants = applicantsRes.data || [];

      if (applicants.length === 0) {
        throw new Error('No shortlisted applicants found for this job. Shortlist at least one candidate first.');
      }

      // Optionally try to find an existing AI interview session for the selected
      // candidate — we'll pass it to createSession if available (best-effort).
      try {
        const interviewRes = await api.get(
          `/api/interview/application/${selected.applicationId}`
        );
        if (interviewRes.data?.id) {
          setPickerInterviewId(interviewRes.data.id);
        }
      } catch {
        // No AI interview session yet — that's fine, createSession handles this via jobId
      }

      // Pre-select the current conversation's candidate
      const defaultApplicant = applicants.find(
        a => a.email === selected.candidateEmail
      );
      setSelectedApplicants(new Set(defaultApplicant ? [defaultApplicant.applicantId] : []));

      setPickerApplicants(applicants);
      setShowApplicantPicker(true);
    } catch (err) {
      console.error('Error opening applicant picker:', err);
      setLiveError(err.response?.data?.message || err.message || 'Could not load applicants.');
    } finally {
      setPickerLoading(false);
    }
  }, [selected]);

  // Step 2: Recruiter confirms their selection and creates the live session
  const handleConfirmLiveInterview = useCallback(async () => {
    if (selectedApplicants.size === 0) return;
    setLiveLoading(true);
    setPickerError('');

    try {
      const assignedApplicantIds = [...selectedApplicants];
      // Pass interviewSessionId if we found one, otherwise pass jobId so the
      // backend can auto-resolve/create the interview session for us.
      const res = await liveInterviewApi.createSession(
        pickerInterviewId || null,
        assignedApplicantIds,
        pickerInterviewId ? null : selected?.jobId
      );

      const token =
        res.data?.sessionToken  ??
        res.data?.recruiterToken ??
        res.data?.token;

      if (!token) throw new Error('No session token returned from server.');

      setShowApplicantPicker(false);
      navigate(`/live-interview/recruiter/${token}`);
    } catch (err) {
      console.error('Error creating live session:', err);
      setPickerError(err.response?.data?.message || err.message || 'Could not start live session.');
    } finally {
      setLiveLoading(false);
    }
  }, [pickerInterviewId, selectedApplicants, selected, navigate]);

  const toggleApplicant = (applicantId) => {
    setSelectedApplicants(prev => {
      const next = new Set(prev);
      if (next.has(applicantId)) next.delete(applicantId);
      else next.add(applicantId);
      return next;
    });
  };

  const mergeRef = useRef(new Map(convCache || []));

  // ── Merge helper ─────────────────────────────────────────────
  const applyMerge = useCallback((serverList, stubs) => {
    const map = mergeRef.current;

    for (const conv of serverList) {
      const existing = map.get(conv.applicationId);
      map.set(conv.applicationId, {
        ...(existing || {}),
        ...conv,
        unreadCount: conv.unreadCount ?? existing?.unreadCount ?? 0,
      });
    }

    for (const stub of (stubs || [])) {
      if (!map.has(stub.applicationId)) {
        map.set(stub.applicationId, stub);
      }
    }

    convCache = new Map(map);

    const sorted = [...map.values()].sort((a, b) => {
      if (a.lastMessage && !b.lastMessage) return -1;
      if (!a.lastMessage && b.lastMessage)  return  1;
      return (b.lastMessageAt || '').localeCompare(a.lastMessageAt || '');
    });

    setConversations(sorted);
  }, []);

  // ── Fetch conversations ───────────────────────────────────────
  const fetchConversations = useCallback(async (stubs) => {
    try {
      const { data } = await api.get('/api/chat/manager/conversations');
      applyMerge(data, stubs ?? [...(mergeRef.current.values())].filter(c => c._fromApplicants));
      setError('');
    } catch {
      setError('Failed to load conversations.');
    } finally {
      setLoading(false);
    }
  }, [applyMerge]);

  // ── Fetch applicant stubs ─────────────────────────────────────
  const fetchStubs = useCallback(async () => {
    try {
      const { data } = await api.get('/api/manager/shortlisted-applicants');
      return data.map(a => ({
        applicationId:     a.id,
        candidateName:     a.applicantName,
        candidateEmail:    a.applicantEmail,
        candidateId:       a.applicantId,
        jobTitle:          a.jobTitle,
        jobId:             a.jobId,
        applicationStatus: a.status,
        lastMessage:       null,
        lastMessageAt:     a.appliedAt || null,
        unreadCount:       0,
        _fromApplicants:   true,
      }));
    } catch {
      // Fallback: per-job fetch
      try {
        const { data: jobs } = await api.get('/api/manager/jobs');
        const results = await Promise.all(
          jobs.map(j =>
            api.get(`/api/manager/jobs/${j.id}/applicants`)
               .then(r => ({ job: j, apps: r.data || [] }))
               .catch(() => ({ job: j, apps: [] }))
          )
        );
        const stubs = [];
        for (const { job, apps } of results) {
          for (const a of apps) {
            if (a.status === 'SHORTLISTED' || a.status === 'HIRED') {
              stubs.push({
                applicationId:     a.id,
                candidateName:     a.applicantName,
                candidateEmail:    a.applicantEmail,
                candidateId:       a.applicantId,
                jobTitle:          job.title,
                jobId:             job.id,
                applicationStatus: a.status,
                lastMessage:       null,
                lastMessageAt:     a.appliedAt || null,
                unreadCount:       0,
                _fromApplicants:   true,
              });
            }
          }
        }
        return stubs;
      } catch {
        return [];
      }
    }
  }, []);

  // ── Init ─────────────────────────────────────────────────────
  useEffect(() => {
    // Always clear the module-level cache on mount so conversations are
    // re-fetched with the latest API response (which now includes jobId).
    convCache    = null;
    stubsFetched = false;

    let cancelled    = false;
    let pollInterval = null;

    const init = async () => {
      if (convCache) {
        mergeRef.current = new Map(convCache);
        setLoading(false);
        fetchConversations();
        return;
      }

      const [, stubs] = await Promise.all([
        fetchConversations(),
        stubsFetched
          ? Promise.resolve([])
          : fetchStubs()
              .then(data => { stubsFetched = true; return data; })
              .catch(() => [])
      ]);

      if (cancelled) return;

      applyMerge([], stubs);

      pollInterval = setInterval(() => {
        if (!cancelled) fetchConversations();
      }, 30000);
    };

    init();

    return () => {
      cancelled = true;
      if (pollInterval) clearInterval(pollInterval);
    };
  }, [applyMerge, fetchConversations, fetchStubs]);

  // ── Handle selection ────────────────────────────────────────
  const handleSelect = useCallback((conv) => {
    setSelected(conv);
  }, []);

  // ── Bulk assign ─────────────────────────────────────────────
  const handleBulkAssign = async () => {
    setBulkAssigning(true);
    try {
      const uniqueJobIds = new Set(conversations.map(c => c.jobId).filter(Boolean));
      const results = await Promise.allSettled(
        [...uniqueJobIds].map(jobId => assignInterviewToAll(jobId))
      );

      const failed = results.filter(r => r.status === 'rejected').length;
      if (failed > 0) {
        setBulkMsg(`⚠️ ${failed} job(s) failed. Check logs.`);
      } else {
        setBulkMsg('success');
      }
    } catch (err) {
      console.error('Bulk assign error:', err);
      setBulkMsg(err.message || 'Failed to assign interviews.');
    } finally {
      setBulkAssigning(false);
    }
  };

  const formatTime = useCallback((iso) => {
    if (!iso) return '';
    const d    = new Date(iso);
    const diff = Math.floor((Date.now() - d) / 86400000);
    if (diff === 0) return d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
    if (diff === 1) return 'Yesterday';
    return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
  }, []);

  const totalUnread = conversations.reduce((s, c) => s + (c.unreadCount || 0), 0);

  const assignedIds = new Set(
    typeof window !== 'undefined' && window.localStorage
      ? (localStorage.getItem('hirex_interview_assigned') || '[]')
          .split(',')
          .map(s => s.replace(/["\[\]]/g, '').trim())
          .filter(Boolean)
      : []
  );

  return (
    <div className="rc-page">
      <div className="rc-header">
        <div className="rc-header-top">
          <div>
            <h1 className="rc-title">Recruiter Conversations</h1>
            <p className="rc-subtitle">
              Chat with shortlisted candidates regarding interviews and hiring updates
            </p>
          </div>
          {conversations.length > 0 && (
            <button
              className="rc-bulk-assign-btn"
              onClick={() => { setBulkModal(true); setBulkMsg(''); }}
              disabled={bulkAssigning}
              title="Assign AI interview to all shortlisted candidates at once"
            >
              {bulkAssigning ? '⏳ Assigning…' : '🤖 Assign AI Interview to All'}
            </button>
          )}
        </div>
      </div>

      {/* ── Bulk Assign Modal ────────────────────────────────── */}
      {bulkModal && (
        <div className="rc-modal-overlay" onClick={() => setBulkModal(false)}>
          <div className="rc-modal" onClick={e => e.stopPropagation()}>
            <div className="rc-modal-header">
              <span className="rc-modal-icon">🤖</span>
              <h3>Assign AI Interview to All</h3>
              <button className="rc-modal-close" onClick={() => setBulkModal(false)}>×</button>
            </div>
            {bulkMsg === 'success' ? (
              <div className="rc-modal-success">
                <div style={{ fontSize: 36, marginBottom: 8 }}>🎉</div>
                <p>AI interviews have been assigned to <strong>all shortlisted candidates</strong>.</p>
                <p className="rc-modal-hint">Each candidate will see a <em>"Start AI Interview"</em> button on their My Applications page.</p>
                <button className="rc-modal-done-btn" onClick={() => { setBulkModal(false); setBulkMsg(''); }}>Done</button>
              </div>
            ) : (
              <>
                <div className="rc-modal-body">
                  <p>This will assign an AI interview to all <strong>{conversations.length} shortlisted candidates</strong> at once.</p>
                  <p className="rc-modal-hint">Candidates who already have an interview assigned will be skipped automatically.</p>
                  {bulkMsg && bulkMsg !== 'success' && (
                    <div className="rc-modal-error">⚠️ {bulkMsg}</div>
                  )}
                </div>
                <div className="rc-modal-footer">
                  <button className="rc-modal-cancel-btn" onClick={() => setBulkModal(false)} disabled={bulkAssigning}>Cancel</button>
                  <button className="rc-modal-confirm-btn" onClick={handleBulkAssign} disabled={bulkAssigning}>
                    {bulkAssigning ? '⏳ Assigning…' : '🤖 Assign to All'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      <div className="rc-layout">
        {/* ── Sidebar ─────────────────────────────────────── */}
        <div className="rc-sidebar">
          <div className="rc-sidebar-header">
            <span>Conversations</span>
            {totalUnread > 0 && <span className="rc-badge">{totalUnread}</span>}
          </div>

          {loading && <div className="rc-loading">Loading…</div>}
          {error   && <div className="rc-error">{error}</div>}

          {!loading && conversations.length === 0 && (
            <div className="rc-empty">
              <div className="rc-empty-icon">💬</div>
              <p>No shortlisted candidates yet.</p>
              <p className="rc-empty-hint">
                Shortlisted candidates appear here automatically.
              </p>
            </div>
          )}

          <div className="rc-conv-list">
            {conversations.map(conv => (
              <ConvItem
                key={conv.applicationId}
                conv={conv}
                isActive={selected?.applicationId === conv.applicationId}
                onSelect={handleSelect}
                formatTime={formatTime}
              />
            ))}
          </div>
        </div>

        {/* ── Chat Panel ──────────────────────────────────── */}
        <div className="rc-chat-panel">
          {!selected ? (
            <div className="rc-no-selection">
              <div className="rc-no-selection-icon">💬</div>
              <h3>Select a conversation</h3>
              <p>Choose a candidate from the left to start chatting.</p>
            </div>
          ) : (
            <div className="rc-chat-wrap">
              <div className="rc-chat-info-bar">
                <div className="rc-info-left">
                  <strong>{selected.candidateName}</strong>
                  <span className="rc-info-email">{selected.candidateEmail}</span>
                </div>
                <div className="rc-info-right">
                  <span className="rc-info-job">{selected.jobTitle}</span>
                  <span className="rc-status-badge rc-status-shortlisted">
                    {selected.applicationStatus}
                  </span>
                  {assignedIds.has(String(selected.applicationId)) && (
                    <span className="rc-interview-assigned-badge">
                      ✅ Interview Assigned
                    </span>
                  )}
                  <button
                    onClick={handleStartLiveInterview}
                    disabled={liveLoading || pickerLoading}
                    title="Create a live video interview session — pick which applicants can join"
                    style={{
                      display:       'inline-flex',
                      alignItems:    'center',
                      gap:           '6px',
                      background:    (liveLoading || pickerLoading) ? '#93c5fd' : '#2563eb',
                      color:         '#fff',
                      border:        'none',
                      borderRadius:  '8px',
                      padding:       '7px 14px',
                      fontSize:      '13px',
                      fontWeight:    500,
                      cursor:        (liveLoading || pickerLoading) ? 'not-allowed' : 'pointer',
                      whiteSpace:    'nowrap',
                      transition:    'background 0.2s',
                    }}
                  >
                    {pickerLoading ? '⏳ Loading…' : liveLoading ? '⏳ Starting…' : '🎥 Start Live Interview'}
                  </button>
                  {liveError && (
                    <span style={{
                      fontSize:   '12px',
                      color:      '#dc2626',
                      marginTop:  '4px',
                      display:    'block',
                      maxWidth:   '220px',
                      lineHeight: 1.4,
                    }}>
                      ⚠️ {liveError}
                    </span>
                  )}
                </div>
              </div>

              <ChatWindow
                key={selected.applicationId}
                applicationId={selected.applicationId}
                recipientName={selected.candidateName}
                embedded={true}
                onConversationUpdate={(lastMsg) => {
                  const updated = {
                    ...selected,
                    lastMessage:   lastMsg.content || `📎 ${lastMsg.fileName}`,
                    lastMessageAt: lastMsg.sentAt,
                  };
                  mergeRef.current.set(selected.applicationId, updated);
                  convCache = new Map(mergeRef.current);
                  setConversations(prev =>
                    prev.map(c =>
                      c.applicationId === selected.applicationId ? updated : c
                    ).sort((a, b) => {
                      if (a.lastMessage && !b.lastMessage) return -1;
                      if (!a.lastMessage && b.lastMessage)  return  1;
                      return (b.lastMessageAt || '').localeCompare(a.lastMessageAt || '');
                    })
                  );
                }}
              />
            </div>
          )}
        </div>
      </div>

      {/* ── Applicant Picker Modal — recruiter selects who can join ── */}
      {showApplicantPicker && (
        <div
          className="rc-modal-overlay"
          onClick={() => { setShowApplicantPicker(false); setLiveError(''); }}
        >
          <div
            className="rc-modal"
            onClick={e => e.stopPropagation()}
            style={{ maxWidth: 480 }}
          >
            <div className="rc-modal-header">
              <span className="rc-modal-icon">🎥</span>
              <h3>Select Applicants for Live Interview</h3>
              <button
                className="rc-modal-close"
                onClick={() => setShowApplicantPicker(false)}
              >×</button>
            </div>

            <div className="rc-modal-body">
              <p style={{ marginBottom: 12, color: '#6b7280', fontSize: 13 }}>
                Select one or more shortlisted applicants who will see the
                <strong> "Join Live Interview"</strong> button. Only selected applicants
                can access this session — others will not see the button.
              </p>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 280, overflowY: 'auto' }}>
                {pickerApplicants.map(a => (
                  <label
                    key={a.applicantId}
                    style={{
                      display:      'flex',
                      alignItems:   'center',
                      gap:          10,
                      padding:      '10px 12px',
                      borderRadius: 8,
                      border:       selectedApplicants.has(a.applicantId)
                                      ? '2px solid #2563eb'
                                      : '2px solid #e5e7eb',
                      background:   selectedApplicants.has(a.applicantId)
                                      ? '#eff6ff'
                                      : '#fff',
                      cursor:       'pointer',
                      transition:   'all 0.15s',
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={selectedApplicants.has(a.applicantId)}
                      onChange={() => toggleApplicant(a.applicantId)}
                      style={{ width: 16, height: 16, accentColor: '#2563eb' }}
                    />
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 600, fontSize: 14 }}>{a.name}</div>
                      <div style={{ fontSize: 12, color: '#6b7280' }}>{a.email}</div>
                    </div>
                    {selectedApplicants.has(a.applicantId) && (
                      <span style={{ fontSize: 16 }}>✅</span>
                    )}
                  </label>
                ))}
              </div>

              {pickerError && (
                <div className="rc-modal-error" style={{ marginTop: 10 }}>
                  ⚠️ {pickerError}
                </div>
              )}
            </div>

            <div className="rc-modal-footer">
              <button
                className="rc-modal-cancel-btn"
                onClick={() => setShowApplicantPicker(false)}
                disabled={liveLoading}
              >
                Cancel
              </button>
              <button
                className="rc-modal-confirm-btn"
                onClick={handleConfirmLiveInterview}
                disabled={liveLoading || selectedApplicants.size === 0}
                style={{ opacity: selectedApplicants.size === 0 ? 0.5 : 1 }}
              >
                {liveLoading
                  ? '⏳ Starting…'
                  : `🎥 Start for ${selectedApplicants.size} Applicant${selectedApplicants.size !== 1 ? 's' : ''}`}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}