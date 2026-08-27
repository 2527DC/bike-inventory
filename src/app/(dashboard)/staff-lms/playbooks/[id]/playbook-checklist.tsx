'use client';

import { useState, useEffect } from 'react';
import { ArrowLeft, Check, RotateCcw, Lightbulb, PartyPopper } from 'lucide-react';
import Link from 'next/link';
import type { Scenario, ChecklistItem } from '@/types';
import { getDifficultyColor } from '@/lib/utils';

export function PlaybookChecklist({ scenario }: { scenario: Scenario }) {
  const storageKey = `playbook-${scenario.id}`;
  const checklist = scenario.checklist as ChecklistItem[];

  const [checked, setChecked] = useState<boolean[]>(() => {
    if (typeof window === 'undefined') return checklist.map(() => false);
    const saved = localStorage.getItem(storageKey);
    return saved ? JSON.parse(saved) : checklist.map(() => false);
  });
  const [completed, setCompleted] = useState(false);
  const [xpAwarded, setXpAwarded] = useState(false);

  const completedCount = checked.filter(Boolean).length;
  const total = checklist.length;
  const progressPercent = total > 0 ? (completedCount / total) * 100 : 0;
  const allDone = completedCount === total;

  useEffect(() => {
    localStorage.setItem(storageKey, JSON.stringify(checked));
    if (allDone && !completed) {
      setCompleted(true);
      if (!xpAwarded) {
        setXpAwarded(true);
        fetch('/api/staff-lms/progress', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type: 'scenario_completed', scenarioId: scenario.id }),
        });
      }
    }
  }, [checked, allDone, completed, xpAwarded, storageKey, scenario.id]);

  function toggleItem(index: number) {
    setChecked((prev) => {
      const next = [...prev];
      next[index] = !next[index];
      return next;
    });
  }

  function reset() {
    setChecked(checklist.map(() => false));
    setCompleted(false);
    setXpAwarded(false);
    localStorage.removeItem(storageKey);
  }

  return (
    <div className="space-y-5 pb-4">
      <Link href="/playbooks" className="inline-flex items-center gap-1 text-sm text-gray-500">
        <ArrowLeft size={16} /> Back
      </Link>

      {/* Header */}
      <div>
        <h1 className="text-xl font-bold text-gray-900">{scenario.title}</h1>
        <div className="flex items-center gap-2 mt-1">
          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${getDifficultyColor(scenario.difficulty)}`}>
            {scenario.difficulty}
          </span>
          <span className="text-xs text-gray-400">{scenario.type}</span>
        </div>
        {scenario.description && (
          <p className="text-sm text-gray-600 mt-2">{scenario.description}</p>
        )}
      </div>

      {/* Progress Bar */}
      <div className="bg-white rounded-2xl p-4 shadow-sm">
        <div className="flex justify-between items-center mb-2">
          <span className="text-sm font-medium text-gray-700">Progress</span>
          <span className="text-sm font-bold text-blue-600">{completedCount}/{total}</span>
        </div>
        <div className="w-full bg-gray-100 rounded-full h-2.5 overflow-hidden">
          <div
            className="bg-gradient-to-r from-blue-500 to-green-500 h-full rounded-full transition-all duration-300"
            style={{ width: `${progressPercent}%` }}
          />
        </div>
      </div>

      {/* Completion Celebration */}
      {allDone && (
        <div className="bg-gradient-to-r from-green-50 to-emerald-50 rounded-2xl p-5 text-center border border-green-100">
          <PartyPopper size={40} className="mx-auto text-green-500 mb-2" />
          <p className="font-bold text-green-700 text-lg">Checklist Complete!</p>
          <p className="text-sm text-green-600 mt-1">+10 XP earned</p>
        </div>
      )}

      {/* Checklist */}
      <div className="space-y-2">
        {checklist.map((item, i) => (
          <button
            key={i}
            onClick={() => toggleItem(i)}
            className={`w-full text-left flex items-start gap-3 bg-white rounded-xl p-4 shadow-sm transition-all ${
              checked[i] ? 'opacity-70' : ''
            }`}
          >
            <div
              className={`w-6 h-6 rounded-full border-2 flex items-center justify-center flex-shrink-0 mt-0.5 transition-colors ${
                checked[i] ? 'bg-green-500 border-green-500' : 'border-gray-300'
              }`}
            >
              {checked[i] && <Check size={14} className="text-white" />}
            </div>
            <span className={`text-sm ${checked[i] ? 'line-through text-gray-400' : 'text-gray-800'}`}>
              {item.step}
            </span>
          </button>
        ))}
      </div>

      {/* Pro Tips */}
      {scenario.tips.length > 0 && (
        <div>
          <h2 className="font-bold text-gray-900 flex items-center gap-2 mb-3">
            <Lightbulb size={18} className="text-yellow-500" /> Pro Tips
          </h2>
          <div className="space-y-2">
            {scenario.tips.map((tip, i) => (
              <div key={i} className="bg-yellow-50 rounded-xl p-3 border border-yellow-100">
                <p className="text-sm text-yellow-800">{tip}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Reset */}
      <button
        onClick={reset}
        className="flex items-center justify-center gap-2 w-full py-3 text-gray-500 text-sm"
      >
        <RotateCcw size={14} /> Reset Checklist
      </button>
    </div>
  );
}
