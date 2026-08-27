export const dynamic = "force-dynamic";

import { prisma } from "@/lib/db";
import { successResponse } from "@/lib/api-utils";
import { guarded } from "@/lib/staff-lms/route";
import { serializeLmsLesson, toLearnerQuestions } from "@/lib/staff-lms/serialize";

/**
 * Course tree with unlock state for the current learner.
 *
 * The tree is Course → Level → Lesson. A lesson is unlocked when the previous lesson (by
 * sortOrder within the same level) is `completed: true`. The FIRST lesson of each level is
 * always unlocked. This is the lock-step linear progression the source app implemented.
 *
 * Questions are included but with `correctIndex` stripped via `toLearnerQuestions` — the key
 * never leaves the server on a learner read. The edit-gated Phase 5 GETs return the raw row.
 */
export const GET = guarded(
  "staff_lms_learning",
  "view",
  "staff-lms:learning",
  async ({ user }) => {
    const [courses, lessonProgress] = await Promise.all([
      prisma.lmsCourse.findMany({
        where: { isActive: true },
        orderBy: { createdAt: "asc" },
        include: {
          levels: {
            orderBy: { sortOrder: "asc" },
            include: {
              lessons: {
                where: { isActive: true },
                orderBy: { sortOrder: "asc" },
                include: {
                  questions: { orderBy: { sortOrder: "asc" } },
                },
              },
            },
          },
        },
      }),
      prisma.lmsLessonProgress.findMany({
        where: { userId: user.id },
        select: {
          lessonId: true,
          completed: true,
          videoWatched: true,
          checklistDone: true,
          quizScore: true,
          quizTotal: true,
          quizPassed: true,
          xpEarned: true,
          completedAt: true,
        },
      }),
    ]);

    const progressByLesson = new Map(lessonProgress.map((p) => [p.lessonId, p]));

    const tree = courses.map((course) => ({
      id: course.id,
      title: course.title,
      description: course.description,
      levels: course.levels.map((level) => ({
        id: level.id,
        title: level.title,
        description: level.description,
        sortOrder: level.sortOrder,
        weekNumber: level.weekNumber,
        brandFocus: level.brandFocus,
        lessons: level.lessons.map((lesson, i) => {
          const prev = i > 0 ? level.lessons[i - 1] : null;
          const prevCompleted = prev ? progressByLesson.get(prev.id)?.completed === true : true;
          const progress = progressByLesson.get(lesson.id) ?? null;

          const serialized = serializeLmsLesson(lesson);
          return {
            ...serialized,
            questions: toLearnerQuestions(lesson.questions, "lms_lesson_questions"),
            unlocked: i === 0 || prevCompleted,
            progress,
          };
        }),
      })),
    }));

    // Course-level completion stats
    const coursesWithStats = tree.map((course) => {
      let totalLessons = 0;
      let completedLessons = 0;
      for (const level of course.levels) {
        for (const lesson of level.lessons) {
          totalLessons++;
          if (lesson.progress?.completed) completedLessons++;
        }
      }
      return {
        ...course,
        totalLessons,
        completedLessons,
        percentComplete: totalLessons > 0 ? Math.round((completedLessons / totalLessons) * 100) : 0,
      };
    });

    return successResponse(coursesWithStats);
  }
);
