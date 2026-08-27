import { prisma } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth';
import Link from 'next/link';
import { HelpCircle, Check, RotateCcw, ChevronRight, Zap } from 'lucide-react';
import { getDifficultyColor } from '@/lib/utils';

export default async function QuizzesPage() {
  const user = await getCurrentUser();

  const [quizzes, attempts, questions] = await Promise.all([
    prisma.lmsQuiz.findMany({ where: { isActive: true }, orderBy: [{ difficulty: 'asc' }, { title: 'asc' }] }),
    prisma.lmsQuizAttempt.findMany({ where: { userId: user!.id }, select: { quizId: true, score: true, total: true, passed: true } }),
    prisma.lmsQuizQuestion.findMany({ select: { quizId: true } }),
  ]);

  const bestAttempts = new Map<string, { score: number; total: number; passed: boolean }>();
  attempts.forEach((a) => {
    const existing = bestAttempts.get(a.quizId);
    if (!existing || a.score > existing.score) {
      bestAttempts.set(a.quizId, { score: a.score, total: a.total, passed: a.passed });
    }
  });

  const qCounts = new Map<string, number>();
  questions.forEach((q) => { qCounts.set(q.quizId, (qCounts.get(q.quizId) || 0) + 1); });

  if (quizzes.length === 0) {
    return (
      <div className="text-center py-16">
        <HelpCircle size={48} className="mx-auto text-gray-300 mb-4" />
        <p className="text-gray-500">No quizzes available yet.</p>
      </div>
    );
  }

  const sorted = [...quizzes].sort((a, b) => (bestAttempts.has(a.id) ? 1 : 0) - (bestAttempts.has(b.id) ? 1 : 0));

  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-500">Test your sales knowledge and earn XP.</p>
      <div className="space-y-3">
        {sorted.map((quiz) => {
          const best = bestAttempts.get(quiz.id);
          const numQuestions = qCounts.get(quiz.id) || 0;
          return (
            <Link key={quiz.id} href={`/staff-lms/quizzes/${quiz.id}`} className="block bg-white rounded-2xl p-4 shadow-sm card-hover">
              <div className="flex items-start gap-3">
                <div className={`p-3 rounded-xl flex-shrink-0 ${best?.passed ? 'bg-green-100' : 'bg-purple-100'}`}>
                  {best?.passed ? <Check size={20} className="text-green-600" /> : <HelpCircle size={20} className="text-purple-600" />}
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="font-semibold text-gray-900 text-sm">{quiz.title}</h3>
                  {quiz.description && <p className="text-xs text-gray-500 mt-0.5 line-clamp-1">{quiz.description}</p>}
                  <div className="flex items-center gap-2 mt-2">
                    <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${getDifficultyColor(quiz.difficulty)}`}>{quiz.difficulty}</span>
                    <span className="text-[10px] text-gray-400">{numQuestions} questions</span>
                    <span className="text-[10px] text-blue-500 flex items-center gap-0.5"><Zap size={10} /> {quiz.xpReward} XP</span>
                  </div>
                  {best && (
                    <div className="mt-2 flex items-center gap-2">
                      <span className={`text-xs font-medium ${best.passed ? 'text-green-600' : 'text-orange-500'}`}>Best: {Math.round((best.score / best.total) * 100)}%</span>
                      {!best.passed && <span className="text-[10px] text-orange-500 flex items-center gap-0.5"><RotateCcw size={10} /> Retry</span>}
                    </div>
                  )}
                </div>
                <ChevronRight size={18} className="text-gray-300 mt-1" />
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
