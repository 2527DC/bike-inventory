import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { getLevelFromXp } from '@/lib/xp';
import { LmsHeader as Header } from '@/components/lms-header';
import { LmsBottomNav as BottomNav } from '@/components/lms-bottom-nav';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  if (!user) redirect('/login');

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const progress = await prisma.lmsProgress.findUnique({ where: { userId: user.id } });

  if (progress) {
    const lastActive = new Date(progress.lastActiveDate);
    lastActive.setHours(0, 0, 0, 0);

    if (lastActive.getTime() !== today.getTime()) {
      const yesterday = new Date(today);
      yesterday.setDate(yesterday.getDate() - 1);
      const newStreak = lastActive.getTime() === yesterday.getTime() ? progress.streakDays + 1 : 1;
      const newXp = progress.xp + 15;
      await prisma.lmsProgress.update({
        where: { userId: user.id },
        data: {
          lastActiveDate: today,
          streakDays: newStreak,
          longestStreak: Math.max(newStreak, progress.longestStreak),
          xp: newXp,
          level: getLevelFromXp(newXp),
        },
      });
      await prisma.lmsActivityLog.create({
        data: { userId: user.id, activityType: 'login', details: { date: today.toISOString() }, xpEarned: 15 },
      });
    }
  } else {
    await prisma.lmsProgress.create({
      data: { userId: user.id, xp: 15, level: 1, streakDays: 1, longestStreak: 1, lastActiveDate: today },
    });
    await prisma.lmsActivityLog.create({
      data: { userId: user.id, activityType: 'login', details: { date: today.toISOString(), first_login: true }, xpEarned: 15 },
    });
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <Header userName={user.name || ''} isAdmin={user.role === 'admin'} />
      <main className="max-w-lg mx-auto px-4 pb-24 pt-4">
        {children}
      </main>
      <BottomNav />
    </div>
  );
}
