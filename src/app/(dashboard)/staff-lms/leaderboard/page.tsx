import { prisma } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth';
import { getLevelTitle } from '@/lib/xp';
import { Crown, Flame, Zap, Trophy } from 'lucide-react';

export default async function LeaderboardPage() {
  const user = await getCurrentUser();

  const entries = await prisma.lmsProgress.findMany({
    include: { user: { select: { name: true } } },
    orderBy: { xp: 'desc' },
  });

  const ranked = entries.map((e, i) => ({
    rank: i + 1,
    userId: e.userId,
    name: e.user.name,
    xp: e.xp,
    level: e.level,
    streak: e.streakDays,
    isMe: e.userId === user?.id,
  }));

  const totalXp = ranked.reduce((sum, e) => sum + e.xp, 0);
  const longestStreak = Math.max(...ranked.map((e) => e.streak), 0);

  const RANK_STYLES = [
    'bg-gradient-to-r from-yellow-50 to-amber-50 border-yellow-200',
    'bg-gradient-to-r from-gray-50 to-slate-50 border-gray-200',
    'bg-gradient-to-r from-orange-50 to-amber-50 border-orange-200',
  ];

  const RANK_ICONS = ['🥇', '🥈', '🥉'];

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3">
        <div className="bg-white rounded-2xl p-4 shadow-sm text-center">
          <Zap size={20} className="mx-auto text-blue-500 mb-1" />
          <p className="text-xl font-bold text-gray-900">{totalXp.toLocaleString()}</p>
          <p className="text-[10px] text-gray-500">Team Total XP</p>
        </div>
        <div className="bg-white rounded-2xl p-4 shadow-sm text-center">
          <Flame size={20} className="mx-auto text-orange-500 mb-1" />
          <p className="text-xl font-bold text-gray-900">{longestStreak}</p>
          <p className="text-[10px] text-gray-500">Best Streak</p>
        </div>
      </div>

      <div className="space-y-2">
        {ranked.map((entry) => (
          <div key={entry.userId} className={`rounded-2xl p-4 border transition-all ${
            entry.rank <= 3 ? RANK_STYLES[entry.rank - 1] : entry.isMe ? 'bg-blue-50 border-blue-200' : 'bg-white border-gray-100'
          }`}>
            <div className="flex items-center gap-3">
              <div className="w-10 text-center flex-shrink-0">
                {entry.rank <= 3 ? <span className="text-2xl">{RANK_ICONS[entry.rank - 1]}</span> : <span className="text-lg font-bold text-gray-400">#{entry.rank}</span>}
              </div>
              <div className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold ${entry.isMe ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-600'}`}>
                {entry.name.charAt(0).toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="font-semibold text-gray-900 text-sm truncate">
                    {entry.name}{entry.isMe && <span className="text-blue-500 ml-1">(You)</span>}
                  </p>
                  {entry.rank === 1 && <Crown size={14} className="text-yellow-500" />}
                </div>
                <p className="text-xs text-gray-500">Lvl {entry.level} · {getLevelTitle(entry.level)}</p>
              </div>
              <div className="text-right flex-shrink-0">
                <p className="font-bold text-blue-600 text-sm">{entry.xp.toLocaleString()} XP</p>
                {entry.streak > 0 && <p className="text-[10px] text-orange-500 flex items-center justify-end gap-0.5">🔥 {entry.streak}d</p>}
              </div>
            </div>
          </div>
        ))}
      </div>

      {ranked.length === 0 && (
        <div className="text-center py-16">
          <Trophy size={48} className="mx-auto text-gray-300 mb-4" />
          <p className="text-gray-500">No one on the leaderboard yet.</p>
          <p className="text-sm text-gray-400">Start training to claim the top spot!</p>
        </div>
      )}
    </div>
  );
}
