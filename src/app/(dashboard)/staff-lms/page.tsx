import { getCurrentUser } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { getLevelTitle, getXpForNextLevel } from '@/lib/xp';
import {
  Flame,
  Zap,
  BookOpen,
  Trophy,
  Swords,
  Bike,
  CheckCircle2,
  ChevronRight,
  Lightbulb,
  Megaphone,
  GraduationCap,
  Sparkles,
  Award,
  ArrowUpRight,
  TrendingUp,
  Settings,
  HelpCircle,
  Clock,
} from 'lucide-react';
import Link from 'next/link';

export default async function StaffLmsDashboardPage() {
  const user = await getCurrentUser();
  if (!user) return null;

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const [
    progress,
    quizPassedCount,
    totalQuizAttempts,
    activities,
    dailyTip,
    announcements,
    completedLessonsCount,
    totalLessonsCount,
    topLearners,
  ] = await Promise.all([
    prisma.lmsProgress.findUnique({ where: { userId: user.id } }),
    prisma.lmsQuizAttempt.count({ where: { userId: user.id, passed: true } }),
    prisma.lmsQuizAttempt.count({ where: { userId: user.id } }),
    prisma.lmsActivityLog.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: 'desc' },
      take: 6,
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
    prisma.lmsProgress.findMany({
      orderBy: [{ xp: 'desc' }, { streakDays: 'desc' }],
      take: 5,
    }),
  ]);

  const xp = progress?.xp || 0;
  const level = progress?.level || 1;
  const streak = progress?.streakDays || 0;
  const longestStreak = progress?.longestStreak || 0;
  const nextLevel = getXpForNextLevel(xp);
  const progressPercent = nextLevel.total > 0 ? Math.min((xp / nextLevel.total) * 100, 100) : 100;
  const coursePercent = totalLessonsCount > 0 ? Math.round((completedLessonsCount / totalLessonsCount) * 100) : 0;
  const firstName = (user.name || 'Staff').split(' ')[0];
  const isAdmin = user.role === 'admin';

  // Find user's rank
  const allRankCount = await prisma.lmsProgress.count({
    where: { xp: { gt: xp } },
  });
  const userRank = allRankCount + 1;

  const activityIcons: Record<string, string> = {
    login: '👋',
    quiz_passed: '✅',
    quiz_failed: '❌',
    roleplay_completed: '🎭',
    video_watched: '📹',
    scenario_completed: '📋',
    product_learned: '📦',
    achievement_earned: '🏆',
  };

  return (
    <div className="space-y-6">
      {/* ─── Top Header & Personal Level Banner ─── */}
      <div className="bg-gradient-to-r from-slate-900 via-blue-950 to-slate-900 text-white rounded-2xl p-6 shadow-sm border border-slate-800">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-6">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-blue-500/20 text-blue-300 border border-blue-400/30">
                Staff Learning Hub
              </span>
              {streak > 0 && (
                <span className="flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-amber-500/20 text-amber-300 border border-amber-400/30">
                  <Flame className="h-3.5 w-3.5 text-amber-400 fill-amber-400 animate-pulse" />
                  {streak} Day Streak
                </span>
              )}
            </div>
            <h1 className="text-2xl lg:text-3xl font-bold tracking-tight">
              Welcome back, {firstName}!
            </h1>
            <p className="text-slate-400 text-sm">
              Sharpen your product knowledge, master sales objection handling, and climb the team ranks.
            </p>
          </div>

          {/* Level & XP Gauge */}
          <div className="bg-white/10 backdrop-blur-md border border-white/15 rounded-xl p-4 min-w-[280px]">
            <div className="flex items-center justify-between mb-2">
              <div>
                <span className="text-xs text-slate-300 font-medium">Current Standing</span>
                <p className="text-base font-bold text-white flex items-center gap-1.5">
                  <Sparkles className="h-4 w-4 text-amber-300" />
                  Level {level} &bull; {getLevelTitle(level)}
                </p>
              </div>
              <div className="text-right">
                <p className="text-2xl font-black text-blue-400">{xp.toLocaleString()}</p>
                <span className="text-[10px] text-slate-300 uppercase tracking-wider font-semibold">Total XP</span>
              </div>
            </div>
            <div className="w-full bg-slate-800/80 rounded-full h-2.5 overflow-hidden">
              <div
                className="bg-gradient-to-r from-blue-400 to-indigo-400 h-full rounded-full transition-all duration-500"
                style={{ width: `${progressPercent}%` }}
              />
            </div>
            <div className="flex justify-between text-[11px] text-slate-300 mt-1.5 font-medium">
              <span>{nextLevel.needed > 0 ? `${nextLevel.needed} XP to Level ${level + 1}` : 'Max Level'}</span>
              <span>{Math.round(progressPercent)}%</span>
            </div>
          </div>
        </div>
      </div>

      {/* ─── KPI Metrics Overview ─── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Streak */}
        <div className="bg-white rounded-xl p-4 border border-slate-200 shadow-sm flex items-center justify-between">
          <div>
            <p className="text-xs font-medium text-slate-500 uppercase tracking-wider">Training Streak</p>
            <p className="text-2xl font-bold text-slate-900 mt-1">{streak} <span className="text-xs font-normal text-slate-500">Days</span></p>
            <p className="text-xs text-amber-600 font-medium mt-0.5">Best: {longestStreak} days</p>
          </div>
          <div className="h-12 w-12 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center font-bold text-xl">
            🔥
          </div>
        </div>

        {/* Course Progress */}
        <div className="bg-white rounded-xl p-4 border border-slate-200 shadow-sm flex items-center justify-between">
          <div>
            <p className="text-xs font-medium text-slate-500 uppercase tracking-wider">Course Progress</p>
            <p className="text-2xl font-bold text-slate-900 mt-1">{coursePercent}%</p>
            <p className="text-xs text-blue-600 font-medium mt-0.5">{completedLessonsCount}/{totalLessonsCount} Lessons Done</p>
          </div>
          <div className="h-12 w-12 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center">
            <BookOpen className="h-6 w-6" />
          </div>
        </div>

        {/* Quizzes Passed */}
        <div className="bg-white rounded-xl p-4 border border-slate-200 shadow-sm flex items-center justify-between">
          <div>
            <p className="text-xs font-medium text-slate-500 uppercase tracking-wider">Quizzes Passed</p>
            <p className="text-2xl font-bold text-slate-900 mt-1">{quizPassedCount}</p>
            <p className="text-xs text-emerald-600 font-medium mt-0.5">{totalQuizAttempts} total attempts</p>
          </div>
          <div className="h-12 w-12 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center">
            <CheckCircle2 className="h-6 w-6" />
          </div>
        </div>

        {/* Leaderboard Standing */}
        <div className="bg-white rounded-xl p-4 border border-slate-200 shadow-sm flex items-center justify-between">
          <div>
            <p className="text-xs font-medium text-slate-500 uppercase tracking-wider">Team Rank</p>
            <p className="text-2xl font-bold text-slate-900 mt-1">#{userRank}</p>
            <p className="text-xs text-purple-600 font-medium mt-0.5">Top Performer Board</p>
          </div>
          <div className="h-12 w-12 rounded-xl bg-purple-50 text-purple-600 flex items-center justify-center">
            <Trophy className="h-6 w-6" />
          </div>
        </div>
      </div>

      {/* ─── Main Navigation Hub (Feature Cards) ─── */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Learning Card */}
        <Link
          href="/staff-lms/learning"
          className="group bg-white rounded-2xl p-5 border border-slate-200 hover:border-blue-400 hover:shadow-md transition-all flex flex-col justify-between"
        >
          <div className="space-y-3">
            <div className="h-10 w-10 rounded-xl bg-blue-100 text-blue-700 flex items-center justify-center font-bold group-hover:scale-105 transition-transform">
              <GraduationCap className="h-5 w-5" />
            </div>
            <div>
              <h3 className="font-bold text-slate-900 text-base group-hover:text-blue-600 transition-colors">
                Structured Learning
              </h3>
              <p className="text-xs text-slate-500 mt-1 line-clamp-2">
                Structured course tracks, module lessons, and weekly test certifications.
              </p>
            </div>
          </div>
          <div className="flex items-center text-xs font-semibold text-blue-600 mt-4 group-hover:translate-x-1 transition-transform">
            Start Learning <ChevronRight className="h-4 w-4 ml-0.5" />
          </div>
        </Link>

        {/* Product Knowledge Card */}
        <Link
          href="/staff-lms/product-learning"
          className="group bg-white rounded-2xl p-5 border border-slate-200 hover:border-emerald-400 hover:shadow-md transition-all flex flex-col justify-between"
        >
          <div className="space-y-3">
            <div className="h-10 w-10 rounded-xl bg-emerald-100 text-emerald-700 flex items-center justify-center font-bold group-hover:scale-105 transition-transform">
              <Bike className="h-5 w-5" />
            </div>
            <div>
              <h3 className="font-bold text-slate-900 text-base group-hover:text-emerald-600 transition-colors">
                Product Knowledge
              </h3>
              <p className="text-xs text-slate-500 mt-1 line-clamp-2">
                E-Cycles, MTBs, specifications, talking points, customer objections & showroom view.
              </p>
            </div>
          </div>
          <div className="flex items-center text-xs font-semibold text-emerald-600 mt-4 group-hover:translate-x-1 transition-transform">
            Explore Bikes <ChevronRight className="h-4 w-4 ml-0.5" />
          </div>
        </Link>

        {/* Practice & Roleplay Card */}
        <Link
          href="/staff-lms/practice"
          className="group bg-white rounded-2xl p-5 border border-slate-200 hover:border-purple-400 hover:shadow-md transition-all flex flex-col justify-between"
        >
          <div className="space-y-3">
            <div className="h-10 w-10 rounded-xl bg-purple-100 text-purple-700 flex items-center justify-center font-bold group-hover:scale-105 transition-transform">
              <Swords className="h-5 w-5" />
            </div>
            <div>
              <h3 className="font-bold text-slate-900 text-base group-hover:text-purple-600 transition-colors">
                Practice & Scenarios
              </h3>
              <p className="text-xs text-slate-500 mt-1 line-clamp-2">
                Interactive customer simulations, parent objections, price negotiations & instant feedback.
              </p>
            </div>
          </div>
          <div className="flex items-center text-xs font-semibold text-purple-600 mt-4 group-hover:translate-x-1 transition-transform">
            Practice Selling <ChevronRight className="h-4 w-4 ml-0.5" />
          </div>
        </Link>

        {/* Rank & Leaderboard Card */}
        <Link
          href="/staff-lms/rank"
          className="group bg-white rounded-2xl p-5 border border-slate-200 hover:border-amber-400 hover:shadow-md transition-all flex flex-col justify-between"
        >
          <div className="space-y-3">
            <div className="h-10 w-10 rounded-xl bg-amber-100 text-amber-700 flex items-center justify-center font-bold group-hover:scale-105 transition-transform">
              <Trophy className="h-5 w-5" />
            </div>
            <div>
              <h3 className="font-bold text-slate-900 text-base group-hover:text-amber-600 transition-colors">
                Leaderboard & Rank
              </h3>
              <p className="text-xs text-slate-500 mt-1 line-clamp-2">
                Team rankings, earned achievement badges, and monthly performance standings.
              </p>
            </div>
          </div>
          <div className="flex items-center text-xs font-semibold text-amber-600 mt-4 group-hover:translate-x-1 transition-transform">
            View Rankings <ChevronRight className="h-4 w-4 ml-0.5" />
          </div>
        </Link>
      </div>

      {/* ─── Two Column Layout: Daily Focus & Activity Feed ─── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left 2 Columns: Daily Tips, Announcements & Playbooks */}
        <div className="lg:col-span-2 space-y-6">
          {/* Daily Sales Tip */}
          {dailyTip && (
            <div className="bg-gradient-to-r from-amber-50/80 to-yellow-50/80 border border-amber-200/80 rounded-2xl p-5 shadow-sm">
              <div className="flex items-start gap-3">
                <div className="h-9 w-9 rounded-xl bg-amber-100 text-amber-700 flex items-center justify-center flex-shrink-0">
                  <Lightbulb className="h-5 w-5" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold uppercase tracking-wider text-amber-800">
                      Daily Sales Trigger &bull; {dailyTip.category}
                    </span>
                  </div>
                  <p className="text-sm text-amber-950 font-medium mt-1 leading-relaxed">
                    {dailyTip.content}
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Announcements */}
          {announcements.length > 0 && (
            <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-sm space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="font-bold text-slate-900 text-sm flex items-center gap-2">
                  <Megaphone className="h-4 w-4 text-blue-600" />
                  Store & Training Announcements
                </h3>
              </div>
              <div className="space-y-2.5">
                {announcements.map((a) => (
                  <div key={a.id} className="p-3 rounded-xl bg-slate-50 border border-slate-100">
                    <p className="text-xs font-bold text-slate-800">{a.title}</p>
                    <p className="text-xs text-slate-600 mt-0.5">{a.content}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Tools & Secondary Portals */}
          <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-sm">
            <h3 className="font-bold text-slate-900 text-sm mb-3">Quick Training Utilities</h3>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <Link
                href="/staff-lms/playbooks"
                className="p-3 rounded-xl bg-slate-50 hover:bg-blue-50 border border-slate-100 hover:border-blue-200 transition-all text-center group"
              >
                <p className="text-xs font-bold text-slate-800 group-hover:text-blue-600">Sales Playbooks</p>
                <p className="text-[10px] text-slate-500 mt-0.5">Checklists & flows</p>
              </Link>
              <Link
                href="/staff-lms/quizzes"
                className="p-3 rounded-xl bg-slate-50 hover:bg-emerald-50 border border-slate-100 hover:border-emerald-200 transition-all text-center group"
              >
                <p className="text-xs font-bold text-slate-800 group-hover:text-emerald-600">Daily Quizzes</p>
                <p className="text-[10px] text-slate-500 mt-0.5">Test knowledge</p>
              </Link>
              <Link
                href="/staff-lms/videos"
                className="p-3 rounded-xl bg-slate-50 hover:bg-purple-50 border border-slate-100 hover:border-purple-200 transition-all text-center group"
              >
                <p className="text-xs font-bold text-slate-800 group-hover:text-purple-600">Video Modules</p>
                <p className="text-[10px] text-slate-500 mt-0.5">Watch & learn</p>
              </Link>
              <Link
                href="/staff-lms/compare"
                className="p-3 rounded-xl bg-slate-50 hover:bg-amber-50 border border-slate-100 hover:border-amber-200 transition-all text-center group"
              >
                <p className="text-xs font-bold text-slate-800 group-hover:text-amber-600">Bike Comparison</p>
                <p className="text-[10px] text-slate-500 mt-0.5">Side-by-side</p>
              </Link>
            </div>
          </div>

          {/* Admin Management Section */}
          {isAdmin && (
            <div className="bg-slate-900 text-white rounded-2xl p-5 shadow-sm border border-slate-800 flex items-center justify-between">
              <div className="space-y-0.5">
                <h3 className="font-bold text-sm flex items-center gap-1.5">
                  <Settings className="h-4 w-4 text-blue-400" />
                  Staff LMS Content Management
                </h3>
                <p className="text-xs text-slate-400">
                  Manage curriculum, course lessons, product playbooks, and video modules.
                </p>
              </div>
              <Link
                href="/staff-lms/admin"
                className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold rounded-xl transition-colors flex items-center gap-1"
              >
                Admin Hub <ChevronRight className="h-3.5 w-3.5" />
              </Link>
            </div>
          )}
        </div>

        {/* Right Column: Activity Log & Team Leaders */}
        <div className="space-y-6">
          {/* Top 5 Team Leaderboard */}
          <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-sm space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-slate-900 text-sm flex items-center gap-1.5">
                <Trophy className="h-4 w-4 text-amber-500" />
                Team Top Performers
              </h3>
              <Link href="/staff-lms/rank" className="text-xs font-semibold text-blue-600 hover:underline">
                View all
              </Link>
            </div>
            <div className="space-y-2.5">
              {topLearners.map((item, idx) => (
                <div
                  key={item.id}
                  className={`flex items-center justify-between p-2.5 rounded-xl text-xs ${
                    item.userId === user.id ? 'bg-blue-50/80 border border-blue-200 font-semibold' : 'bg-slate-50'
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    <span
                      className={`h-5 w-5 rounded-full flex items-center justify-center font-bold text-[10px] ${
                        idx === 0
                          ? 'bg-amber-400 text-white'
                          : idx === 1
                          ? 'bg-slate-300 text-slate-700'
                          : idx === 2
                          ? 'bg-amber-600 text-white'
                          : 'bg-slate-200 text-slate-600'
                      }`}
                    >
                      {idx + 1}
                    </span>
                    <span className="truncate max-w-[120px] text-slate-800">
                      {item.userId === user.id ? 'You' : `Learner ${item.userId.slice(0, 4)}`}
                    </span>
                  </div>
                  <div className="text-right">
                    <span className="font-bold text-slate-900">{item.xp.toLocaleString()} XP</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Recent Training Activity */}
          <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-sm space-y-3">
            <h3 className="font-bold text-slate-900 text-sm flex items-center gap-1.5">
              <Clock className="h-4 w-4 text-slate-500" />
              Recent Activity
            </h3>
            {activities.length === 0 ? (
              <p className="text-xs text-slate-400 py-3 text-center">No activity logged yet today.</p>
            ) : (
              <div className="space-y-2.5">
                {activities.map((act) => (
                  <div key={act.id} className="flex items-center justify-between text-xs py-1.5 border-b border-slate-100 last:border-0">
                    <div className="flex items-center gap-2 min-w-0">
                      <span>{activityIcons[act.activityType] || '⚡'}</span>
                      <span className="text-slate-700 truncate capitalize">
                        {act.activityType.replace('_', ' ')}
                      </span>
                    </div>
                    {act.xpEarned > 0 && (
                      <span className="text-emerald-600 font-bold text-[11px] flex-shrink-0">
                        +{act.xpEarned} XP
                      </span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
