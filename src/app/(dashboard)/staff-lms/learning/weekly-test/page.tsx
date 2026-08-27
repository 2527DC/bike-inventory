import { prisma } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth';
import { redirect } from 'next/navigation';
import { WeeklyTestClient } from './weekly-test-client';

export default async function WeeklyTestPage({ searchParams }: { searchParams: Promise<{ id?: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect('/login');

  const { id } = await searchParams;
  if (!id) redirect('/learn');

  const test = await prisma.lmsWeeklyTest.findUnique({
    where: { id },
    include: {
      questions: { orderBy: { sortOrder: 'asc' } },
      attempts: {
        where: { userId: user.id },
        orderBy: { completedAt: 'desc' },
        take: 1,
      },
    },
  });

  if (!test) redirect('/learn');

  const best = test.attempts[0];

  const data = {
    id: test.id,
    title: test.title,
    week_number: test.weekNumber,
    description: test.description,
    passing_score: test.passingScore,
    xp_reward: test.xpReward,
    questions: test.questions.map((q) => ({
      id: q.id,
      question: q.question,
      options: q.options as string[],
      correct_index: q.correctIndex,
      explanation: q.explanation,
    })),
    best: best ? { score: best.score, total: best.total, passed: best.passed } : null,
  };

  return <WeeklyTestClient test={data} />;
}
