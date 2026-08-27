import { prisma } from '@/lib/db';
import { notFound } from 'next/navigation';
import { PlaybookChecklist } from './playbook-checklist';

export default async function PlaybookPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const scenario = await prisma.lmsScenario.findUnique({ where: { id } });

  if (!scenario) notFound();

  const serialized = {
    id: scenario.id,
    title: scenario.title,
    type: scenario.type,
    description: scenario.description,
    checklist: scenario.checklist,
    tips: scenario.tips,
    difficulty: scenario.difficulty,
    sort_order: scenario.sortOrder,
    is_active: scenario.isActive,
    created_at: scenario.createdAt.toISOString(),
  };

  return <PlaybookChecklist scenario={serialized as any} />;
}
