'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft, PlayCircle, CheckCircle2, Circle, ChevronRight,
  Zap, RotateCcw, Trophy, BookOpen, ListChecks, HelpCircle,
} from 'lucide-react';
import { cn, extractYoutubeId } from '@/lib/utils';
import { apiFetch } from '@/lib/api';
import { ErrorToast } from '@/components/error-toast';

type Question = {
  id: string;
  question: string;
  options: string[];
  correct_index: number;
  explanation: string | null;
};

type ModuleData = {
  id: string;
  title: string;
  description: string | null;
  youtube_url: string | null;
  key_pointers: string[];
  checklist: string[];
  xp_reward: number;
  questions: Question[];
  progress: {
    video_watched: boolean;
    checklist_done: boolean[];
    quiz_passed: boolean;
    completed: boolean;
    quiz_score: number | null;
    quiz_total: number | null;
  } | null;
  next_module_id: string | null;
  next_module_title: string | null;
  level_title: string;
  course_title: string;
  module_number: number;
  total_in_level: number;
};

type Step = 'video' | 'pointers' | 'checklist' | 'quiz' | 'complete';

export function ModuleClient({ module: mod }: { module: ModuleData }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  // Determine initial step
  const getInitialStep = (): Step => {
    if (mod.progress?.completed) return 'complete';
    if (mod.youtube_url && !mod.progress?.video_watched) return 'video';
    if (mod.key_pointers.length > 0 && !mod.progress?.video_watched) return 'pointers';
    if (mod.checklist.length > 0) {
      const done = mod.progress?.checklist_done || [];
      const allDone = mod.checklist.every((_, i) => done[i]);
      if (!allDone) return 'checklist';
    }
    if (mod.questions.length > 0 && !mod.progress?.quiz_passed) return 'quiz';
    return 'complete';
  };

  const [step, setStep] = useState<Step>(getInitialStep);
  const [videoWatched, setVideoWatched] = useState(mod.progress?.video_watched || false);
  const [checklistState, setChecklistState] = useState<boolean[]>(
    (mod.progress?.checklist_done as boolean[]) || mod.checklist.map(() => false)
  );
  const [quizAnswers, setQuizAnswers] = useState<(number | null)[]>(mod.questions.map(() => null));
  const [quizSubmitted, setQuizSubmitted] = useState(false);
  const [quizResult, setQuizResult] = useState<{
    score: number; total: number; percentage: number; passed: boolean; xp_earned: number;
  } | null>(null);
  const [saving, setSaving] = useState(false);

  const ytId = mod.youtube_url ? extractYoutubeId(mod.youtube_url) : null;

  const allSteps: { key: Step; label: string; icon: React.ElementType; show: boolean }[] = [
    { key: 'video', label: 'Watch', icon: PlayCircle, show: !!mod.youtube_url },
    { key: 'pointers', label: 'Learn', icon: BookOpen, show: mod.key_pointers.length > 0 },
    { key: 'checklist', label: 'Check', icon: ListChecks, show: mod.checklist.length > 0 },
    { key: 'quiz', label: 'Quiz', icon: HelpCircle, show: mod.questions.length > 0 },
  ];
  const steps = allSteps.filter((s) => s.show);

  const stepIndex = steps.findIndex((s) => s.key === step);

  async function markVideoWatched() {
    setSaving(true);
    try {
      await apiFetch(`/api/staff-lms/modules/${mod.id}/progress`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'video_watched' }),
      });
      setVideoWatched(true);
      // Move to next step
      const nextStep = steps[steps.findIndex((s) => s.key === 'video') + 1];
      if (nextStep) setStep(nextStep.key);
    } catch (e: any) {
      setError(e.message);
    }
    setSaving(false);
  }

  async function updateChecklist(idx: number, checked: boolean) {
    const updated = [...checklistState];
    updated[idx] = checked;
    setChecklistState(updated);

    try {
      await apiFetch(`/api/staff-lms/modules/${mod.id}/progress`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'checklist_update', checklist_done: updated }),
      });
    } catch (e: any) {
      setError(e.message);
    }
  }

  async function submitQuiz() {
    if (quizAnswers.some((a) => a === null)) return;
    setSaving(true);
    try {
      const res = await apiFetch(`/api/staff-lms/modules/${mod.id}/progress`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'quiz_submit', answers: quizAnswers }),
      });
      const data = await res.json();
      setQuizResult(data);
      setQuizSubmitted(true);
      if (data.passed) {
        setTimeout(() => setStep('complete'), 100);
      }
    } catch (e: any) {
      setError(e.message);
    }
    setSaving(false);
  }

  function retryQuiz() {
    setQuizAnswers(mod.questions.map(() => null));
    setQuizSubmitted(false);
    setQuizResult(null);
  }

  const allChecklistDone = checklistState.every(Boolean);

  return (
    <div className="space-y-4">
      <ErrorToast message={error} onClose={() => setError(null)} />

      {/* Header */}
      <div>
        <Link href="/learn" className="inline-flex items-center gap-1 text-sm text-gray-500 mb-2">
          <ArrowLeft size={16} /> {mod.level_title}
        </Link>
        <h1 className="text-xl font-bold text-gray-900">{mod.title}</h1>
        <p className="text-xs text-gray-400 mt-0.5">
          Module {mod.module_number} of {mod.total_in_level}
          <span className="mx-1.5">·</span>
          <span className="text-blue-500 inline-flex items-center gap-0.5"><Zap size={10} /> {mod.xp_reward} XP</span>
        </p>
        {mod.description && <p className="text-sm text-gray-600 mt-2">{mod.description}</p>}
      </div>

      {/* Step indicator */}
      {step !== 'complete' && (
        <div className="flex items-center gap-1 bg-white rounded-2xl p-3 shadow-sm">
          {steps.map((s, i) => {
            const Icon = s.icon;
            const isCurrent = s.key === step;
            const isDone = i < stepIndex || (step as string) === 'complete';
            return (
              <button
                key={s.key}
                onClick={() => {
                  // Allow going back but not skipping forward
                  if (i <= stepIndex || isDone) setStep(s.key);
                }}
                className={cn(
                  'flex-1 flex flex-col items-center gap-1 py-2 rounded-xl transition-all text-[10px] font-medium',
                  isCurrent && 'bg-blue-50 text-blue-600',
                  isDone && !isCurrent && 'text-green-600',
                  !isCurrent && !isDone && 'text-gray-300',
                )}
              >
                {isDone && !isCurrent ? <CheckCircle2 size={16} /> : <Icon size={16} />}
                {s.label}
              </button>
            );
          })}
        </div>
      )}

      {/* STEP: Video */}
      {step === 'video' && ytId && (
        <div className="space-y-4">
          <div className="bg-black rounded-2xl overflow-hidden aspect-video">
            <iframe
              src={`https://www.youtube.com/embed/${ytId}?rel=0`}
              className="w-full h-full"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
            />
          </div>
          <button
            onClick={markVideoWatched}
            disabled={saving}
            className="w-full py-3 bg-blue-600 text-white rounded-2xl font-semibold text-sm disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {saving ? 'Saving...' : (
              <>
                <CheckCircle2 size={18} />
                I&apos;ve watched this video — Continue
              </>
            )}
          </button>
        </div>
      )}

      {/* STEP: Key Pointers */}
      {step === 'pointers' && (
        <div className="space-y-4">
          <div className="bg-white rounded-2xl p-5 shadow-sm">
            <h3 className="font-bold text-gray-900 mb-4 flex items-center gap-2">
              <BookOpen size={18} className="text-blue-600" />
              Key Takeaways
            </h3>
            <div className="space-y-3">
              {(mod.key_pointers as string[]).map((pointer, i) => (
                <div key={i} className="flex items-start gap-3">
                  <div className="w-6 h-6 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center text-xs font-bold flex-shrink-0 mt-0.5">
                    {i + 1}
                  </div>
                  <p className="text-sm text-gray-700 leading-relaxed">{pointer}</p>
                </div>
              ))}
            </div>
          </div>
          <button
            onClick={() => {
              const next = steps[steps.findIndex((s) => s.key === 'pointers') + 1];
              if (next) setStep(next.key);
            }}
            className="w-full py-3 bg-blue-600 text-white rounded-2xl font-semibold text-sm flex items-center justify-center gap-2"
          >
            Got it — Continue <ChevronRight size={18} />
          </button>
        </div>
      )}

      {/* STEP: Checklist */}
      {step === 'checklist' && (
        <div className="space-y-4">
          <div className="bg-white rounded-2xl p-5 shadow-sm">
            <h3 className="font-bold text-gray-900 mb-1 flex items-center gap-2">
              <ListChecks size={18} className="text-purple-600" />
              Self-Check
            </h3>
            <p className="text-xs text-gray-400 mb-4">Tick each item once you&apos;re confident you&apos;ve learned it.</p>
            <div className="space-y-3">
              {(mod.checklist as string[]).map((item, i) => (
                <label key={i} className="flex items-start gap-3 cursor-pointer group">
                  <button
                    onClick={() => updateChecklist(i, !checklistState[i])}
                    className="mt-0.5 flex-shrink-0"
                  >
                    {checklistState[i] ? (
                      <CheckCircle2 size={22} className="text-green-500" />
                    ) : (
                      <Circle size={22} className="text-gray-300 group-hover:text-gray-400" />
                    )}
                  </button>
                  <span className={cn(
                    'text-sm leading-relaxed',
                    checklistState[i] ? 'text-green-700 line-through opacity-70' : 'text-gray-700'
                  )}>
                    {item}
                  </span>
                </label>
              ))}
            </div>
          </div>
          <button
            onClick={() => {
              const next = steps[steps.findIndex((s) => s.key === 'checklist') + 1];
              if (next) setStep(next.key);
            }}
            disabled={!allChecklistDone}
            className="w-full py-3 bg-blue-600 text-white rounded-2xl font-semibold text-sm disabled:opacity-40 flex items-center justify-center gap-2"
          >
            {allChecklistDone ? (
              <>All checked — Take the Quiz <ChevronRight size={18} /></>
            ) : (
              <>Complete all items to continue</>
            )}
          </button>
        </div>
      )}

      {/* STEP: Quiz */}
      {step === 'quiz' && !quizSubmitted && (
        <div className="space-y-4">
          <div className="bg-gradient-to-r from-purple-50 to-indigo-50 rounded-2xl p-4 border border-purple-100">
            <h3 className="font-bold text-purple-800 text-sm">Quick Quiz</h3>
            <p className="text-xs text-purple-600 mt-0.5">
              Answer all questions correctly (70%+) to complete this module.
            </p>
          </div>

          {mod.questions.map((q, qi) => (
            <div key={q.id} className="bg-white rounded-2xl p-5 shadow-sm">
              <p className="font-semibold text-gray-900 text-sm mb-3">
                <span className="text-purple-500 mr-1">Q{qi + 1}.</span> {q.question}
              </p>
              <div className="space-y-2">
                {q.options.map((opt, oi) => (
                  <button
                    key={oi}
                    onClick={() => {
                      const updated = [...quizAnswers];
                      updated[qi] = oi;
                      setQuizAnswers(updated);
                    }}
                    className={cn(
                      'w-full text-left px-4 py-3 rounded-xl text-sm border-2 transition-all',
                      quizAnswers[qi] === oi
                        ? 'border-purple-500 bg-purple-50 text-purple-700 font-medium'
                        : 'border-gray-100 text-gray-700 hover:border-gray-200'
                    )}
                  >
                    {opt}
                  </button>
                ))}
              </div>
            </div>
          ))}

          <button
            onClick={submitQuiz}
            disabled={quizAnswers.some((a) => a === null) || saving}
            className="w-full py-3 bg-purple-600 text-white rounded-2xl font-semibold text-sm disabled:opacity-40"
          >
            {saving ? 'Submitting...' : `Submit Answers (${quizAnswers.filter((a) => a !== null).length}/${mod.questions.length})`}
          </button>
        </div>
      )}

      {/* Quiz Results */}
      {step === 'quiz' && quizSubmitted && quizResult && (
        <div className="space-y-4">
          <div className={cn(
            'rounded-2xl p-6 text-center',
            quizResult.passed
              ? 'bg-gradient-to-br from-green-50 to-emerald-50 border border-green-200'
              : 'bg-gradient-to-br from-orange-50 to-amber-50 border border-orange-200'
          )}>
            <div className="text-4xl mb-2">{quizResult.passed ? '🎉' : '😅'}</div>
            <h3 className={cn(
              'text-xl font-bold',
              quizResult.passed ? 'text-green-700' : 'text-orange-700'
            )}>
              {quizResult.passed ? 'Passed!' : 'Not quite...'}
            </h3>
            <p className="text-3xl font-bold mt-2 text-gray-900">{quizResult.percentage}%</p>
            <p className="text-sm text-gray-500">{quizResult.score}/{quizResult.total} correct</p>
            {quizResult.xp_earned > 0 && (
              <p className="text-sm text-blue-600 font-bold mt-2 flex items-center justify-center gap-1">
                <Zap size={14} /> +{quizResult.xp_earned} XP earned!
              </p>
            )}
          </div>

          {/* Show answers */}
          {mod.questions.map((q, qi) => {
            const selected = quizAnswers[qi];
            const correct = selected === q.correct_index;
            return (
              <div key={q.id} className={cn(
                'bg-white rounded-2xl p-4 shadow-sm border-l-4',
                correct ? 'border-l-green-500' : 'border-l-red-400'
              )}>
                <p className="text-sm font-medium text-gray-900 mb-2">
                  <span className={correct ? 'text-green-500' : 'text-red-500'}>
                    {correct ? '✓' : '✗'}
                  </span>
                  {' '}{q.question}
                </p>
                {!correct && (
                  <p className="text-xs text-gray-500">
                    Your answer: <span className="text-red-500">{q.options[selected!]}</span>
                    <br />
                    Correct: <span className="text-green-600 font-medium">{q.options[q.correct_index]}</span>
                  </p>
                )}
                {q.explanation && (
                  <p className="text-xs text-blue-600 mt-1 bg-blue-50 rounded-lg px-3 py-2">{q.explanation}</p>
                )}
              </div>
            );
          })}

          {quizResult.passed ? (
            <button
              onClick={() => setStep('complete')}
              className="w-full py-3 bg-green-600 text-white rounded-2xl font-semibold text-sm flex items-center justify-center gap-2"
            >
              <Trophy size={18} /> Continue
            </button>
          ) : (
            <button
              onClick={retryQuiz}
              className="w-full py-3 bg-orange-500 text-white rounded-2xl font-semibold text-sm flex items-center justify-center gap-2"
            >
              <RotateCcw size={18} /> Try Again
            </button>
          )}
        </div>
      )}

      {/* STEP: Complete */}
      {step === 'complete' && (
        <div className="space-y-4">
          <div className="bg-gradient-to-br from-green-50 to-emerald-50 rounded-2xl p-8 text-center border border-green-200">
            <div className="text-5xl mb-3">🏆</div>
            <h2 className="text-xl font-bold text-green-700">Module Complete!</h2>
            <p className="text-sm text-green-600 mt-1">{mod.title}</p>
            {mod.progress?.quiz_score !== null && mod.progress?.quiz_total !== null && (
              <p className="text-sm text-gray-500 mt-2">
                Quiz score: {Math.round(((mod.progress?.quiz_score ?? quizResult?.score ?? 0) / (mod.progress?.quiz_total ?? quizResult?.total ?? 1)) * 100)}%
              </p>
            )}
          </div>

          {mod.next_module_id ? (
            <Link
              href={`/learn/${mod.next_module_id}`}
              className="w-full py-3 bg-blue-600 text-white rounded-2xl font-semibold text-sm flex items-center justify-center gap-2"
            >
              Next: {mod.next_module_title} <ChevronRight size={18} />
            </Link>
          ) : (
            <Link
              href="/learn"
              className="w-full py-3 bg-blue-600 text-white rounded-2xl font-semibold text-sm flex items-center justify-center gap-2 block text-center"
            >
              Back to Course <ChevronRight size={18} />
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
