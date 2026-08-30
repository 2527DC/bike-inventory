import { getCurrentUser } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { getLevelTitle, getXpForNextLevel } from '@/lib/xp';
import { LogoutButton } from './logout-button';
import { Zap, Flame, HelpCircle, Play, Video, Award, Calendar } from 'lucide-react';

export default async function ProfilePage() {
  const user = await getCurrentUser();
  if (!user) return null;

  const [progress, achievements, earned, quizCount, activities] = await Promise.all([
    prisma.lmsProgress.findUnique({ where: { userId: user.id } }),
    prisma.lmsAchievement.findMany({ orderBy: { criteriaValue: 'asc' } }),
    prisma.lmsUserAchievement.findMany({ where: { userId: user.id }, include: { achievement: true } }),
    prisma.lmsQuizAttempt.count({ where: { userId: user.id, passed: true } }),
    prisma.lmsActivityLog.findMany({ where: { userId: user.id }, orderBy: { createdAt: 'desc' }, take: 10 }),
  ]);
  const roleplayCount = 0;

  const xp = progress?.xp || 0;
  const level = progress?.level || 1;
  const streak = progress?.streakDays || 0;
  const videosWatched = progress?.videosWatched?.length || 0;
  const nextLevel = getXpForNextLevel(xp);
  const progressPercent = nextLevel.total > 0 ? Math.min((xp / nextLevel.total) * 100, 100) : 100;
  const earnedIds = new Set(earned.map((e) => e.achievementId));

  const ACHIEVEMENT_ICONS: Record<string, string> = {
    star: '⭐', trophy: '🏆', theater: '🎭', flame: '🔥', fire: '🔥',
    rocket: '🚀', play: '▶️', 'trending-up': '📈', award: '🎖️', crown: '👑',
  };

  return (
    <div className="space-y-5 pb-4">
      <div className="bg-white rounded-2xl p-5 shadow-sm text-center">
        <div className="w-20 h-20 bg-blue-600 rounded-full flex items-center justify-center text-3xl font-bold text-white mx-auto">
          {(user.name || 'User').charAt(0).toUpperCase()}
        </div>
        <h2 className="text-xl font-bold text-gray-900 mt-3">{user.name || 'User'}</h2>
        {/* CurrentUser carries roleId/roleKey/roleName — there is no `role`, so this rendered
            blank. roleName is the display label an admin edits on /team/permissions. */}
        <p className="text-sm text-gray-500">{user.roleName}</p>
        <div className="mt-3">
          <p className="text-sm text-gray-500">Level {level}</p>
          <p className="font-bold text-blue-600">{getLevelTitle(level)}</p>
          <div className="w-full bg-gray-100 rounded-full h-2.5 mt-2 overflow-hidden">
            <div className="bg-gradient-to-r from-blue-500 to-blue-600 h-full rounded-full xp-bar-animate" style={{ width: `${progressPercent}%` }} />
          </div>
          <p className="text-xs text-gray-400 mt-1">{xp} XP · {nextLevel.needed > 0 ? `${nextLevel.needed} to next level` : 'Max level!'}</p>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2">
        {[
          { icon: Zap, label: 'Total XP', value: xp, color: 'text-blue-500' },
          { icon: Flame, label: 'Streak', value: `${streak}d`, color: 'text-orange-500' },
          { icon: HelpCircle, label: 'Quizzes', value: quizCount, color: 'text-green-500' },
          { icon: Play, label: 'Practice', value: roleplayCount, color: 'text-purple-500' },
          { icon: Video, label: 'Videos', value: videosWatched, color: 'text-pink-500' },
          { icon: Award, label: 'Badges', value: earned.length, color: 'text-yellow-500' },
        ].map(({ icon: Icon, label, value, color }) => (
          <div key={label} className="bg-white rounded-xl p-3 shadow-sm text-center">
            <Icon size={18} className={`mx-auto ${color} mb-1`} />
            <p className="text-lg font-bold text-gray-900">{value}</p>
            <p className="text-[10px] text-gray-400">{label}</p>
          </div>
        ))}
      </div>

      <div>
        <h3 className="font-bold text-gray-900 mb-3">Achievements</h3>
        <div className="grid grid-cols-2 gap-2">
          {achievements.map((ach) => {
            const isEarned = earnedIds.has(ach.id);
            return (
              <div key={ach.id} className={`rounded-xl p-3 border ${isEarned ? 'bg-white border-yellow-200' : 'bg-gray-50 border-gray-100 opacity-50'}`}>
                <div className="flex items-center gap-2">
                  <span className="text-2xl">{ACHIEVEMENT_ICONS[ach.icon] || '🏅'}</span>
                  <div>
                    <p className="text-xs font-bold text-gray-900">{ach.name}</p>
                    <p className="text-[10px] text-gray-500">{ach.description}</p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {activities.length > 0 && (
        <div>
          <h3 className="font-bold text-gray-900 mb-3">Recent Activity</h3>
          <div className="bg-white rounded-2xl shadow-sm divide-y divide-gray-50">
            {activities.map((a) => (
              <div key={a.id} className="flex items-center gap-3 px-4 py-3">
                <Calendar size={14} className="text-gray-400" />
                <div className="flex-1">
                  <p className="text-sm text-gray-700">{a.activityType.replace(/_/g, ' ').replace(/\b\w/g, (l: string) => l.toUpperCase())}</p>
                  <p className="text-[10px] text-gray-400">{new Date(a.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</p>
                </div>
                {a.xpEarned > 0 && <span className="text-xs font-bold text-blue-600">+{a.xpEarned}</span>}
              </div>
            ))}
          </div>
        </div>
      )}

      <LogoutButton />
    </div>
  );
}
