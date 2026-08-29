'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Zap, RotateCcw, Trophy, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { apiFetch } from '@/lib/api';
import { ErrorToast } from '@/components/error-toast';

type Question = {
  id: string;
  question: string;
  options: string[];
  correct_index: number;
  explanation: string | null;
};

type TestData = {
  id: string;
  title: string;
  week_number: number;
  description: string | null;
  passing_score: number;
  xp_reward: number;
  questions: Question[];
  best: { score: number; total: number; passed: boolean } | null;
};

type Result = {
  score: number;
  total: number;
  percentage: number;
  passed: boolean;
  xp_earned: number;
  results: {
    question: string;
    options: string[];
    correct_index: number;
    selected: number;
    correct: boolean;
    explanation: string | null;
  }[];
};

export function WeeklyTestClient({ test }: { test: TestData }) {
  const [started, setStarted] = useState(false);
  const [answers, setAnswers] = useState<(number | null)[]>(test.questions.map(() => null));
  const [currentQ, setCurrentQ] = useState(0);
  const [result, setResult] = useState<Result | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (answers.some((a) => a === null)) return;
    setSaving(true);
    try {
      const res = await apiFetch('/api/staff-lms/weekly-tests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'submit', test_id: test.id, answers }),
      });
      const data = await res.json();
      setResult(data);
    } catch (e: any) {
      setError(e.message);
    }
    setSaving(false);
  }

  function retry() {
    setAnswers(test.questions.map(() => null));
    setCurrentQ(0);
    setResult(null);
    setStarted(true);
  }

  // Intro screen
  if (!started && !result) {
    return (
      <div className="space-y-4">
        <ErrorToast message={error} onClose={() => setError(null)} />
        <Link href="/learn" className="inline-flex items-center gap-1 text-sm text-gray-500">
          <ArrowLeft size={16} /> Back to Course
        </Link>

        <div className="bg-gradient-to-br from-orange-500 to-amber-600 rounded-2xl p-6 text-white text-center">
          <div className="text-4xl mb-3">📋</div>
          <h1 className="text-xl font-bold">{test.title}</h1>
          <p className="text-sm opacity-80 mt-1">Week {test.week_number} Assessment</p>
        </div>

        <div className="bg-white rounded-2xl p-5 shadow-sm space-y-3">
          {test.description && <p className="text-sm text-gray-600">{test.description}</p>}
          <div className="grid grid-cols-3 gap-3 text-center">
            <div className="bg-gray-50 rounded-xl p-3">
              <p className="text-lg font-bold text-gray-900">{test.questions.length}</p>
              <p className="text-xs text-gray-400">Questions</p>
            </div>
            <div className="bg-gray-50 rounded-xl p-3">
              <p className="text-lg font-bold text-gray-900">{test.passing_score}%</p>
              <p className="text-xs text-gray-400">To Pass</p>
            </div>
            <div className="bg-gray-50 rounded-xl p-3">
              <p className="text-lg font-bold text-blue-600">{test.xp_reward}</p>
              <p className="text-xs text-gray-400">XP Reward</p>
            </div>
          </div>

          {test.best && (
            <div className={cn(
              'rounded-xl p-3 text-center',
              test.best.passed ? 'bg-green-50 border border-green-200' : 'bg-orange-50 border border-orange-200'
            )}>
              <p className={cn('text-sm font-medium', test.best.passed ? 'text-green-700' : 'text-orange-700')}>
                Previous best: {Math.round((test.best.score / test.best.total) * 100)}%
                {test.best.passed ? ' (Passed)' : ' (Not passed)'}
              </p>
            </div>
          )}
        </div>

        <button
          onClick={() => setStarted(true)}
          className="w-full py-3 bg-orange-500 text-white rounded-2xl font-semibold text-sm"
        >
          {test.best ? 'Retake Test' : 'Start Test'}
        </button>
      </div>
    );
  }

  // Results screen
  if (result) {
    return (
      <div className="space-y-4">
        <div className={cn(
          'rounded-2xl p-8 text-center',
          result.passed
            ? 'bg-gradient-to-br from-green-50 to-emerald-50 border border-green-200'
            : 'bg-gradient-to-br from-orange-50 to-amber-50 border border-orange-200'
        )}>
          <div className="text-5xl mb-3">{result.passed ? '🎉' : '📚'}</div>
          <h2 className={cn('text-xl font-bold', result.passed ? 'text-green-700' : 'text-orange-700')}>
            {result.passed ? 'Test Passed!' : 'Keep Studying'}
          </h2>
          <p className="text-4xl font-bold mt-2 text-gray-900">{result.percentage}%</p>
          <p className="text-sm text-gray-500">{result.score}/{result.total} correct</p>
          {result.xp_earned > 0 && (
            <p className="text-sm text-blue-600 font-bold mt-2 flex items-center justify-center gap-1">
              <Zap size={14} /> +{result.xp_earned} XP earned!
            </p>
          )}
        </div>

        {result.results.map((r, i) => (
          <div key={i} className={cn(
            'bg-white rounded-2xl p-4 shadow-sm border-l-4',
            r.correct ? 'border-l-green-500' : 'border-l-red-400'
          )}>
            <p className="text-sm font-medium text-gray-900 mb-2">
              <span className={r.correct ? 'text-green-500' : 'text-red-500'}>
                {r.correct ? '✓' : '✗'}
              </span>
              {' '}{r.question}
            </p>
            {!r.correct && (
              <p className="text-xs text-gray-500">
                Your answer: <span className="text-red-500">{r.options[r.selected]}</span><br />
                Correct: <span className="text-green-600 font-medium">{r.options[r.correct_index]}</span>
              </p>
            )}
            {r.explanation && (
              <p className="text-xs text-blue-600 mt-1 bg-blue-50 rounded-lg px-3 py-2">{r.explanation}</p>
            )}
          </div>
        ))}

        <div className="flex gap-2">
          {!result.passed && (
            <button onClick={retry} className="flex-1 py-3 bg-orange-500 text-white rounded-2xl font-semibold text-sm flex items-center justify-center gap-2">
              <RotateCcw size={16} /> Retry
            </button>
          )}
          <Link href="/learn" className="flex-1 py-3 bg-blue-600 text-white rounded-2xl font-semibold text-sm flex items-center justify-center gap-2">
            Back to Course <ChevronRight size={16} />
          </Link>
        </div>
      </div>
    );
  }

  // Quiz in progress — one question at a time
  const q = test.questions[currentQ];
  const answeredCount = answers.filter((a) => a !== null).length;

  return (
    <div className="space-y-4">
      <ErrorToast message={error} onClose={() => setError(null)} />

      {/* Progress */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-500 font-medium">
          Question {currentQ + 1} of {test.questions.length}
        </p>
        <p className="text-xs text-blue-500 font-medium">{answeredCount}/{test.questions.length} answered</p>
      </div>
      <div className="w-full bg-gray-100 rounded-full h-2">
        <div
          className="bg-orange-500 h-full rounded-full transition-all"
          style={{ width: `${((currentQ + 1) / test.questions.length) * 100}%` }}
        />
      </div>

      {/* Question */}
      <div className="bg-white rounded-2xl p-5 shadow-sm">
        <p className="font-semibold text-gray-900 text-sm mb-4">{q.question}</p>
        <div className="space-y-2">
          {(q.options as string[]).map((opt, oi) => (
            <button
              key={oi}
              onClick={() => {
                const updated = [...answers];
                updated[currentQ] = oi;
                setAnswers(updated);
              }}
              className={cn(
                'w-full text-left px-4 py-3 rounded-xl text-sm border-2 transition-all',
                answers[currentQ] === oi
                  ? 'border-orange-500 bg-orange-50 text-orange-700 font-medium'
                  : 'border-gray-100 text-gray-700 hover:border-gray-200'
              )}
            >
              {opt}
            </button>
          ))}
        </div>
      </div>

      {/* Navigation */}
      <div className="flex gap-2">
        {currentQ > 0 && (
          <button
            onClick={() => setCurrentQ(currentQ - 1)}
            className="flex-1 py-3 bg-gray-100 text-gray-700 rounded-2xl font-semibold text-sm"
          >
            Previous
          </button>
        )}
        {currentQ < test.questions.length - 1 ? (
          <button
            onClick={() => setCurrentQ(currentQ + 1)}
            disabled={answers[currentQ] === null}
            className="flex-1 py-3 bg-orange-500 text-white rounded-2xl font-semibold text-sm disabled:opacity-40"
          >
            Next
          </button>
        ) : (
          <button
            onClick={submit}
            disabled={answers.some((a) => a === null) || saving}
            className="flex-1 py-3 bg-green-600 text-white rounded-2xl font-semibold text-sm disabled:opacity-40"
          >
            {saving ? 'Submitting...' : 'Submit Test'}
          </button>
        )}
      </div>
    </div>
  );
}
