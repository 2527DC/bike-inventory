import { getCurrentUser } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { getLevelTitle, getXpForNextLevel } from '@/lib/xp';
import { Flame, Zap, BookOpen, Play, Video, HelpCircle, ChevronRight, Lightbulb, Megaphone, GraduationCap } from 'lucide-react';
import Link from 'next/link';

export default async function DashboardPage() {
  const user = await getCurrentUser();
  if (!user) return null;

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const [progress, quizCount, activities, dailyTip, announcements, moduleProgressCount, totalModuleCount] = await Promise.all([
    prisma.lmsProgress.findUnique({ where: { userId: user.id } }),
    prisma.lmsQuizAttempt.count({ where: { userId: user.id, passed: true } }),
    prisma.lmsActivityLog.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: 'desc' },
      take: 5,
    }),
    prisma.lmsDailyTip.findFirst({
      where: {
        isActive: true,
        OR: [{ scheduledFor: today }, { scheduledFor: null }],
      },
      orderBy: { scheduledFor: 'desc' },
    }),
    prisma.lmsAnnouncement.findMany({
      where: {
        isActive: true,
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      },
      orderBy: { createdAt: 'desc' },
      take: 3,
    }),
    prisma.lmsLessonProgress.count({ where: { userId: user.id, completed: true } }),
    prisma.lmsLesson.count({ where: { isActive: true } }),
  ]);
  const roleplayCount = 0;

  const xp = progress?.xp || 0;
  const level = progress?.level || 1;
  const streak = progress?.streakDays || 0;
  const videosWatched = progress?.videosWatched?.length || 0;
  const nextLevel = getXpForNextLevel(xp);
  const progressPercent = nextLevel.total > 0 ? Math.min(((xp / nextLevel.total) * 100), 100) : 100;
  const firstName = (user.name || 'Staff').split(' ')[0];

  const activityIcons: Record<string, string> = {
    login: '👋', quiz_passed: '✅', quiz_failed: '❌', roleplay_completed: '🎭',
    video_watched: '📹', scenario_completed: '📋', product_learned: '📦', achievement_earned: '🏆',
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-gray-900">Hey {firstName}!</h2>
        <p className="text-gray-500 text-sm">Let&apos;s sharpen those sales skills today</p>
      </div>

      <div className="bg-white rounded-2xl p-4 shadow-sm">
        <div className="flex items-center justify-between mb-2">
          <div>
            <p className="text-sm text-gray-500">Level {level}</p>
            <p className="font-bold text-lg text-blue-700">{getLevelTitle(level)}</p>
          </div>
          <div className="text-right">
            <p className="text-2xl font-bold text-blue-600">{xp}</p>
            <p className="text-xs text-gray-400">XP</p>
          </div>
        </div>
        <div className="w-full bg-gray-100 rounded-full h-3 overflow-hidden">
          <div className="bg-gradient-to-r from-blue-500 to-blue-600 h-full rounded-full xp-bar-animate transition-all" style={{ width: `${progressPercent}%` }} />
        </div>
        {nextLevel.needed > 0 && <p className="text-xs text-gray-400 mt-1">{nextLevel.needed} XP to next level</p>}
      </div>

      {streak > 0 && (
        <div className="bg-gradient-to-r from-orange-50 to-amber-50 rounded-2xl p-4 flex items-center gap-3 border border-orange-100">
          <div className="flame-animate text-3xl">🔥</div>
          <div>
            <p className="font-bold text-orange-700">{streak} Day Streak!</p>
            <p className="text-sm text-orange-500">Keep it going — train every day</p>
          </div>
        </div>
      )}

      {totalModuleCount > 0 && (
        <Link href="/learn" className="block bg-gradient-to-r from-indigo-50 to-blue-50 rounded-2xl p-4 border border-indigo-100">
          <div className="flex items-center gap-3">
            <div className="bg-indigo-100 p-2.5 rounded-xl text-indigo-600">
              <GraduationCap size={20} />
            </div>
            <div className="flex-1">
              <p className="font-bold text-indigo-800 text-sm">Training Course</p>
              <p className="text-xs text-indigo-500">{moduleProgressCount}/{totalModuleCount} modules completed</p>
              <div className="w-full bg-indigo-200/50 rounded-full h-2 mt-2">
                <div
                  className="bg-indigo-500 h-full rounded-full transition-all"
                  style={{ width: `${totalModuleCount > 0 ? Math.round((moduleProgressCount / totalModuleCount) * 100) : 0}%` }}
                />
              </div>
            </div>
            <ChevronRight size={18} className="text-indigo-300" />
          </div>
        </Link>
      )}

      {dailyTip && (
        <div className="bg-gradient-to-r from-emerald-50 to-teal-50 rounded-2xl p-4 border border-emerald-100">
          <div className="flex items-center gap-2 mb-2">
            <div className="bg-emerald-100 p-1.5 rounded-lg text-emerald-600">
              <Lightbulb size={16} />
            </div>
            <span className="text-xs font-semibold text-emerald-700 uppercase tracking-wide">Tip of the Day</span>
          </div>
          <p className="text-sm text-emerald-900">{dailyTip.content}</p>
        </div>
      )}

      {announcements.length > 0 && (
        <div className="space-y-2">
          {announcements.map((a) => (
            <div
              key={a.id}
              className={`bg-white rounded-2xl p-3 shadow-sm flex items-start gap-3 ${a.priority === 'urgent' ? 'border-2 border-red-300' : ''}`}
            >
              <div className={`p-1.5 rounded-lg mt-0.5 ${a.priority === 'urgent' ? 'bg-red-100 text-red-600' : 'bg-blue-50 text-blue-500'}`}>
                <Megaphone size={16} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="font-semibold text-gray-900 text-sm">{a.title}</p>
                  {a.priority !== 'normal' && (
                    <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${a.priority === 'urgent' ? 'bg-red-100 text-red-700' : 'bg-blue-100 text-blue-700'}`}>
                      {a.priority}
                    </span>
                  )}
                </div>
                <p className="text-xs text-gray-500 line-clamp-2">{a.content}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        {[
          { label: 'Quizzes Passed', value: quizCount, icon: HelpCircle, color: 'text-green-600 bg-green-50' },
          { label: 'Practice Sessions', value: roleplayCount, icon: Play, color: 'text-purple-600 bg-purple-50' },
          { label: 'Videos Watched', value: videosWatched, icon: Video, color: 'text-blue-600 bg-blue-50' },
          { label: 'Day Streak', value: streak, icon: Flame, color: 'text-orange-600 bg-orange-50' },
        ].map(({ label, value, icon: Icon, color }) => (
          <div key={label} className="bg-white rounded-2xl p-4 shadow-sm">
            <div className={`inline-flex p-2 rounded-xl ${color} mb-2`}><Icon size={18} /></div>
            <p className="text-2xl font-bold text-gray-900">{value}</p>
            <p className="text-xs text-gray-500">{label}</p>
          </div>
        ))}
      </div>

      <div>
        <h3 className="font-bold text-gray-900 mb-3">Continue Training</h3>
        <div className="space-y-2">
          {[
            { href: '/learn', icon: GraduationCap, label: 'Continue Course', desc: 'Your training modules', color: 'bg-indigo-500' },
            { href: '/practice', icon: Play, label: 'Practice with AI Customer', desc: 'Sharpen your pitch', color: 'bg-purple-500' },
            { href: '/quizzes', icon: HelpCircle, label: 'Take a Quiz', desc: 'Test your knowledge', color: 'bg-green-500' },
            { href: '/playbooks', icon: BookOpen, label: 'Read a Playbook', desc: 'Win-a-client checklists', color: 'bg-blue-500' },
          ].map(({ href, icon: Icon, label, desc, color }) => (
            <Link key={href} href={href} className="flex items-center gap-3 bg-white rounded-2xl p-4 shadow-sm card-hover">
              <div className={`${color} p-3 rounded-xl text-white`}><Icon size={20} /></div>
              <div className="flex-1">
                <p className="font-semibold text-gray-900 text-sm">{label}</p>
                <p className="text-xs text-gray-400">{desc}</p>
              </div>
              <ChevronRight size={18} className="text-gray-300" />
            </Link>
          ))}
        </div>
      </div>

      {activities.length > 0 && (
        <div>
          <h3 className="font-bold text-gray-900 mb-3">Recent Activity</h3>
          <div className="bg-white rounded-2xl shadow-sm divide-y divide-gray-50">
            {activities.map((a) => (
              <div key={a.id} className="flex items-center gap-3 px-4 py-3">
                <span className="text-lg">{activityIcons[a.activityType] || '📌'}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-gray-700 truncate">
                    {a.activityType.replace(/_/g, ' ').replace(/\b\w/g, (l: string) => l.toUpperCase())}
                  </p>
                  <p className="text-xs text-gray-400">
                    {new Date(a.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                  </p>
                </div>
                {a.xpEarned > 0 && (
                  <span className="text-xs font-bold text-blue-600 flex items-center gap-0.5">
                    <Zap size={12} />+{a.xpEarned}
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
