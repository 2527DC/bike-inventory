import { prisma } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth';
import { redirect } from 'next/navigation';
import { ModuleClient } from './module-client';

export default async function ModulePage({ params }: { params: Promise<{ moduleId: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect('/login');

  const { moduleId } = await params;

  const mod = await prisma.lmsLesson.findUnique({
    where: { id: moduleId },
    include: {
      questions: { orderBy: { sortOrder: 'asc' } },
      progress: { where: { userId: user.id } },
      level: {
        include: {
          lessons: {
            where: { isActive: true },
            orderBy: { sortOrder: 'asc' },
            select: { id: true, sortOrder: true, title: true },
          },
          course: { select: { id: true, title: true } },
        },
      },
    },
  });

  if (!mod) redirect('/learn');

  const prog = mod.progress[0];
  const currentIdx = mod.level.lessons.findIndex((m) => m.id === moduleId);
  const nextModule = mod.level.lessons[currentIdx + 1] || null;
  const prevModule = currentIdx > 0 ? mod.level.lessons[currentIdx - 1] : null;

  // Check unlock
  let isUnlocked = currentIdx === 0;
  if (prevModule) {
    const prevProg = await prisma.lmsLessonProgress.findUnique({
      where: { userId_lessonId: { userId: user.id, lessonId: prevModule.id } },
    });
    isUnlocked = !!prevProg?.completed;
  }

  // Check previous levels
  if (isUnlocked) {
    const prevLevels = await prisma.lmsCourseLevel.findMany({
      where: {
        courseId: mod.level.course.id,
        sortOrder: { lt: mod.level.sortOrder },
      },
      include: {
        lessons: { where: { isActive: true }, select: { id: true } },
      },
    });

    for (const pl of prevLevels) {
      for (const pm of pl.lessons) {
        const mp = await prisma.lmsLessonProgress.findUnique({
          where: { userId_lessonId: { userId: user.id, lessonId: pm.id } },
        });
        if (!mp?.completed) { isUnlocked = false; break; }
      }
      if (!isUnlocked) break;
    }
  }

  if (!isUnlocked) redirect('/learn');

  const data = {
    id: mod.id,
    title: mod.title,
    description: mod.description,
    youtube_url: mod.youtubeUrl,
    key_pointers: mod.keyPointers as string[],
    checklist: mod.checklist as string[],
    xp_reward: mod.xpReward,
    questions: mod.questions.map((q) => ({
      id: q.id,
      question: q.question,
      options: q.options as string[],
      correct_index: q.correctIndex,
      explanation: q.explanation,
    })),
    progress: prog ? {
      video_watched: prog.videoWatched,
      checklist_done: prog.checklistDone as boolean[],
      quiz_passed: prog.quizPassed,
      completed: prog.completed,
      quiz_score: prog.quizScore,
      quiz_total: prog.quizTotal,
    } : null,
    next_module_id: nextModule?.id || null,
    next_module_title: nextModule?.title || null,
    level_title: mod.level.title,
    course_title: mod.level.course.title,
    module_number: currentIdx + 1,
    total_in_level: mod.level.lessons.length,
  };

  return <ModuleClient module={data} />;
}
