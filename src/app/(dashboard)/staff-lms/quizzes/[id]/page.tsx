import { prisma } from '@/lib/db';
import { notFound } from 'next/navigation';
import { QuizPlayer } from './quiz-player';

export default async function QuizPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const [quiz, questions] = await Promise.all([
    prisma.lmsQuiz.findUnique({ where: { id } }),
    prisma.lmsQuizQuestion.findMany({ where: { quizId: id }, orderBy: { sortOrder: 'asc' } }),
  ]);

  if (!quiz) notFound();

  const serializedQuiz = {
    id: quiz.id,
    title: quiz.title,
    description: quiz.description,
    type: quiz.type,
    difficulty: quiz.difficulty,
    passing_score: quiz.passingScore,
    xp_reward: quiz.xpReward,
    is_active: quiz.isActive,
    created_at: quiz.createdAt.toISOString(),
  };

  const serializedQuestions = questions.map((q) => ({
    id: q.id,
    quiz_id: q.quizId,
    question: q.question,
    options: q.options,
    correct_index: q.correctIndex,
    explanation: q.explanation,
    sort_order: q.sortOrder,
  }));

  return <QuizPlayer quiz={serializedQuiz as any} questions={serializedQuestions as any[]} />;
}
