import { useState, useEffect, useMemo, memo } from 'react';
import { useNavigate } from 'react-router-dom';
import { List } from 'react-window';

import api, { getJobStats, getRecruiterApplicantStats } from '../../services/api';
import { useDebouncedValue } from '../../hooks/useHooks';
import './AtsChecker.css';

const RESULT_ROW_HEIGHT = 64;
const VIRTUALIZE_THRESHOLD = 30;

/* ─── Score Ring ────────────────────────────────────────────────────── */
const ScoreRing = memo(function ScoreRing({ score, size = 96 }) {
  const r      = size === 64 ? 24 : 38;
  const circ   = 2 * Math.PI * r;
  const offset = circ - (score / 100) * circ;
  const color  = score >= 80 ? '#16a34a' : score >= 60 ? '#4f46e5' : score >= 40 ? '#d97706' : '#dc2626';

  return (
    <div className="ac-ring" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="#e2e6f0" strokeWidth={size===64?5:8} />
        <circle cx={size/2} cy={size/2} r={r} fill="none"
          stroke={color} strokeWidth={size===64?5:8}
          strokeDasharray={circ} strokeDashoffset={offset}
          strokeLinecap="round"
          style={{ transform:`rotate(-90deg)`, transformOrigin:`${size/2}px ${size/2}px`, transition:'stroke-dashoffset 0.6s ease' }}
        />
      </svg>
      <div className="ac-ring-label">
        <span className="ac-ring-num" style={{ color, fontSize: size===64?14:20 }}>{score}</span>
        <span className="ac-ring-denom">/100</span>
      </div>
    </div>
  );
});

/* ─── Status Badge ───────────────────────────────────────────────────── */
const StatusBadge = memo(function StatusBadge({ status }) {
  const cfg = {
    HIRED:              { bg:'#dcfce7', color:'#16a34a', icon:'🏆' },
    SHORTLISTED:        { bg:'#ede9fe', color:'#7c3aed', icon:'✅' },
    REJECTED:           { bg:'#fee2e2', color:'#dc2626', icon:'✕'  },
    APPLIED:            { bg:'#dbeafe', color:'#2563eb', icon:'📋' },
    // ★ NEW interview result statuses
    INTERVIEW_PASSED:   { bg:'#dcfce7', color:'#16a34a', icon:'✅' },
    INTERVIEW_FAILED:   { bg:'#fee2e2', color:'#dc2626', icon:'❌' },
    UNDER_REVIEW:       { bg:'#fef3c7', color:'#d97706', icon:'🟡' },
    PASSED:             { bg:'#dcfce7', color:'#16a34a', icon:'✅' },
    FAILED:             { bg:'#fee2e2', color:'#dc2626', icon:'❌' },
  };
  const s = cfg[status] || { bg:'#f3f4f6', color:'#6b7280', icon:'•' };
  return (
    <span className="ac-status-badge" style={{ background: s.bg, color: s.color }}>
      {s.icon} {status}
    </span>
  );
});

/* ─── Summary Card ───────────────────────────────────────────────────── */
const SummaryCard = memo(function SummaryCard({ label, value, color, icon, highlight }) {
  return (
    <div
      className="ac-summary-card"
      style={{
        borderTop: `4px solid ${color}`,
        boxShadow: highlight ? `0 0 0 2px ${color}40` : undefined,
      }}
    >
      <div className="ac-summary-icon">{icon}</div>
      <div className="ac-summary-value" style={{ color }}>{value ?? '—'}</div>
      <div className="ac-summary-label">{label}</div>
    </div>
  );
});

/* ─── Progress Bar ───────────────────────────────────────────────────── */
const ProgressBar = memo(function ProgressBar({ current, total, label }) {
  const pct = total > 0 ? Math.round((current / total) * 100) : 0;
  return (
    <div className="ac-progress-wrap">
      <div className="ac-progress-header">
        <span>{label}</span>
        <span>{current} / {total} ({pct}%)</span>
      </div>
      <div className="ac-progress-track">
        <div className="ac-progress-fill" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
});

/* ─── Interview Result Banner (NEW) ─────────────────────────────────── */
const InterviewResultBanner = memo(function InterviewResultBanner({ stats }) {
  if (!stats) return null;
  const passed      = stats.interviewPassed      ?? 0;
  const failed      = stats.interviewFailed      ?? 0;
  const underReview = stats.interviewUnderReview ?? 0;
  const completed   = stats.interviewCompleted   ?? 0;

  if (completed === 0) return null;

  return (
    <div className="ac-interview-result-banner">
      <div className="ac-interview-result-title">🎤 Interview Results</div>
      <div className="ac-interview-result-pills">
        <span className="ac-result-pill ac-result-pill--pass">
          ✅ Passed: <strong>{passed}</strong>
        </span>
        <span className="ac-result-pill ac-result-pill--fail">
          ❌ Failed: <strong>{failed}</strong>
        </span>
        <span className="ac-result-pill ac-result-pill--review">
          🟡 Under Review: <strong>{underReview}</strong>
        </span>
        <span className="ac-result-pill ac-result-pill--total">
          🎤 Total Completed: <strong>{completed}</strong>
        </span>
      </div>
    </div>
  );
});

/* ─── Virtualized results row ───────────────────────────────────────── */
const ResultRow = memo(function ResultRow({ index, style, results }) {
  const r = results[index];
  return (
    <div className={`ac-vtable-row ${!r.processed ? 'ac-row-skipped' : ''}`} style={style}>
      <div className="ac-vtable-cell ac-td-num">{index + 1}</div>
      <div className="ac-vtable-cell">
        <div className="ac-candidate-cell">
          <div className="ac-avatar">{r.candidateName?.[0]?.toUpperCase()}</div>
          <span className="ac-cand-name">{r.candidateName}</span>
        </div>
      </div>
      <div className="ac-vtable-cell ac-td-email">{r.candidateEmail}</div>
      <div className="ac-vtable-cell ac-td-file">{r.fileName || '—'}</div>
      <div className="ac-vtable-cell">
        <div className="ac-score-cell">
          <ScoreRing score={r.atsScore} size={48} />
          {!r.processed && <span className="ac-no-text-warn">No text</span>}
        </div>
      </div>
      <div className="ac-vtable-cell">
        <div className="ac-match-bar-wrap">
          <div className="ac-match-bar-track">
            <div
              className="ac-match-bar-fill"
              style={{
                width: `${r.matchPercentage}%`,
                background: r.matchPercentage >= 80 ? '#16a34a' : r.matchPercentage >= 60 ? '#7c3aed' : '#dc2626'
              }}
            />
          </div>
          <span className="ac-match-pct">{r.matchPercentage}%</span>
        </div>
      </div>
      <div className="ac-vtable-cell"><StatusBadge status={r.status} /></div>
    </div>
  );
}, (prev, next) => prev.results === next.results && prev.index === next.index && prev.style === next.style);

/* ═══════════════════════════════════════════════════════════════════════
   MAIN COMPONENT
═══════════════════════════════════════════════════════════════════════ */
export default function AtsChecker() {

  const navigate = useNavigate();

  /* ── State: view mode ─────────────────────────────────────────────── */
  const [view, setView] = useState('bulk');

  /* ── State: selected job for per-job stats ───────────────────────── */
  const [jobs,           setJobs]          = useState([]);
  const [selectedJobId,  setSelectedJobId] = useState(null);
  const [jobStats,       setJobStats]      = useState(null);
  const [jobStatsLoading, setJobStatsLoading] = useState(false);

  /* ── State: single-candidate mode ────────────────────────────────── */
  const [candidates,    setCandidates]  = useState([]);
  const [loadingList,   setLoadingList] = useState(true);
  const [listError,     setListError]   = useState('');
  const [selected,      setSelected]    = useState(null);
  const [singleResult,  setSingleResult] = useState(null);
  const [singleLoading, setSingleLoading] = useState(false);
  const [singleError,   setSingleError] = useState('');

  /* ── State: bulk mode ────────────────────────────────────────────── */
  const [summary,         setSummary]        = useState(null);
  const [summaryLoading,  setSummaryLoading] = useState(true);
  const [bulkResults,     setBulkResults]    = useState([]);
  const [bulkLoading,     setBulkLoading]    = useState(false);
  const [bulkError,       setBulkError]      = useState('');
  const [bulkStats,       setBulkStats]      = useState(null);
  const [bulkProgress,    setBulkProgress]   = useState({ current: 0, total: 0 });

  /* ── State: table filters ────────────────────────────────────────── */
  const [filterStatus,   setFilterStatus]  = useState('ALL');
  const [sortField,      setSortField]     = useState('atsScore');
  const [sortDir,        setSortDir]       = useState('desc');
  const [searchQ,        setSearchQ]       = useState('');
  const debouncedSearchQ = useDebouncedValue(searchQ, 200);

  /* ── Load candidate list + summary + jobs on mount ───────────────── */
  useEffect(() => {
    api.get('/api/manager/resumes')
      .then(res => setCandidates(res.data || []))
      .catch(() => setListError('Failed to load candidate resumes.'))
      .finally(() => setLoadingList(false));

    loadSummary();

    // Load jobs for the job-stats selector
    api.get('/api/manager/jobs')
      .then(res => setJobs(res.data || []))
      .catch(() => {/* jobs optional */});
  }, []);

  const loadSummary = () => {
    setSummaryLoading(true);

    // Fetch both the global ATS summary and the recruiter-scoped job stats in parallel.
    // The global /api/ats/summary counts ALL applicants across ALL recruiters, so we
    // override its applicant counts with values derived from the recruiter's own jobs.
    Promise.all([
      api.get('/api/ats/summary').catch(() => ({ data: {} })),
      getRecruiterApplicantStats().catch(() => null),
    ])
      .then(([summaryRes, recruiterStats]) => {
        const base = summaryRes.data || {};
        if (recruiterStats) {
          // Replace the global counts with recruiter-scoped, status-broken-down counts
          setSummary({
            ...base,
            // "Applied Applicants" = only APPLIED status, current recruiter's jobs
            totalApplicants:  recruiterStats.applied,
            totalShortlisted: recruiterStats.shortlisted,
            totalHired:       recruiterStats.hired,
            totalRejected:    recruiterStats.rejected,
            // totalPending and totalWithResume stay from the global summary
            // because we don't have per-job resume count from the jobs list
          });
        } else {
          // Fallback: use the global summary as-is (old behaviour)
          setSummary(base);
        }
      })
      .finally(() => setSummaryLoading(false));
  };

  /* ── Load per-job stats when job selection changes ───────────────── */
  useEffect(() => {
    if (!selectedJobId) { setJobStats(null); return; }
    setJobStatsLoading(true);
    getJobStats(selectedJobId)
      .then(res => setJobStats(res.data))
      .catch(() => setJobStats(null))
      .finally(() => setJobStatsLoading(false));
  }, [selectedJobId]);

  /* ── Derive status from ATS score ───────────────────────────────── */
  const scoreToStatus = (score) =>
    score >= 80 ? 'HIRED' : score >= 60 ? 'SHORTLISTED' : 'REJECTED';

  /* ── Auto-update a single application status ─────────────────────── */
  const autoUpdateStatus = async (applicationId, status) => {
    try {
      await api.put(`/api/manager/applications/${applicationId}/status`, { status });
    } catch { /* silent */ }
  };

  /* ── Single candidate ATS ────────────────────────────────────────── */
  const runSingleAts = async (candidate) => {
    setSelected(candidate);
    setSingleResult(null);
    setSingleError('');
    setSingleLoading(true);
    try {
      const res = await api.get(`/api/manager/resume/${candidate.resumeId}/ats-score`);
      const result = res.data;
      setSingleResult(result);
      if (candidate.applicationId && result.atsScore != null) {
        const autoStatus = scoreToStatus(result.atsScore);
        await autoUpdateStatus(candidate.applicationId, autoStatus);
        setSingleResult(prev => ({ ...prev, autoUpdatedStatus: autoStatus }));
        window.dispatchEvent(new CustomEvent('ats:shortlisted'));
      }
    } catch {
      setSingleError('ATS analysis failed. Please try again.');
    } finally {
      setSingleLoading(false);
    }
  };

  /* ── Bulk: Analyze All ───────────────────────────────────────────── */
  const handleAnalyzeAll = async () => {
    setBulkLoading(true);
    setBulkError('');
    setBulkResults([]);
    setBulkStats(null);
    setBulkProgress({ current: 0, total: candidates.length });

    try {
      // Use per-job endpoint if a job is selected, otherwise manager-scoped
      const endpoint = selectedJobId
        ? `/api/manager/ats/jobs/${selectedJobId}/analyze`
        : '/api/manager/ats/analyze-all';
      const res = await api.post(endpoint);
      const data = res.data;
      const results = data.results || [];
      setBulkResults(results);
      setBulkProgress({ current: data.totalProcessed + data.totalSkipped, total: data.totalProcessed + data.totalSkipped });

      let savedCount = 0;
      await Promise.allSettled(
        results
          .filter(r => r.processed && r.applicationId && r.atsScore != null)
          .map(async (r) => {
            const status = scoreToStatus(r.atsScore);
            try {
              await api.put(`/api/manager/applications/${r.applicationId}/status`, { status });
              savedCount++;
            } catch { /* continue */ }
          })
      );

      setBulkStats({
        totalProcessed:   data.totalProcessed,
        totalSkipped:     data.totalSkipped,
        totalHired:       data.totalHired,
        totalShortlisted: data.totalShortlisted,
        totalRejected:    data.totalRejected,
        message:          data.message,
        saved:            savedCount > 0,
        savedCount,
      });

      loadSummary();
      // Refresh per-job stats if a job is selected
      if (selectedJobId) {
        getJobStats(selectedJobId).then(res => setJobStats(res.data)).catch(() => {});
      }
      window.dispatchEvent(new CustomEvent('ats:shortlisted'));
    } catch {
      setBulkError('Bulk analysis failed. Please try again.');
    } finally {
      setBulkLoading(false);
    }
  };

  /* ── Bulk: Process All ───────────────────────────────────────────── */
  const handleProcessAll = async () => {
    // Require a job to be selected so results are scoped correctly
    if (!selectedJobId) {
      alert('Please select a job from the "Interview Results by Job" dropdown above before processing candidates.\n\nThis ensures only applicants for that specific job are processed.');
      return;
    }

    if (!window.confirm(
      'This will analyze all resumes for the selected job and automatically update candidate statuses (Shortlist / Reject) in the database.\n\nContinue?'
    )) return;

    setBulkLoading(true);
    setBulkError('');
    setBulkResults([]);
    setBulkStats(null);
    setBulkProgress({ current: 0, total: candidates.length });

    try {
      // Use per-job endpoint if a job is selected, otherwise manager-scoped fallback
      const endpoint = selectedJobId
        ? `/api/manager/ats/jobs/${selectedJobId}/process`
        : '/api/manager/ats/process-all';
      const res = await api.post(endpoint);
      const data = res.data;
      setBulkResults(data.results || []);
      setBulkStats({
        totalProcessed:   data.totalProcessed,
        totalSkipped:     data.totalSkipped,
        totalHired:       data.totalHired,
        totalShortlisted: data.totalShortlisted,
        totalRejected:    data.totalRejected,
        message:          data.message,
        saved:            true,
        // Remember the job that was selected so the banner can offer navigation
        processedJobId:   selectedJobId,
        processedJobTitle: jobs.find(j => String(j.id) === String(selectedJobId))?.title,
      });
      setBulkProgress({ current: data.totalProcessed + data.totalSkipped, total: data.totalProcessed + data.totalSkipped });
      loadSummary();
      if (selectedJobId) {
        getJobStats(selectedJobId).then(res => setJobStats(res.data)).catch(() => {});
      }
      window.dispatchEvent(new CustomEvent('ats:shortlisted'));
    } catch {
      setBulkError('Process All failed. Please try again.');
    } finally {
      setBulkLoading(false);
    }
  };

  /* ── Table helpers ───────────────────────────────────────────────── */
  const toggleSort = (field) => {
    if (sortField === field) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortField(field); setSortDir('desc'); }
  };

  const sortIcon = (field) => {
    if (sortField !== field) return ' ↕';
    return sortDir === 'asc' ? ' ↑' : ' ↓';
  };

  const filteredResults = useMemo(() => {
    const q = debouncedSearchQ.toLowerCase();
    return bulkResults
      .filter(r => filterStatus === 'ALL' || r.status === filterStatus)
      .filter(r =>
        q === '' ||
        r.candidateName?.toLowerCase().includes(q) ||
        r.candidateEmail?.toLowerCase().includes(q)
      )
      .sort((a, b) => {
        const mul = sortDir === 'asc' ? 1 : -1;
        if (sortField === 'atsScore') return mul * (a.atsScore - b.atsScore);
        if (sortField === 'candidateName') return mul * (a.candidateName || '').localeCompare(b.candidateName || '');
        return 0;
      });
  }, [bulkResults, filterStatus, debouncedSearchQ, sortField, sortDir]);

  /* ════════════════════════════════════════════════════════════════════
     RENDER
  ═════════════════════════════════════════════════════════════════════ */
  return (
    <div className="ac-page">
      <div className="ac-inner">

        {/* ── Header ─────────────────────────────────────────────────── */}
        <div className="ac-header">
          <div className="ac-header-icon">🤖</div>
          <div style={{ flex: 1 }}>
            <h1>ATS Resume Checker</h1>
            <p>Bulk-analyze all uploaded resumes in one click. Automatically assign Hire / Shortlist / Reject based on ATS score.</p>
          </div>
          <div className="ac-view-toggle">
            <button
              className={`ac-toggle-btn ${view === 'bulk' ? 'active' : ''}`}
              onClick={() => setView('bulk')}
            >⚡ Bulk Mode</button>
            <button
              className={`ac-toggle-btn ${view === 'single' ? 'active' : ''}`}
              onClick={() => setView('single')}
            >🔍 Single Check</button>
          </div>
        </div>

        {/* ── Score Legend ────────────────────────────────────────────── */}
        <div className="ac-rules-strip">
          {[
            { range:'80–100', label:'Excellent → Hire',       color:'#16a34a' },
            { range:'60–79',  label:'Good → Shortlist',       color:'#4f46e5' },
            { range:'< 60',   label:'Below par → Reject',     color:'#dc2626' },
          ].map(r => (
            <div key={r.range} className="ac-rule-item">
              <span className="ac-rule-badge" style={{ background: r.color+'18', color: r.color, border:`1px solid ${r.color}40` }}>{r.range}</span>
              <span className="ac-rule-label">{r.label}</span>
            </div>
          ))}
          {/* Interview result legend */}
          <div className="ac-rule-divider" />
          {[
            { label:'PASS',         color:'#16a34a', icon:'✅' },
            { label:'FAIL',         color:'#dc2626', icon:'❌' },
            { label:'UNDER REVIEW', color:'#d97706', icon:'🟡' },
          ].map(r => (
            <div key={r.label} className="ac-rule-item">
              <span className="ac-rule-badge" style={{ background: r.color+'18', color: r.color, border:`1px solid ${r.color}40` }}>
                {r.icon} {r.label}
              </span>
            </div>
          ))}
        </div>

        {/* ════════ BULK MODE ════════════════════════════════════════ */}
        {view === 'bulk' && (
          <>
            {/* ── ATS Dashboard Summary ──────────────────────────── */}
            <div className="ac-summary-grid">
              <SummaryCard label="Applied Applicants" value={summary?.totalApplicants}  color="#2563eb" icon="📥" />
              <SummaryCard label="Hired"              value={summary?.totalHired}        color="#16a34a" icon="🏆" />
              <SummaryCard label="Shortlisted"        value={summary?.totalShortlisted}  color="#7c3aed" icon="✅" />
              <SummaryCard label="Rejected"           value={summary?.totalRejected}     color="#dc2626" icon="✕"  />
              <SummaryCard label="Pending Review"     value={summary?.totalPending}      color="#d97706" icon="⏳" />
              <SummaryCard label="Resumes Uploaded"   value={summary?.totalWithResume}   color="#0891b2" icon="📄" />
            </div>

            {/* ── Per-Job Interview Stats ─────────────────────────── */}
            <div className="ac-job-stats-section">
              <div className="ac-job-stats-header">
                <span className="ac-job-stats-icon">🎤</span>
                <span className="ac-job-stats-title">Interview Results by Job</span>
                <select
                  className="ac-job-select"
                  value={selectedJobId || ''}
                  onChange={e => setSelectedJobId(e.target.value || null)}
                >
                  <option value="">— Select a job —</option>
                  {jobs.map(j => (
                    <option key={j.id} value={j.id}>{j.title}</option>
                  ))}
                </select>
              </div>

              {jobStatsLoading && (
                <div className="ac-job-stats-loading">
                  <span className="ac-btn-spinner" style={{ borderTopColor: '#6366f1', borderColor: '#e0e7ff' }} />
                  Loading stats…
                </div>
              )}

              {jobStats && !jobStatsLoading && (
                <>
                  {/* Interview Pass/Fail cards — the NEW cards */}
                  <div className="ac-summary-grid ac-interview-stats-grid">
                    <SummaryCard
                      label="Interview Assigned"
                      value={jobStats?.interviewAssigned ?? 0}
                      color="#6366f1"
                      icon="📋"
                    />
                    <SummaryCard
                      label="Interview Completed"
                      value={jobStats?.interviewCompleted ?? 0}
                      color="#0891b2"
                      icon="🎤"
                    />
                    <SummaryCard
                      label="Interview Passed"
                      value={jobStats?.interviewPassed ?? 0}
                      color="#16a34a"
                      icon="✅"
                      highlight
                    />
                    <SummaryCard
                      label="Interview Failed"
                      value={jobStats?.interviewFailed ?? 0}
                      color="#dc2626"
                      icon="❌"
                      highlight
                    />
                    <SummaryCard
                      label="Under Review"
                      value={jobStats?.interviewUnderReview ?? 0}
                      color="#d97706"
                      icon="🟡"
                      highlight
                    />
                  </div>

                  <InterviewResultBanner stats={jobStats} />
                </>
              )}

              {!selectedJobId && !jobStatsLoading && (
                <p className="ac-job-stats-hint">
                  Select a job above to see its interview pass/fail breakdown.
                </p>
              )}
            </div>

            {/* ── Action Buttons ───────────────────────────────────── */}
            <div className="ac-bulk-actions">
              <button
                className="ac-analyze-btn"
                onClick={handleAnalyzeAll}
                disabled={bulkLoading}
              >
                {bulkLoading ? <span className="ac-btn-spinner" /> : '🔍'}
                Analyze All Resumes
                <span className="ac-btn-sub">Score only – no DB changes</span>
              </button>

              <button
                className="ac-process-btn"
                onClick={handleProcessAll}
                disabled={bulkLoading}
              >
                {bulkLoading ? <span className="ac-btn-spinner" /> : '⚡'}
                Process All Candidates
                <span className="ac-btn-sub">Score + auto-update statuses</span>
              </button>
            </div>

            {/* Progress Bar */}
            {bulkLoading && (
              <div className="ac-loading-card">
                <div className="ac-loading-spinner" />
                <h3>Processing resumes…</h3>
                <p>Analyzing in batches of 50. Please wait.</p>
                <ProgressBar current={bulkProgress.current} total={bulkProgress.total || candidates.length} label="Resumes Analyzed" />
              </div>
            )}

            {/* Error */}
            {bulkError && <div className="ac-error">{bulkError}</div>}

            {/* Bulk stats banner */}
            {bulkStats && !bulkLoading && (
              <div className={`ac-bulk-banner ${bulkStats.saved ? 'saved' : ''}`}>
                <div className="ac-bulk-banner-main">
                  {bulkStats.saved ? '✅ Statuses saved to database' : '🔍 Analysis complete (preview only)'}
                </div>
                <div className="ac-bulk-banner-counts">
                  <span style={{color:'#16a34a'}}>🏆 Hired: <b>{bulkStats.totalHired}</b></span>
                  <span style={{color:'#7c3aed'}}>✅ Shortlisted: <b>{bulkStats.totalShortlisted}</b></span>
                  <span style={{color:'#dc2626'}}>✕ Rejected: <b>{bulkStats.totalRejected}</b></span>
                  {bulkStats.totalSkipped > 0 &&
                    <span style={{color:'#d97706'}}>⚠ Skipped: <b>{bulkStats.totalSkipped}</b></span>}
                </div>
                <div className="ac-bulk-banner-msg">{bulkStats.message}</div>
                {/* Navigate to Applicants page scoped to the processed job */}
                {bulkStats.saved && bulkStats.processedJobId && (
                  <button
                    className="ac-view-applicants-btn"
                    onClick={() => navigate(`/manager/applicants?jobId=${bulkStats.processedJobId}`)}
                    style={{
                      marginTop: 10,
                      padding: '8px 18px',
                      background: '#4f46e5',
                      color: '#fff',
                      border: 'none',
                      borderRadius: 8,
                      fontWeight: 700,
                      cursor: 'pointer',
                      fontSize: 13,
                    }}
                  >
                    👥 View Applicants for "{bulkStats.processedJobTitle || 'Selected Job'}" →
                  </button>
                )}
              </div>
            )}

            {/* Results Table */}
            {bulkResults.length > 0 && !bulkLoading && (
              <div className="ac-table-wrap">
                <div className="ac-table-toolbar">
                  <input
                    className="ac-search-input"
                    placeholder="🔍 Search by name or email…"
                    value={searchQ}
                    onChange={e => setSearchQ(e.target.value)}
                  />
                  <select className="ac-filter-select" value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
                    <option value="ALL">All Statuses</option>
                    <option value="HIRED">🏆 Hired</option>
                    <option value="SHORTLISTED">✅ Shortlisted</option>
                    <option value="REJECTED">✕ Rejected</option>
                  </select>
                  <span className="ac-count-badge">{filteredResults.length} results</span>
                </div>

                <div className="ac-table-scroll">
                  <div className="ac-vtable" role="table">
                    <div className="ac-vtable-row ac-vtable-header" role="row">
                      <div className="ac-vtable-cell" role="columnheader">#</div>
                      <div className="ac-vtable-cell ac-sortable" role="columnheader" onClick={() => toggleSort('candidateName')}>
                        Candidate{sortIcon('candidateName')}
                      </div>
                      <div className="ac-vtable-cell" role="columnheader">Email</div>
                      <div className="ac-vtable-cell" role="columnheader">Resume</div>
                      <div className="ac-vtable-cell ac-sortable" role="columnheader" onClick={() => toggleSort('atsScore')}>
                        ATS Score{sortIcon('atsScore')}
                      </div>
                      <div className="ac-vtable-cell" role="columnheader">Match %</div>
                      <div className="ac-vtable-cell" role="columnheader">Status</div>
                    </div>

                    {filteredResults.length >= VIRTUALIZE_THRESHOLD ? (
                      <List
                        style={{ height: Math.min(filteredResults.length, 8) * RESULT_ROW_HEIGHT }}
                        rowComponent={ResultRow}
                        rowCount={filteredResults.length}
                        rowHeight={RESULT_ROW_HEIGHT}
                        rowProps={{ results: filteredResults }}
                      />
                    ) : (
                      filteredResults.map((r, i) => (
                        <ResultRow key={r.resumeId} index={i} results={filteredResults} style={undefined} />
                      ))
                    )}
                  </div>
                </div>
              </div>
            )}
          </>
        )}

        {/* ════════ SINGLE MODE ══════════════════════════════════════ */}
        {view === 'single' && (
          <>
            {!selected && (
              <div className="ac-input-card">
                <div className="ac-input-label">
                  <span className="ac-input-icon">👥</span>
                  <div>
                    <h3>Candidate Resumes</h3>
                    <p>Click "Run ATS" to score an individual candidate's resume</p>
                  </div>
                </div>

                {loadingList && (
                  <div style={{ padding:'20px', textAlign:'center', color:'#64748b' }}>
                    <div className="ac-btn-spinner" style={{ display:'inline-block', marginRight:8 }} />
                    Loading candidates…
                  </div>
                )}
                {listError && <div className="ac-error">{listError}</div>}

                {!loadingList && candidates.length === 0 && !listError && (
                  <div style={{ padding:'20px', textAlign:'center', color:'#64748b' }}>
                    No resumes uploaded yet.
                  </div>
                )}

                {candidates.length > 0 && (
                  <div className="ac-candidates-list">
                    {candidates.map(c => (
                      <div key={c.resumeId} className="ac-candidate-row">
                        <div className="ac-avatar">{c.candidateName?.[0]?.toUpperCase()}</div>
                        <div className="ac-cand-details">
                          <div className="ac-cand-name">{c.candidateName}</div>
                          <div className="ac-cand-email">{c.candidateEmail}</div>
                          <div className="ac-cand-file">📄 {c.fileName}
                            {!c.hasText && <span className="ac-no-text-warn">⚠ No text extracted</span>}
                          </div>
                        </div>
                        <button
                          className="ac-run-btn"
                          onClick={() => runSingleAts(c)}
                          disabled={!c.hasText}
                          title={!c.hasText ? 'Resume text could not be extracted' : ''}
                        >🤖 Run ATS</button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {selected && (
              <div className="ac-action-bar">
                <button className="ac-reset-btn" onClick={() => { setSelected(null); setSingleResult(null); setSingleError(''); }}>
                  ↩ Back to Candidates
                </button>
                <div style={{ fontSize:14, color:'#64748b' }}>
                  Checking: <strong>{selected.candidateName}</strong> — {selected.fileName}
                </div>
              </div>
            )}

            {singleError && <div className="ac-error">{singleError}</div>}

            {singleLoading && (
              <div className="ac-loading-card">
                <div className="ac-loading-spinner" />
                <h3>Analyzing resume…</h3>
                <p>Running keyword-based ATS scoring on {selected?.candidateName}'s resume</p>
              </div>
            )}

            {singleResult && !singleLoading && (
              <div className="ac-result">
                <div className="ac-result-top">
                  <div>
                    <h2>ATS Analysis Report</h2>
                    <p>{selected?.candidateName} — {selected?.fileName}</p>
                    <StatusBadge status={
                      singleResult.atsScore >= 80 ? 'HIRED' :
                      singleResult.atsScore >= 60 ? 'SHORTLISTED' : 'REJECTED'
                    } />
                  </div>
                  <ScoreRing score={singleResult.atsScore} />
                </div>

                <div className="ac-result-body">
                  {singleResult.matchedKeywords?.length > 0 && (
                    <div className="ac-keywords-row">
                      <div className="ac-section">
                        <h4>✅ Matched Keywords ({singleResult.matchedKeywords.length})</h4>
                        <div className="ac-chips">
                          {singleResult.matchedKeywords.map((kw, i) => (
                            <span key={i} className="ac-chip ac-chip-match">{kw}</span>
                          ))}
                        </div>
                      </div>
                      {singleResult.missingKeywords?.length > 0 && (
                        <div className="ac-section">
                          <h4>❌ Missing Keywords ({singleResult.missingKeywords.length})</h4>
                          <div className="ac-chips">
                            {singleResult.missingKeywords.map((kw, i) => (
                              <span key={i} className="ac-chip ac-chip-miss">{kw}</span>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {singleResult.suggestions?.length > 0 && (
                    <div className="ac-section">
                      <h4>💡 Recommendations</h4>
                      <div className="ac-suggestions">
                        {singleResult.suggestions.map((s, i) => (
                          <div key={i} className="ac-suggestion">
                            <span className="ac-suggestion-arrow">→</span>
                            <span>{s}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </>
        )}

      </div>
    </div>
  );
}