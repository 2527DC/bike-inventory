'use client';

// Client component on purpose. This page used to query Prisma as a server component with no
// per-request input, so Next prerendered it at BUILD time and `npm run build` needed a live
// Postgres. It now fetches from GET /api/staff-lms/learning/playbooks, which is already
// guarded by staff_lms_learning / view.
//
// No shape adapter is needed here: this screen reads only id, type, title, description,
// difficulty and checklist, which are spelled identically in the API row and the old
// Prisma row.

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  DoorOpen, Phone, RefreshCw, PartyPopper, Baby, Scale, Wrench, ChevronRight, AlertCircle,
} from 'lucide-react';
import { getDifficultyColor } from '@/lib/utils';
import { apiFetch } from '@/lib/api-client';
import { createLogger } from '@/lib/logger';
import { SkeletonList } from '@/components/ui/skeleton';
import type { SerializedLmsScenario } from '@/lib/staff-lms/serialize';

const log = createLogger('staff-lms:playbooks');

const SCENARIO_ICONS: Record<string, typeof DoorOpen> = {
  'walk-in': DoorOpen, 'phone': Phone, 'repeat': RefreshCw,
  'festival': PartyPopper, 'parent': Baby, 'comparison': Scale, 'service-upsell': Wrench,
};

const SCENARIO_COLORS: Record<string, string> = {
  'walk-in': 'bg-blue-500', 'phone': 'bg-green-500', 'repeat': 'bg-purple-500',
  'festival': 'bg-orange-500', 'parent': 'bg-pink-500', 'comparison': 'bg-red-500', 'service-upsell': 'bg-teal-500',
};

export default function PlaybooksPage() {
  const [scenarios, setScenarios] = useState<SerializedLmsScenario[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<SerializedLmsScenario[]>('/api/staff-lms/learning/playbooks')
      .then(setScenarios)
      .catch((e: unknown) => {
        const message = e instanceof Error ? e.message : 'Failed to load playbooks';
        log.error('playbook list load failed', { message });
        setError(message);
      })
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-500">Master every customer scenario with step-by-step checklists.</p>

      {loading ? (
        <SkeletonList count={4} type="card" />
      ) : error ? (
        // The server version could not fail visibly — a throw became a 500 page.
        <div className="text-center py-10">
          <AlertCircle className="h-8 w-8 text-red-300 mx-auto mb-2" />
          <p className="text-sm text-slate-600">{error}</p>
        </div>
      ) : scenarios.length === 0 ? (
        <div className="text-center py-10">
          <p className="text-sm text-slate-400">No playbooks yet.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {scenarios.map((scenario) => {
            const Icon = SCENARIO_ICONS[scenario.type] || DoorOpen;
            const color = SCENARIO_COLORS[scenario.type] || 'bg-gray-500';
            const checklist = scenario.checklist || [];
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
      )}
    </div>
  );
}
