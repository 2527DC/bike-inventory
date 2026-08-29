'use client';

import Link from 'next/link';
import {
  GraduationCap, Lock, CheckCircle2, PlayCircle, ChevronRight,
  BookOpen, ClipboardCheck, Zap, Trophy, Calendar,
} from 'lucide-react';
import { cn } from '@/lib/utils';

type Module = {
  id: string;
  title: string;
  description: string | null;
  has_video: boolean;
  question_count: number;
  xp_reward: number;
  completed: boolean;
  video_watched: boolean;
  quiz_passed: boolean;
};

type Level = {
  id: string;
  title: string;
  description: string | null;
  week_number: number | null;
  brand_focus: string | null;
  modules: Module[];
  completed_count: number;
  total_count: number;
};

type Course = {
  id: string;
  title: string;
  description: string | null;
  levels: Level[];
  total_modules: number;
  completed_modules: number;
};

type WeeklyTest = {
  id: string;
  title: string;
  week_number: number;
  question_count: number;
  scheduled_for: string | null;
  best: { score: number; total: number; passed: boolean } | null;
};

export function LearnClient({ courses, weeklyTests }: { courses: Course[]; weeklyTests: WeeklyTest[] }) {
  if (courses.length === 0) {
    return (
      <div className="text-center py-16">
        <GraduationCap size={48} className="mx-auto text-gray-300 mb-4" />
        <p className="text-gray-500">No courses available yet.</p>
        <p className="text-xs text-gray-400 mt-1">Your training modules will appear here.</p>
      </div>
    );
  }

  const course = courses[0]; // Primary course
  const progressPercent = course.total_modules > 0
    ? Math.round((course.completed_modules / course.total_modules) * 100)
    : 0;

  // Find the first incomplete module to highlight as "current"
  let currentModuleId: string | null = null;
  let previousCompleted = true;
  for (const level of course.levels) {
    for (const mod of level.modules) {
      if (!mod.completed && previousCompleted) {
        currentModuleId = mod.id;
        break;
      }
      previousCompleted = mod.completed;
    }
    if (currentModuleId) break;
  }

  return (
    <div className="space-y-6">
      {/* Course header */}
      <div className="bg-gradient-to-br from-blue-600 to-indigo-700 rounded-2xl p-5 text-white">
        <div className="flex items-center gap-2 mb-1">
          <GraduationCap size={20} />
          <span className="text-xs font-medium opacity-80 uppercase tracking-wide">Your Course</span>
        </div>
        <h2 className="text-lg font-bold">{course.title}</h2>
        {course.description && <p className="text-sm opacity-80 mt-1">{course.description}</p>}
        <div className="mt-4">
          <div className="flex justify-between text-xs mb-1.5">
            <span>{course.completed_modules} of {course.total_modules} modules</span>
            <span className="font-bold">{progressPercent}%</span>
          </div>
          <div className="w-full bg-white/20 rounded-full h-2.5">
            <div
              className="bg-white h-full rounded-full transition-all"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
        </div>
      </div>

      {/* Weekly tests */}
      {weeklyTests.length > 0 && (
        <div>
          <h3 className="font-bold text-gray-900 mb-3 flex items-center gap-2">
            <Calendar size={16} className="text-orange-500" />
            Wednesday Tests
          </h3>
          <div className="space-y-2">
            {weeklyTests.map((test) => (
              <Link
                key={test.id}
                href={`/staff-lms/learn/weekly-test?id=${test.id}`}
                className="flex items-center gap-3 bg-white rounded-2xl p-4 shadow-sm"
              >
                <div className={cn(
                  'p-2.5 rounded-xl',
                  test.best?.passed ? 'bg-green-100' : 'bg-orange-100'
                )}>
                  <Trophy size={18} className={test.best?.passed ? 'text-green-600' : 'text-orange-600'} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-gray-900 text-sm">{test.title}</p>
                  <p className="text-xs text-gray-400">
                    Week {test.week_number} · {test.question_count} questions
                  </p>
                  {test.best && (
                    <p className={cn(
                      'text-xs font-medium mt-0.5',
                      test.best.passed ? 'text-green-600' : 'text-orange-500'
                    )}>
                      {test.best.passed ? 'Passed' : 'Not passed'} · {Math.round((test.best.score / test.best.total) * 100)}%
                    </p>
                  )}
                </div>
                <ChevronRight size={18} className="text-gray-300" />
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Levels & Modules */}
      {course.levels.map((level, levelIdx) => {
        const levelLocked = levelIdx > 0 && course.levels[levelIdx - 1].completed_count < course.levels[levelIdx - 1].total_count;
        const levelDone = level.completed_count === level.total_count && level.total_count > 0;

        return (
          <div key={level.id}>
            <div className="flex items-center gap-3 mb-3">
              <div className={cn(
                'w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold',
                levelDone ? 'bg-green-100 text-green-600' :
                levelLocked ? 'bg-gray-100 text-gray-400' :
                'bg-blue-100 text-blue-600'
              )}>
                {levelDone ? <CheckCircle2 size={18} /> : levelIdx + 1}
              </div>
              <div className="flex-1">
                <h3 className="font-bold text-gray-900 text-sm">{level.title}</h3>
                {level.brand_focus && (
                  <p className="text-xs text-blue-500">Brand focus: {level.brand_focus}</p>
                )}
                <p className="text-xs text-gray-400">
                  {level.completed_count}/{level.total_count} completed
                  {level.week_number ? ` · Week ${level.week_number}` : ''}
                </p>
              </div>
            </div>

            <div className="space-y-2 ml-4 border-l-2 border-gray-100 pl-4">
              {level.modules.map((mod, modIdx) => {
                const isLocked = levelLocked || (modIdx > 0 && !level.modules[modIdx - 1].completed);
                const isCurrent = mod.id === currentModuleId;

                return (
                  <Link
                    key={mod.id}
                    href={isLocked ? '#' : `/staff-lms/learn/${mod.id}`}
                    className={cn(
                      'block bg-white rounded-2xl p-4 shadow-sm transition-all',
                      isLocked && 'opacity-50 cursor-not-allowed',
                      isCurrent && 'ring-2 ring-blue-400 ring-offset-1',
                    )}
                    onClick={(e) => isLocked && e.preventDefault()}
                  >
                    <div className="flex items-start gap-3">
                      <div className={cn(
                        'p-2 rounded-xl flex-shrink-0 mt-0.5',
                        mod.completed ? 'bg-green-100' :
                        isLocked ? 'bg-gray-100' :
                        isCurrent ? 'bg-blue-100' : 'bg-gray-50'
                      )}>
                        {mod.completed ? (
                          <CheckCircle2 size={18} className="text-green-600" />
                        ) : isLocked ? (
                          <Lock size={18} className="text-gray-400" />
                        ) : (
                          <PlayCircle size={18} className={isCurrent ? 'text-blue-600' : 'text-gray-400'} />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className={cn(
                          'font-semibold text-sm',
                          mod.completed ? 'text-green-700' : 'text-gray-900'
                        )}>
                          {mod.title}
                        </p>
                        {mod.description && (
                          <p className="text-xs text-gray-400 mt-0.5 line-clamp-1">{mod.description}</p>
                        )}
                        <div className="flex items-center gap-3 mt-2">
                          {mod.has_video && (
                            <span className={cn(
                              'text-[10px] flex items-center gap-0.5',
                              mod.video_watched ? 'text-green-500' : 'text-gray-400'
                            )}>
                              <PlayCircle size={10} /> Video
                            </span>
                          )}
                          <span className={cn(
                            'text-[10px] flex items-center gap-0.5',
                            mod.quiz_passed ? 'text-green-500' : 'text-gray-400'
                          )}>
                            <ClipboardCheck size={10} /> Quiz
                          </span>
                          <span className="text-[10px] text-blue-500 flex items-center gap-0.5">
                            <Zap size={10} /> {mod.xp_reward} XP
                          </span>
                        </div>
                      </div>
                      {!isLocked && <ChevronRight size={18} className="text-gray-300 mt-1" />}
                    </div>
                  </Link>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
