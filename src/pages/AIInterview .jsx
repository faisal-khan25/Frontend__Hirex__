import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useInterview } from '../context/Interviewcontext';
import { useSpeechSynthesis } from '../hooks/useSpeechSynthesis ';
import { useFullscreen } from './UseFullscreen';
import AIAvatar from './Aiavatar';
import TimerBar from './TimerBar';
import ProgressTracker from './Progresstracker';
import { AIMessage, CandidateMessage, TypingIndicator } from './MessageBubbles';
import AnswerInputArea from './AnswerInputArea ';
import "./Interview.css";

/**
 * AIInterview Page Component
 *
 * KEY FIXES:
 * 1. state.aiError (non-fatal) → shown as a dismissible banner, not an error screen.
 * 2. Answer submission failures (AI) → toast banner, interview continues.
 * 3. nextQuestion() returning null → completeInterview() called (not an error).
 * 4. Empty/null AI response → fallback text, never crashes.
 * 5. handleSubmitAnswer error handling distinguishes AI errors from real failures.
 */
const AIInterview = ({ applicationId }) => {
  const {
    state,
    initializeSession,
    submitAnswer,
    evaluateAnswer,
    nextQuestion,
    completeInterview,
    setAISpeaking,
    setAIThinking,
    setAIListening,
    clearAIError,
  } = useInterview();

  const { speak, stop, isSupported: speechSupported } = useSpeechSynthesis();
  const { elementRef: fullscreenRef, toggleFullscreen } = useFullscreen();

  const [messages,     setMessages]     = useState([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [voiceEnabled, setVoiceEnabled] = useState(true);
  const messagesEndRef = useRef(null);

  // Helper: extract question text regardless of which field the backend uses
  const getQuestionText = (q) =>
    q?.questionText || q?.text || q?.question || '';

  // ── speakQuestion ─────────────────────────────────────────────────────────
  const speakQuestion = useCallback(
    async (question) => {
      const questionText = getQuestionText(question);
      if (!questionText) return;

      if (!voiceEnabled || !speechSupported) {
        setMessages((prev) => [
          ...prev,
          { id: `ai-${Date.now()}`, role: 'ai', text: questionText, timestamp: Date.now(), isNew: true },
        ]);
        return;
      }

      try {
        setAISpeaking(true);
        await speak(questionText, {
          rate:    0.95,
          pitch:   1,
          volume:  1,
          onStart: () => {
            setMessages((prev) => [
              ...prev,
              { id: `ai-${Date.now()}`, role: 'ai', text: questionText, timestamp: Date.now(), isNew: true },
            ]);
          },
          onEnd:   () => setAISpeaking(false),
        });
      } catch (err) {
        console.error('Speech error:', err);
        setAISpeaking(false);
        setMessages((prev) => [
          ...prev,
          { id: `ai-${Date.now()}`, role: 'ai', text: questionText, timestamp: Date.now(), isNew: false },
        ]);
      }
    },
    [voiceEnabled, speechSupported, speak, setAISpeaking]
  );

  // ── Initialize once on mount ────────────────────────────────────────────
  const initializedRef = useRef(false);
  useEffect(() => {
    if (!applicationId) {
      console.error('AIInterview: applicationId prop is missing');
      return;
    }
    if (initializedRef.current) return;
    initializedRef.current = true;

    const init = async () => {
      try {
        await initializeSession(applicationId);
      } catch (err) {
        console.error('Failed to initialize interview:', err);
        // Don't alert here — the context sets state.error for fatal errors,
        // and state.aiError for non-fatal ones. Both are shown in the render below.
        initializedRef.current = false; // allow retry
      }
    };
    init();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [applicationId]);

  // ── Speak first question once session is ready ──────────────────────────
  const lastSpokenIdRef = useRef(null);
  useEffect(() => {
    if (
      state.currentQuestion &&
      state.currentQuestion.id !== lastSpokenIdRef.current
    ) {
      lastSpokenIdRef.current = state.currentQuestion.id;
      speakQuestion(state.currentQuestion);
    }
  }, [state.currentQuestion, speakQuestion]);

  // ── Auto-scroll ──────────────────────────────────────────────────────────
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // ── Submit answer ────────────────────────────────────────────────────────
  const handleSubmitAnswer = useCallback(
    async (answerText) => {
      if (!state.currentQuestion || isSubmitting) return;

      // Guard against blank submissions
      if (!answerText?.trim()) {
        setMessages((prev) => [
          ...prev,
          {
            id:        `warn-${Date.now()}`,
            role:      'ai',
            text:      "Please provide an answer before continuing.",
            timestamp: Date.now(),
          },
        ]);
        return;
      }

      setIsSubmitting(true);
      const duration = Math.floor(
        (Date.now() - (state.currentQuestion.askedAt
          ? new Date(state.currentQuestion.askedAt).getTime()
          : Date.now())) / 1000
      );

      try {
        // 1. Show candidate message
        setMessages((prev) => [
          ...prev,
          { id: `candidate-${Date.now()}`, role: 'candidate', text: answerText, timestamp: Date.now(), duration },
        ]);

        // 2. Show thinking indicator
        setAIThinking(true);
        const thinkingId = `thinking-${Date.now()}`;
        setMessages((prev) => [...prev, { id: thinkingId, role: 'ai', variant: 'loading' }]);

        // 3. Submit to backend (AI evaluation happens server-side; may fall back gracefully)
        const result = await submitAnswer(answerText, { duration });

        // 4. Get feedback — use AI result or a friendly default
        const feedbackText =
          result?.evaluationFeedback ||
          'Thank you for your answer. Moving on to the next question.';

        // 5. Remove thinking indicator, show feedback
        const showFeedback = () => {
          setMessages((prev) => [
            ...prev.filter((m) => m.id !== thinkingId),
            { id: `feedback-${Date.now()}`, role: 'ai', text: feedbackText, timestamp: Date.now() },
          ]);
        };

        if (voiceEnabled && speechSupported) {
          await speak(feedbackText, {
            rate:    0.95,
            onStart: () => { setAISpeaking(true); showFeedback(); },
            onEnd:   () => setAISpeaking(false),
          });
        } else {
          showFeedback();
        }

        // 6. Move to next question
        setTimeout(async () => {
          try {
            const nextQ = await nextQuestion();
            if (nextQ) {
              setMessages((prev) => [
                ...prev,
                {
                  id:        `transition-${Date.now()}`,
                  role:      'ai',
                  text:      "Let's move on to the next question.",
                  timestamp: Date.now(),
                },
              ]);
            } else {
              // No more questions → interview complete (not an error)
              setMessages((prev) => [
                ...prev,
                {
                  id:        `complete-${Date.now()}`,
                  role:      'ai',
                  text:      'Thank you for completing this interview! Your responses have been recorded and will be reviewed.',
                  timestamp: Date.now(),
                },
              ]);
              await completeInterview();
            }
          } catch (nextErr) {
            console.error('Error advancing to next question:', nextErr);
            // Non-fatal: show a message but don't crash
            setMessages((prev) => [
              ...prev,
              {
                id:        `nexterr-${Date.now()}`,
                role:      'ai',
                text:      'There was a temporary issue loading the next question. Please try submitting again or refresh the page.',
                timestamp: Date.now(),
              },
            ]);
          }
        }, 2000);

      } catch (err) {
        console.error('Error submitting answer:', err);
        // Remove thinking indicator
        setMessages((prev) => prev.filter((m) => !m.id?.startsWith('thinking-')));
        // Show a user-friendly error message in the chat instead of an alert
        const userMsg = err.isAIError
          ? 'AI service is temporarily unavailable. Please wait a moment and try again.'
          : (err.message || 'There was an error submitting your answer. Please try again.');
        setMessages((prev) => [
          ...prev,
          { id: `err-${Date.now()}`, role: 'ai', text: `⚠️ ${userMsg}`, timestamp: Date.now() },
        ]);
      } finally {
        setAIThinking(false);
        setIsSubmitting(false);
      }
    },
    [
      state.currentQuestion,
      isSubmitting,
      submitAnswer,
      nextQuestion,
      completeInterview,
      speakQuestion,
      voiceEnabled,
      speechSupported,
      speak,
      setAISpeaking,
      setAIThinking,
    ]
  );

  // ── Exit handler ─────────────────────────────────────────────────────────
  const handleExit = useCallback(() => {
    if (window.confirm('Are you sure you want to exit? Your progress will be saved.')) {
      stop();
      completeInterview();
      window.location.href = '/jobseeker/applications';
    }
  }, [stop, completeInterview]);

  // ── Loading / waiting screen ─────────────────────────────────────────────
  if (state.status === 'INITIALIZING' || (!state.currentQuestion && state.status !== 'COMPLETED')) {
    const isError = !!state.error;
    return (
      <div className="interview-container" style={{ height: '100vh' }}>
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          height: '100%', flexDirection: 'column', gap: '24px',
        }}>
          <div style={{ fontSize: '48px', animation: isError ? 'none' : 'pulse 1.5s ease-in-out infinite' }}>
            {isError ? '⚠️' : '🤖'}
          </div>
          <div style={{ textAlign: 'center', maxWidth: '480px', padding: '0 20px' }}>
            <h2 style={{ margin: '0 0 8px 0', fontSize: '20px' }}>
              {isError ? 'Interview Unavailable' : 'Initializing Interview'}
            </h2>
            <p style={{ margin: '0 0 16px', opacity: 0.7, fontSize: '14px', lineHeight: '1.6' }}>
              {isError
                ? state.error
                : 'Preparing your personalized interview experience…'}
            </p>
            {/* Non-fatal AI error during init */}
            {!isError && state.aiError && (
              <div style={{
                background: 'rgba(245,158,11,0.1)',
                border: '1px solid rgba(245,158,11,0.4)',
                borderRadius: '8px', padding: '12px 16px',
                color: '#fbbf24', fontSize: '13px', marginBottom: '12px',
              }}>
                ⚠️ {state.aiError}
              </div>
            )}
            {isError && (
              <button
                onClick={() => window.location.href = '/jobseeker/applications'}
                style={{
                  background: 'rgba(99,102,241,0.15)',
                  border: '1px solid rgba(99,102,241,0.4)',
                  color: '#818cf8', borderRadius: '8px',
                  padding: '8px 20px', cursor: 'pointer', fontSize: '14px',
                }}
              >
                ← Back to Applications
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ── Completed screen ─────────────────────────────────────────────────────
  if (state.status === 'COMPLETED') {
    return (
      <div className="interview-container" style={{ height: '100vh' }}>
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          height: '100%', flexDirection: 'column', gap: '24px',
        }}>
          <div style={{ fontSize: '64px' }}>🎉</div>
          <div style={{ textAlign: 'center', maxWidth: '480px', padding: '0 20px' }}>
            <h2 style={{ margin: '0 0 8px 0', fontSize: '24px' }}>Interview Complete!</h2>
            <p style={{ margin: '0 0 16px', opacity: 0.7, fontSize: '15px', lineHeight: '1.6' }}>
              Thank you for completing the interview. Your responses have been recorded and
              will be reviewed by the hiring team.
            </p>
            {state.aiError && (
              <p style={{ fontSize: '13px', opacity: 0.6, marginBottom: '16px' }}>
                ⚠️ {state.aiError}
              </p>
            )}
            <button
              onClick={() => window.location.href = '/jobseeker/applications'}
              style={{
                background: 'rgba(99,102,241,0.15)',
                border: '1px solid rgba(99,102,241,0.4)',
                color: '#818cf8', borderRadius: '8px',
                padding: '10px 24px', cursor: 'pointer', fontSize: '14px',
              }}
            >
              ← Back to Applications
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Main interview UI ────────────────────────────────────────────────────
  return (
    <div
      className="interview-container"
      ref={fullscreenRef}
      style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}
    >
      <TimerBar
        onFullscreenToggle={toggleFullscreen}
        onVoiceToggle={setVoiceEnabled}
        onExit={handleExit}
        maxDuration={1800}
      />

      {/* Non-fatal AI error banner */}
      {state.aiError && (
        <div style={{
          background: 'rgba(245,158,11,0.1)',
          border:     '1px solid rgba(245,158,11,0.3)',
          borderRadius: 0, padding: '10px 20px',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          fontSize: '13px', color: '#fbbf24',
        }}>
          <span>⚠️ {state.aiError}</span>
          <button
            onClick={clearAIError}
            style={{
              background: 'transparent', border: 'none', color: '#fbbf24',
              cursor: 'pointer', fontSize: '16px', padding: '0 4px',
            }}
            aria-label="Dismiss"
          >✕</button>
        </div>
      )}

      <div style={{
        flex: 1, display: 'grid',
        gridTemplateColumns: '280px 1fr',
        gap: '20px', padding: '20px',
        overflow: 'hidden', minWidth: 0,
      }}>
        {/* Left — Avatar + Progress */}
        <div style={{
          display: 'flex', flexDirection: 'column', gap: '24px',
          overflow: 'hidden', padding: '20px',
          background: 'rgba(13, 14, 26, 0.3)',
          borderRadius: '16px',
          border: '1px solid rgba(99, 102, 241, 0.1)',
          minWidth: 0,
        }}>
          <div style={{ display: 'flex', justifyContent: 'center' }}>
            <AIAvatar size="md" />
          </div>
          <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
            <ProgressTracker />
          </div>
        </div>

        {/* Right — Chat + Input */}
        <div style={{
          display: 'flex', flexDirection: 'column', gap: '16px',
          overflow: 'hidden', padding: '20px',
          background: 'rgba(13, 14, 26, 0.3)',
          borderRadius: '16px',
          border: '1px solid rgba(99, 102, 241, 0.1)',
          minWidth: 0,
        }}>
          <div className="chat-messages" style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
            {messages.map((msg) => {
              if (msg.role === 'ai') {
                if (msg.variant === 'loading') return <TypingIndicator key={msg.id} />;
                return (
                  <AIMessage
                    key={msg.id}
                    text={msg.text}
                    isNew={msg.isNew}
                    hasTypingAnimation={msg.isNew}
                  />
                );
              }
              if (msg.role === 'candidate') {
                return (
                  <CandidateMessage
                    key={msg.id}
                    text={msg.text}
                    timestamp={msg.timestamp}
                    duration={msg.duration}
                  />
                );
              }
              return null;
            })}
            <div ref={messagesEndRef} />
          </div>

          <AnswerInputArea
            onSubmit={handleSubmitAnswer}
            enableVoiceInput={voiceEnabled}
            maxLength={2000}
            disabled={isSubmitting}
          />
        </div>
      </div>
    </div>
  );
};

export default AIInterview;