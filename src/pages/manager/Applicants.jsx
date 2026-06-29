import { useState, useCallback, useMemo, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useFetch } from '../../hooks/useHooks';
import api from '../../services/api';
import './Applicants.css';

/* ─── Toast ─────────────────────────────────────────────────────── */
function Toast({ message, type = 'success', onClose }) {
  return (
    <div className={`ats-toast ats-toast--${type}`}>
      <span>{message}</span>
      <button className="ats-toast-close" onClick={onClose}>×</button>
    </div>
  );
}

/* ─── Status Badge ───────────────────────────────── */
function StatusBadge({ status }) {
  const cfg = {
    HIRED:              { bg: '#dcfce7', color: '#16a34a', icon: '🏆', label: 'Hired' },
    SHORTLISTED:        { bg: '#ede9fe', color: '#7c3aed', icon: '✅', label: 'Shortlisted' },
    REJECTED:           { bg: '#fee2e2', color: '#dc2626', icon: '✕',  label: 'Rejected' },
    APPLIED:            { bg: '#dbeafe', color: '#2563eb', icon: '📋', label: 'Applied' },
    INTERVIEW_SCHEDULED:{ bg: '#fef9c3', color: '#b45309', icon: '📅', label: 'Interview Scheduled' },
  };
  const s = cfg[status] || { bg: '#f3f4f6', color: '#6b7280', icon: '•', label: status };
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      fontSize: 11, fontWeight: 700, padding: '3px 10px',
      borderRadius: 20, background: s.bg, color: s.color,
      whiteSpace: 'nowrap',
    }}>
      {s.icon} {s.label}
    </span>
  );
}

/* ─── Skeleton Card ──────────────────────────────── */
function SkeletonCard() {
  return (
    <div className="apps-card" style={{ opacity: 0.55 }}>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 12 }}>
        <div style={{ width: 40, height: 40, borderRadius: '50%', background: '#e5e7eb' }} />
        <div style={{ flex: 1 }}>
          <div style={{ height: 14, background: '#e5e7eb', borderRadius: 6, marginBottom: 6, width: '40%' }} />
          <div style={{ height: 11, background: '#e5e7eb', borderRadius: 6, width: '60%' }} />
        </div>
      </div>
      <div style={{ height: 8, background: '#e5e7eb', borderRadius: 6, marginBottom: 8 }} />
      <div style={{ height: 8, background: '#e5e7eb', borderRadius: 6, width: '70%' }} />
    </div>
  );
}


/* ═══════════════════════════════════════════════════
   MAIN — Applicants Page
═══════════════════════════════════════════════════ */
export default function Applicants() {
  const { data: jobs, loading: jobsLoading } = useFetch('/api/manager/jobs');
  const [searchParams] = useSearchParams();

  const [selectedJob,  setSelectedJob]  = useState(null);
  const [applicants,   setApplicants]   = useState([]);
  const [loadingApps,  setLoadingApps]  = useState(false);
  const [toast,        setToast]        = useState(null);

  // Filters
  const [filterStatus, setFilterStatus] = useState('ALL');
  const [sortField,    setSortField]    = useState('appliedAt');
  const [sortDir,      setSortDir]      = useState('desc');
  const [searchQ,      setSearchQ]      = useState('');

  const showToast = useCallback((message, type = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 5000);
  }, []);

  // ── Auto-select job from ?jobId= query param (set by AtsChecker after processing) ─
  useEffect(() => {
    const jobIdParam = searchParams.get('jobId');
    if (!jobIdParam || !jobs?.length || selectedJob) return;
    const job = jobs.find(j => String(j.id) === String(jobIdParam));
    if (job) loadApplicants(job);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobs, searchParams]);

  // ── Load applicants for selected job ────────────────────────────────
  // /api/manager/jobs already returns only the current recruiter's jobs,
  // and /api/manager/jobs/{id}/applicants returns applicants for that job.
  // No additional client-side recruiter ID filtering is needed — doing so
  // would silently drop all applicants if the API doesn't echo recruiterId.
  const loadApplicants = async (job) => {
    setSelectedJob(job);
    setLoadingApps(true);
    setFilterStatus('ALL');
    setSortField('appliedAt');
    setSortDir('desc');
    setSearchQ('');
    try {
      const res = await api.get(`/api/manager/jobs/${job.id}/applicants`);
      setApplicants(res.data || []);
    } catch {
      setApplicants([]);
      showToast('Failed to load applicants. Please try again.', 'error');
    } finally {
      setLoadingApps(false);
    }
  };

  // ── Status counts for filter tabs ─────────────────────────────────────
  // Each count reflects exactly the applicants in that status bucket.
  // "ALL" shows the total for this job (all statuses combined).
  // "APPLIED" shows only those who haven't been actioned yet.
  const counts = useMemo(() => ({
    ALL:                 applicants.length,
    APPLIED:             applicants.filter(a => a.status === 'APPLIED').length,
    SHORTLISTED:         applicants.filter(a => a.status === 'SHORTLISTED').length,
    HIRED:               applicants.filter(a => a.status === 'HIRED').length,
    REJECTED:            applicants.filter(a => a.status === 'REJECTED').length,
    INTERVIEW_SCHEDULED: applicants.filter(a => a.status === 'INTERVIEW_SCHEDULED').length,
  }), [applicants]);

  const filtered = applicants
    .filter(a => filterStatus === 'ALL' || a.status === filterStatus)
    .filter(a =>
      searchQ === '' ||
      a.applicantName?.toLowerCase().includes(searchQ.toLowerCase()) ||
      a.applicantEmail?.toLowerCase().includes(searchQ.toLowerCase())
    )
    .sort((a, b) => {
      const mul = sortDir === 'asc' ? 1 : -1;
      if (sortField === 'applicantName') return mul * (a.applicantName || '').localeCompare(b.applicantName || '');
      if (sortField === 'appliedAt')     return mul * (a.appliedAt || '').localeCompare(b.appliedAt || '');
      return 0;
    });

  if (jobsLoading) return (
    <div className="apps-loading" style={{ textAlign: 'center', padding: '3rem' }}>
      <div className="apps-spinner" style={{ margin: '0 auto 12px' }} />
      Loading jobs…
    </div>
  );

  return (
    <div className="apps-layout">

      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}

      {/* ── Sidebar ─────────────────────────────────────────── */}
      <div className="apps-sidebar">
        <div className="apps-sidebar-head">
          <span className="apps-sidebar-icon">💼</span>
          <span>Your Job Postings</span>
        </div>
        {!jobs?.length && <div className="apps-sidebar-empty">No jobs posted yet</div>}
        {jobs?.map(job => (
          <div
            key={job.id}
            className={`apps-job-card ${selectedJob?.id === job.id ? 'apps-job-active' : ''}`}
            onClick={() => loadApplicants(job)}
          >
            <div className="apps-job-title">{job.title}</div>
            <div className="apps-job-loc">📍 {job.location}</div>
          </div>
        ))}
      </div>

      {/* ── Main ────────────────────────────────────────────── */}
      <div className="apps-main">

        {!selectedJob && (
          <div className="apps-empty-state">
            <div className="apps-empty-icon">👈</div>
            <h2>Select a Job</h2>
            <p>Choose a job posting from the sidebar to view its applicants.</p>
          </div>
        )}

        {selectedJob && (
          <>
            {/* Page header */}
            <div className="apps-page-header">
              <div>
                <h1>{selectedJob.title}</h1>
                <p>
                  {counts.APPLIED} applied · {counts.SHORTLISTED} shortlisted · {counts.HIRED} hired
                  {counts.REJECTED > 0 ? ` · ${counts.REJECTED} rejected` : ''}
                  {' '}· {selectedJob.location}
                </p>
              </div>
            </div>

            {/* Status filter tabs */}
            <div className="apps-status-tabs">
              {['ALL', 'APPLIED', 'SHORTLISTED', 'HIRED', 'REJECTED', 'INTERVIEW_SCHEDULED'].map(s => (
                // Hide tabs with zero count (except ALL and APPLIED)
                (s === 'ALL' || s === 'APPLIED' || counts[s] > 0) && (
                <button
                  key={s}
                  className={`apps-tab-btn ${filterStatus === s ? 'active' : ''}`}
                  onClick={() => setFilterStatus(s)}
                >
                  {s === 'HIRED' ? '🏆'
                    : s === 'SHORTLISTED' ? '✅'
                    : s === 'REJECTED' ? '✕'
                    : s === 'APPLIED' ? '📋'
                    : s === 'INTERVIEW_SCHEDULED' ? '📅'
                    : '👥'}
                  {' '}{s === 'INTERVIEW_SCHEDULED' ? 'Interview' : s}{' '}
                  <span className="apps-tab-count">{counts[s] ?? 0}</span>
                </button>
                )
              ))}
            </div>

            {/* Search + sort toolbar */}
            <div className="apps-toolbar">
              <input
                className="apps-search-input"
                placeholder="🔍 Search by name or email…"
                value={searchQ}
                onChange={e => setSearchQ(e.target.value)}
              />
              <select className="apps-sort-select"
                value={`${sortField}:${sortDir}`}
                onChange={e => {
                  const [f, d] = e.target.value.split(':');
                  setSortField(f); setSortDir(d);
                }}>
                <option value="appliedAt:desc">Applied (Newest)</option>
                <option value="appliedAt:asc">Applied (Oldest)</option>
                <option value="applicantName:asc">Name (A → Z)</option>
                <option value="applicantName:desc">Name (Z → A)</option>
              </select>
            </div>

            {loadingApps && [1, 2, 3].map(i => <SkeletonCard key={i} />)}

            {!loadingApps && !filtered.length && (
              <div className="apps-no-apps">
                <div className="apps-empty-icon">📭</div>
                <p>{applicants.length ? 'No results for this filter.' : 'No applicants yet for this position.'}</p>
              </div>
            )}

            {!loadingApps && filtered.map(app => (
              <div key={app.id} className="apps-card">
                <div className="apps-card-header">
                  <div className="apps-candidate-info">
                    <div className="apps-avatar">{app.applicantName?.[0]?.toUpperCase()}</div>
                    <div>
                      <div className="apps-name">{app.applicantName}</div>
                      <div className="apps-email">{app.applicantEmail}</div>
                    </div>
                  </div>
                  <div className="apps-card-meta">
                    <StatusBadge status={app.status} />
                    {app.appliedAt && (
                      <div className="apps-applied-at">
                        Applied {new Date(app.appliedAt).toLocaleDateString()}
                      </div>
                    )}
                  </div>
                </div>

                <div className="apps-resume-row">
                  {app.resumeId ? (
                    <>
                      <span className="apps-resume-label">📎 Resume:</span>
                      <a
                        href={`${import.meta.env.VITE_API_URL || ''}/api/manager/resume/${app.resumeId}/download`}
                        className="apps-resume-link" target="_blank" rel="noopener noreferrer"
                      >Download ⬇️</a>
                    </>
                  ) : app.resumeUrl ? (
                    <>
                      <span className="apps-resume-label">📎 Resume:</span>
                      <a href={app.resumeUrl} target="_blank" rel="noopener noreferrer" className="apps-resume-link">
                        View Resume ↗
                      </a>
                    </>
                  ) : (
                    <span className="apps-no-resume">⚠️ No resume uploaded</span>
                  )}
                </div>

                {app.coverLetter && (
                  <div className="apps-cover">"{app.coverLetter}"</div>
                )}
              </div>
            ))}
          </>
        )}
      </div>

    </div>
  );
}