import { prisma } from '@/lib/db';
import Link from 'next/link';
import { DoorOpen, Phone, RefreshCw, PartyPopper, Baby, Scale, Wrench, ChevronRight } from 'lucide-react';
import { getDifficultyColor } from '@/lib/utils';

const SCENARIO_ICONS: Record<string, typeof DoorOpen> = {
  'walk-in': DoorOpen, 'phone': Phone, 'repeat': RefreshCw,
  'festival': PartyPopper, 'parent': Baby, 'comparison': Scale, 'service-upsell': Wrench,
};

const SCENARIO_COLORS: Record<string, string> = {
  'walk-in': 'bg-blue-500', 'phone': 'bg-green-500', 'repeat': 'bg-purple-500',
  'festival': 'bg-orange-500', 'parent': 'bg-pink-500', 'comparison': 'bg-red-500', 'service-upsell': 'bg-teal-500',
};

export default async function PlaybooksPage() {
  const scenarios = await prisma.lmsScenario.findMany({
    where: { isActive: true },
    orderBy: { sortOrder: 'asc' },
  });

  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-500">Master every customer scenario with step-by-step checklists.</p>
      <div className="space-y-3">
        {scenarios.map((scenario) => {
          const Icon = SCENARIO_ICONS[scenario.type] || DoorOpen;
          const color = SCENARIO_COLORS[scenario.type] || 'bg-gray-500';
          const checklist = (scenario.checklist || []) as { step: string }[];
          return (
            <Link key={scenario.id} href={`/staff-lms/playbooks/${scenario.id}`} className="block bg-white rounded-2xl p-4 shadow-sm card-hover">
              <div className="flex items-start gap-3">
                <div className={`${color} p-3 rounded-xl text-white flex-shrink-0`}><Icon size={20} /></div>
                <div className="flex-1 min-w-0">
                  <h3 className="font-semibold text-gray-900 text-sm">{scenario.title}</h3>
                  <p className="text-xs text-gray-500 mt-0.5 line-clamp-2">{scenario.description}</p>
                  <div className="flex items-center gap-2 mt-2">
                    <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${getDifficultyColor(scenario.difficulty)}`}>{scenario.difficulty}</span>
                    <span className="text-[10px] text-gray-400">{checklist.length} steps</span>
                  </div>
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
