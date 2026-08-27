import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { getLevelTitle } from '@/lib/xp';
import Link from 'next/link';
import { ArrowLeft, Crown, Trophy } from 'lucide-react';

export default async function AdminDashboardPage() {
  const user = await getCurrentUser();
  if (!user || user.role !== 'admin') redirect('/');

  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

  const [allProgress, quizAttempts, recentActivities, productLogs] =
    await Promise.all([
      prisma.lmsProgress.findMany({
        include: { user: { select: { id: true, name: true } } },
        orderBy: { xp: 'desc' },
      }),
      prisma.lmsQuizAttempt.findMany({
        select: { userId: true, passed: true },
      }),
      prisma.lmsActivityLog.findMany({
        where: { createdAt: { gte: sevenDaysAgo } },
        select: { userId: true, createdAt: true },
      }),
      prisma.lmsActivityLog.findMany({
        where: { activityType: 'product_learned' },
        select: { userId: true },
      }),
    ]);
  const roleplaySessions: { userId: string; completed: boolean }[] = [];

  // Build per-user stats
  const quizByUser = new Map<string, { passed: number; failed: number }>();
  for (const a of quizAttempts) {
    const entry = quizByUser.get(a.userId) || { passed: 0, failed: 0 };
    a.passed ? entry.passed++ : entry.failed++;
    quizByUser.set(a.userId, entry);
  }

  const roleplayByUser = new Map<string, number>();
  for (const s of roleplaySessions) {
    if (s.completed) {
      roleplayByUser.set(s.userId, (roleplayByUser.get(s.userId) || 0) + 1);
    }
  }

  const activeUserIds = new Set(recentActivities.map((a) => a.userId));

  const productsByUser = new Map<string, number>();
  for (const l of productLogs) {
    productsByUser.set(l.userId, (productsByUser.get(l.userId) || 0) + 1);
  }

  // Last active per user from recent activities
  const lastActiveByUser = new Map<string, Date>();
  for (const a of recentActivities) {
    const existing = lastActiveByUser.get(a.userId);
    if (!existing || a.createdAt > existing) {
      lastActiveByUser.set(a.userId, a.createdAt);
    }
  }

  // Weekly chart data (last 7 days)
  const dailyCounts: { label: string; count: number }[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const dayStr = d.toLocaleDateString('en-IN', { weekday: 'short' });
    const count = recentActivities.filter((a) => {
      const ad = new Date(a.createdAt);
      return (
        ad.getDate() === d.getDate() &&
        ad.getMonth() === d.getMonth() &&
        ad.getFullYear() === d.getFullYear()
      );
    }).length;
    dailyCounts.push({ label: dayStr, count });
  }
  const maxCount = Math.max(...dailyCounts.map((d) => d.count), 1);

  const totalMembers = allProgress.length;
  const activeThisWeek = activeUserIds.size;
  const avgXp = totalMembers > 0 ? Math.round(allProgress.reduce((s, p) => s + p.xp, 0) / totalMembers) : 0;
  const totalQuizPassed = quizAttempts.filter((a) => a.passed).length;

  const members = allProgress.map((p) => ({
    id: p.user.id,
    name: p.user.name,
    level: p.level,
    xp: p.xp,
    streak: p.streakDays,
    quizzesPassed: quizByUser.get(p.user.id)?.passed || 0,
    practicesDone: roleplayByUser.get(p.user.id) || 0,
    productsStudied: productsByUser.get(p.user.id) || 0,
    lastActive: lastActiveByUser.get(p.user.id) || p.lastActiveDate,
    isActiveThisWeek: activeUserIds.has(p.user.id),
  }));

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/admin" className="text-gray-400 hover:text-gray-600">
          <ArrowLeft size={20} />
        </Link>
        <h2 className="text-xl font-bold text-gray-900">Team Performance</h2>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 gap-3">
        {[
          { label: 'Team Members', value: totalMembers },
          { label: 'Active This Week', value: activeThisWeek },
          { label: 'Avg XP', value: avgXp },
          { label: 'Quizzes Passed', value: totalQuizPassed },
        ].map(({ label, value }) => (
          <div key={label} className="bg-white rounded-2xl p-4 shadow-sm text-center">
            <p className="text-2xl font-bold text-blue-600">{value}</p>
            <p className="text-xs text-gray-500">{label}</p>
          </div>
        ))}
      </div>

      {/* Weekly activity chart */}
      <div className="bg-white rounded-2xl p-4 shadow-sm">
        <h3 className="text-sm font-semibold text-gray-700 mb-3">Weekly Activity</h3>
        <div className="flex items-end gap-2 h-32">
          {dailyCounts.map((d, i) => (
            <div key={i} className="flex-1 flex flex-col items-center gap-1">
              <span className="text-xs text-gray-500">{d.count}</span>
              <div
                className="w-full bg-blue-500 rounded-t-md transition-all"
                style={{ height: `${(d.count / maxCount) * 100}%`, minHeight: d.count > 0 ? '4px' : '0' }}
              />
              <span className="text-xs text-gray-400">{d.label}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Per-member cards */}
      <div className="space-y-3">
        <h3 className="text-sm font-semibold text-gray-700">Team Members</h3>
        {members.map((m, idx) => (
          <div key={m.id} className="bg-white rounded-2xl p-4 shadow-sm relative">
            {idx === 0 && members.length > 1 && (
              <span className="absolute top-3 right-3 flex items-center gap-1 text-xs font-bold text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full">
                <Trophy size={12} /> Most Active
              </span>
            )}
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center text-blue-700 font-bold text-sm">
                {m.name.charAt(0)}
              </div>
              <div>
                <p className="font-semibold text-gray-900">{m.name}</p>
                <p className="text-xs text-gray-400">
                  Level {m.level} &middot; {getLevelTitle(m.level)}
                </p>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2 text-center">
              {[
                { label: 'XP', value: m.xp },
                { label: 'Streak', value: `${m.streak}d` },
                { label: 'Quizzes', value: m.quizzesPassed },
                { label: 'Practice', value: m.practicesDone },
                { label: 'Products', value: m.productsStudied },
                {
                  label: 'Last Active',
                  value: new Date(m.lastActive).toLocaleDateString('en-IN', {
                    day: 'numeric',
                    month: 'short',
                  }),
                },
              ].map(({ label, value }) => (
                <div key={label}>
                  <p className="text-sm font-bold text-gray-800">{value}</p>
                  <p className="text-xs text-gray-400">{label}</p>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
