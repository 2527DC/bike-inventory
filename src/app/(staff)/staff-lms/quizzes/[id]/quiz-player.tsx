'use client';

import { useState } from 'react';
import { ArrowLeft, Check, X, Trophy, RotateCcw, Zap } from 'lucide-react';
import Link from 'next/link';
import type { Quiz, QuizQuestion } from '@/types';

export function QuizPlayer({ quiz, questions }: { quiz: Quiz; questions: QuizQuestion[] }) {
  const [current, setCurrent] = useState(0);
  const [answers, setAnswers] = useState<number[]>([]);
  const [selectedOption, setSelectedOption] = useState<number | null>(null);
  const [showExplanation, setShowExplanation] = useState(false);
  const [finished, setFinished] = useState(false);
  const [xpEarned, setXpEarned] = useState(0);

  const question = questions[current];
  const isCorrect = selectedOption === question?.correct_index;
  const score = answers.reduce((acc, ans, i) => acc + (ans === questions[i]?.correct_index ? 1 : 0), 0);
  const total = questions.length;
  const percentage = total > 0 ? Math.round((score / total) * 100) : 0;
  const passed = percentage >= quiz.passing_score;

  function selectOption(index: number) {
    if (selectedOption !== null) return;
    setSelectedOption(index);
    setShowExplanation(true);
  }

  function nextQuestion() {
    const newAnswers = [...answers, selectedOption!];
    setAnswers(newAnswers);
    setSelectedOption(null);
    setShowExplanation(false);

    if (current + 1 >= questions.length) {
      // Calculate final score
      const finalScore = newAnswers.reduce((acc, ans, i) => acc + (ans === questions[i]?.correct_index ? 1 : 0), 0);
      const finalPercentage = Math.round((finalScore / total) * 100);
      const isPassed = finalPercentage >= quiz.passing_score;
      const isPerfect = finalScore === total;
      const xp = isPassed ? (isPerfect ? quiz.xp_reward * 2 : quiz.xp_reward) : 0;
      setXpEarned(xp);
      setFinished(true);

      // Submit result
      fetch('/api/staff-lms/quiz-attempts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          quizId: quiz.id,
          score: finalScore,
          total,
          passed: isPassed,
          answers: newAnswers,
        }),
      });
    } else {
      setCurrent(current + 1);
    }
  }

  function retry() {
    setCurrent(0);
    setAnswers([]);
    setSelectedOption(null);
    setShowExplanation(false);
    setFinished(false);
    setXpEarned(0);
  }

  if (questions.length === 0) {
    return (
      <div className="text-center py-16">
        <p className="text-gray-500">This quiz has no questions yet.</p>
        <Link href="/quizzes" className="text-blue-600 text-sm mt-2 inline-block">Back to Quizzes</Link>
      </div>
    );
  }

  // Results Screen
  if (finished) {
    return (
      <div className="space-y-6 pb-4">
        <Link href="/quizzes" className="inline-flex items-center gap-1 text-sm text-gray-500">
          <ArrowLeft size={16} /> Back
        </Link>

        <div className={`rounded-2xl p-8 text-center ${passed ? 'bg-green-50' : 'bg-orange-50'}`}>
          <div className="text-5xl mb-3">{passed ? '🎉' : '💪'}</div>
          <p className={`text-5xl font-bold ${passed ? 'text-green-600' : 'text-orange-500'}`}>{percentage}%</p>
          <p className="text-lg font-medium text-gray-700 mt-1">{score}/{total} correct</p>
          <p className={`text-sm mt-2 ${passed ? 'text-green-600' : 'text-orange-500'}`}>
            {passed ? 'You passed!' : `Need ${quiz.passing_score}% to pass`}
          </p>
          {xpEarned > 0 && (
            <p className="flex items-center justify-center gap-1 text-blue-600 font-bold mt-3">
              <Zap size={16} /> +{xpEarned} XP earned!
            </p>
          )}
        </div>

        {/* Answer Summary */}
        <div className="space-y-2">
          {questions.map((q, i) => {
            const correct = answers[i] === q.correct_index;
            return (
              <div key={q.id} className={`flex items-start gap-3 p-3 rounded-xl ${correct ? 'bg-green-50' : 'bg-red-50'}`}>
                {correct ? (
                  <Check size={18} className="text-green-600 mt-0.5 flex-shrink-0" />
                ) : (
                  <X size={18} className="text-red-500 mt-0.5 flex-shrink-0" />
                )}
                <div>
                  <p className="text-sm text-gray-800">{q.question}</p>
                  {!correct && (
                    <p className="text-xs text-green-600 mt-1">Correct: {q.options[q.correct_index]}</p>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        <div className="flex gap-3">
          <button onClick={retry} className="flex-1 py-3 bg-gray-100 rounded-xl font-medium text-sm text-gray-700 flex items-center justify-center gap-2">
            <RotateCcw size={16} /> Retry
          </button>
          <Link href="/quizzes" className="flex-1 py-3 bg-blue-600 text-white rounded-xl font-medium text-sm text-center">
            All Quizzes
          </Link>
        </div>
      </div>
    );
  }

  // Question Screen
  return (
    <div className="space-y-5">
      {/* Progress */}
      <div className="flex items-center gap-3">
        <Link href="/quizzes" className="text-gray-400"><ArrowLeft size={20} /></Link>
        <div className="flex-1">
          <div className="w-full bg-gray-100 rounded-full h-2 overflow-hidden">
            <div
              className="bg-blue-500 h-full rounded-full transition-all duration-300"
              style={{ width: `${((current + 1) / total) * 100}%` }}
            />
          </div>
        </div>
        <span className="text-sm text-gray-500 font-medium">{current + 1}/{total}</span>
      </div>

      {/* Question */}
      <div className="bg-white rounded-2xl p-5 shadow-sm">
        <h2 className="font-bold text-gray-900">{question.question}</h2>
      </div>

      {/* Options */}
      <div className="space-y-2">
        {question.options.map((option: string, i: number) => {
          let style = 'bg-white border-gray-200';
          if (selectedOption !== null) {
            if (i === question.correct_index) style = 'bg-green-50 border-green-400';
            else if (i === selectedOption) style = 'bg-red-50 border-red-400';
          }

          return (
            <button
              key={i}
              onClick={() => selectOption(i)}
              disabled={selectedOption !== null}
              className={`w-full text-left p-4 rounded-xl border-2 transition-all text-sm ${style}`}
            >
              <div className="flex items-center gap-3">
                <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold ${
                  selectedOption !== null && i === question.correct_index
                    ? 'bg-green-500 text-white'
                    : selectedOption === i && i !== question.correct_index
                    ? 'bg-red-500 text-white'
                    : 'bg-gray-100 text-gray-600'
                }`}>
                  {selectedOption !== null && i === question.correct_index ? (
                    <Check size={14} />
                  ) : selectedOption === i && i !== question.correct_index ? (
                    <X size={14} />
                  ) : (
                    String.fromCharCode(65 + i)
                  )}
                </div>
                <span className="text-gray-800">{option}</span>
              </div>
            </button>
          );
        })}
      </div>

      {/* Explanation */}
      {showExplanation && question.explanation && (
        <div className={`rounded-xl p-4 ${isCorrect ? 'bg-green-50' : 'bg-orange-50'}`}>
          <p className={`text-sm font-medium ${isCorrect ? 'text-green-700' : 'text-orange-700'}`}>
            {isCorrect ? 'Correct!' : 'Not quite.'}
          </p>
          <p className="text-sm text-gray-600 mt-1">{question.explanation}</p>
        </div>
      )}

      {/* Next Button */}
      {selectedOption !== null && (
        <button
          onClick={nextQuestion}
          className="w-full py-4 bg-blue-600 text-white rounded-2xl font-bold text-sm active:bg-blue-700"
        >
          {current + 1 >= total ? 'See Results' : 'Next Question'}
        </button>
      )}
    </div>
  );
}
