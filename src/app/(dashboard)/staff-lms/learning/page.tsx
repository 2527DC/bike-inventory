import { prisma } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth';
import { redirect } from 'next/navigation';
import { LearnClient } from './learn-client';

export default async function LearnPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');

  const courses = await prisma.lmsCourse.findMany({
    where: { isActive: true },
    include: {
      levels: {
        orderBy: { sortOrder: 'asc' },
        include: {
          lessons: {
            where: { isActive: true },
            orderBy: { sortOrder: 'asc' },
            include: {
              questions: { select: { id: true } },
              progress: {
                where: { userId: user.id },
              },
            },
          },
        },
      },
    },
  });

  // Weekly tests
  const weeklyTests = await prisma.lmsWeeklyTest.findMany({
    where: { isActive: true },
    orderBy: { weekNumber: 'desc' },
    take: 3,
    include: {
      questions: { select: { id: true } },
      attempts: {
        where: { userId: user.id },
        orderBy: { completedAt: 'desc' },
        take: 1,
      },
    },
  });

  const data = courses.map((c) => {
    let totalModules = 0;
    let completedModules = 0;

    const levels = c.levels.map((l) => {
      const modules = l.lessons.map((m) => {
        totalModules++;
        const prog = m.progress[0];
        if (prog?.completed) completedModules++;
        return {
          id: m.id,
          title: m.title,
          description: m.description,
          has_video: !!m.youtubeUrl,
          question_count: m.questions.length,
          xp_reward: m.xpReward,
          completed: !!prog?.completed,
          video_watched: !!prog?.videoWatched,
          quiz_passed: !!prog?.quizPassed,
        };
      });

      return {
        id: l.id,
        title: l.title,
        description: l.description,
        week_number: l.weekNumber,
        brand_focus: l.brandFocus,
        modules,
        completed_count: modules.filter((m) => m.completed).length,
        total_count: modules.length,
      };
    });

    return {
      id: c.id,
      title: c.title,
      description: c.description,
      levels,
      total_modules: totalModules,
      completed_modules: completedModules,
    };
  });

  const tests = weeklyTests.map((t) => {
    const best = t.attempts[0];
    return {
      id: t.id,
      title: t.title,
      week_number: t.weekNumber,
      question_count: t.questions.length,
      scheduled_for: t.scheduledFor?.toISOString() || null,
      best: best ? { score: best.score, total: best.total, passed: best.passed } : null,
    };
  });

  return <LearnClient courses={data} weeklyTests={tests} />;
}
