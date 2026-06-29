import { useParams, useNavigate } from 'react-router-dom';
import { useFetch } from '../../hooks/useHooks';

/**
 * InterviewReport — recruiter-facing view of a completed AI interview.
 * Route: /manager/interview/:sessionId/report
 */
export default function InterviewReport() {
  const { sessionId } = useParams();
  const navigate      = useNavigate();
  const { data: report, loading, error } = useFetch(`/api/interview/${sessionId}/report`);

  if (loading) {
    return (
      <div style={{ display:'flex', alignItems:'center', justifyContent:'center', minHeight:'60vh', flexDirection:'column', gap:12 }}>
        <div style={{ fontSize:32 }}>⏳</div>
        <p style={{ color:'#6b7280' }}>Loading report…</p>
      </div>
    );
  }

  if (error || !report) {
    return (
      <div style={{ display:'flex', alignItems:'center', justifyContent:'center', minHeight:'60vh', flexDirection:'column', gap:12 }}>
        <div style={{ fontSize:32 }}>⚠️</div>
        <p style={{ color:'#dc2626' }}>{error || 'Report not found.'}</p>
        <button onClick={() => navigate(-1)} style={{ padding:'8px 18px', borderRadius:8, border:'1px solid #e5e7eb', cursor:'pointer' }}>← Back</button>
      </div>
    );
  }

  const session    = report.session    || {};
  const evaluation = report.evaluation || {};
  const questions  = report.questions  || [];
  const answers    = report.answers    || [];

  const score = evaluation.overallRating;
  const scoreColor = score >= 75 ? '#16a34a' : score >= 50 ? '#d97706' : '#dc2626';

  return (
    <div style={{ maxWidth:860, margin:'0 auto', padding:'28px 24px' }}>

      {/* Header */}
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:24, flexWrap:'wrap', gap:12 }}>
        <div>
          <h1 style={{ margin:'0 0 4px', fontSize:22, fontWeight:700, color:'#111827' }}>
            Interview Report
          </h1>
          <p style={{ margin:0, fontSize:13, color:'#6b7280' }}>
            {session.candidateName} · {session.positionTitle}
          </p>
        </div>
        <button
          onClick={() => navigate(-1)}
          style={{ padding:'8px 18px', borderRadius:8, border:'1px solid #e5e7eb', cursor:'pointer', fontSize:13, color:'#374151' }}
        >
          ← Back
        </button>
      </div>

      {/* Score card */}
      {score != null && (
        <div style={{
          display:'flex', alignItems:'center', gap:20,
          padding:'20px 24px', background:'#f9fafb',
          border:'1px solid #e5e7eb', borderRadius:12, marginBottom:24,
        }}>
          <div style={{
            width:72, height:72, borderRadius:'50%',
            border:`4px solid ${scoreColor}`,
            display:'flex', alignItems:'center', justifyContent:'center',
            fontSize:20, fontWeight:800, color:scoreColor, flexShrink:0,
          }}>
            {Math.round(score)}
          </div>
          <div>
            <div style={{ fontSize:16, fontWeight:700, color:'#111827', marginBottom:4 }}>
              Overall Score
            </div>
            <div style={{ fontSize:13, color:'#6b7280' }}>
              Recommendation: <strong style={{ color: scoreColor }}>
                {evaluation.finalRecommendation || '—'}
              </strong>
            </div>
            {evaluation.completionPercentage != null && (
              <div style={{ fontSize:12, color:'#9ca3af', marginTop:2 }}>
                Completion: {Math.round(evaluation.completionPercentage)}% ·{' '}
                {evaluation.totalQuestionsAnswered}/{evaluation.totalQuestionsAsked} questions answered
              </div>
            )}
          </div>
        </div>
      )}

      {/* Skill breakdown */}
      {evaluation.communicationScore != null && (
        <div style={{ padding:'20px 24px', border:'1px solid #e5e7eb', borderRadius:12, marginBottom:24 }}>
          <h2 style={{ margin:'0 0 16px', fontSize:15, fontWeight:700, color:'#111827' }}>Skill Breakdown</h2>
          {[
            ['Communication',    evaluation.communicationScore],
            ['Technical Skills', evaluation.technicalSkillsScore],
            ['Domain Knowledge', evaluation.domainKnowledgeScore],
            ['Confidence',       evaluation.confidenceScore],
            ['Problem Solving',  evaluation.problemSolvingScore],
          ].map(([label, val]) => val != null && (
            <div key={label} style={{ marginBottom:12 }}>
              <div style={{ display:'flex', justifyContent:'space-between', fontSize:13, marginBottom:4 }}>
                <span style={{ color:'#374151' }}>{label}</span>
                <span style={{ fontWeight:600, color:'#111827' }}>{Math.round(val)}%</span>
              </div>
              <div style={{ height:6, background:'#e5e7eb', borderRadius:99, overflow:'hidden' }}>
                <div style={{ height:'100%', width:`${val}%`, background: val >= 75 ? '#16a34a' : val >= 50 ? '#d97706' : '#dc2626', borderRadius:99 }} />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Strengths / Weaknesses */}
      {(evaluation.strengths || evaluation.weaknesses) && (
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:16, marginBottom:24 }}>
          {evaluation.strengths && (
            <div style={{ padding:'16px 20px', background:'#f0fdf4', border:'1px solid #bbf7d0', borderRadius:12 }}>
              <h3 style={{ margin:'0 0 10px', fontSize:14, fontWeight:700, color:'#15803d' }}>✅ Strengths</h3>
              <p style={{ margin:0, fontSize:13, color:'#166534', lineHeight:1.6, whiteSpace:'pre-line' }}>{evaluation.strengths}</p>
            </div>
          )}
          {evaluation.weaknesses && (
            <div style={{ padding:'16px 20px', background:'#fef2f2', border:'1px solid #fecaca', borderRadius:12 }}>
              <h3 style={{ margin:'0 0 10px', fontSize:14, fontWeight:700, color:'#b91c1c' }}>⚠️ Areas to Improve</h3>
              <p style={{ margin:0, fontSize:13, color:'#991b1b', lineHeight:1.6, whiteSpace:'pre-line' }}>{evaluation.weaknesses}</p>
            </div>
          )}
        </div>
      )}

      {/* Q&A transcript */}
      {questions.length > 0 && (
        <div style={{ border:'1px solid #e5e7eb', borderRadius:12, overflow:'hidden', marginBottom:24 }}>
          <div style={{ padding:'14px 20px', background:'#f9fafb', borderBottom:'1px solid #e5e7eb' }}>
            <h2 style={{ margin:0, fontSize:15, fontWeight:700, color:'#111827' }}>Interview Transcript</h2>
          </div>
          {questions.map((q, idx) => {
            const ans = answers.find(a => a.questionId === q.id);
            return (
              <div key={q.id} style={{ padding:'16px 20px', borderBottom: idx < questions.length - 1 ? '1px solid #f3f4f6' : 'none' }}>
                <div style={{ fontSize:12, color:'#6366f1', fontWeight:600, marginBottom:6, textTransform:'uppercase', letterSpacing:'0.05em' }}>
                  Q{idx + 1} · {q.questionType}
                </div>
                <p style={{ margin:'0 0 10px', fontSize:14, fontWeight:600, color:'#111827', lineHeight:1.5 }}>
                  {q.questionText}
                </p>
                {ans ? (
                  <div style={{ padding:'10px 14px', background:'#f8faff', border:'1px solid #e0e7ff', borderRadius:8 }}>
                    <p style={{ margin:'0 0 6px', fontSize:13, color:'#374151', lineHeight:1.6 }}>{ans.answerText}</p>
                    {ans.evaluationFeedback && (
                      <p style={{ margin:0, fontSize:12, color:'#6b7280', fontStyle:'italic' }}>
                        💬 {ans.evaluationFeedback}
                      </p>
                    )}
                    <div style={{ display:'flex', gap:16, marginTop:8, fontSize:11, color:'#9ca3af' }}>
                      {ans.durationSeconds  != null && <span>⏱ {ans.durationSeconds}s</span>}
                      {ans.wordCount        != null && <span>📝 {ans.wordCount} words</span>}
                      {ans.relevanceScore   != null && <span>🎯 Relevance {Math.round(ans.relevanceScore * 100)}%</span>}
                      {ans.clarityScore     != null && <span>💡 Clarity {Math.round(ans.clarityScore * 100)}%</span>}
                    </div>
                  </div>
                ) : (
                  <div style={{ fontSize:13, color:'#9ca3af', fontStyle:'italic' }}>No answer recorded.</div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
