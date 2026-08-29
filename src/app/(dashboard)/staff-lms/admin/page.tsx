import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { getLevelTitle } from '@/lib/xp';
import Link from 'next/link';
import { Package, Video, BookOpen, Users, ChevronRight, BarChart3, Megaphone, Lightbulb, Settings, HelpCircle, Search, GraduationCap } from 'lucide-react';

export default async function AdminPage() {
  const user = await getCurrentUser();
  if (!user || user.role !== 'admin') redirect('/');

  const [userCount, productCount, videoCount, quizCount, teamProgress] = await Promise.all([
    prisma.user.count({ where: { isActive: true } }),
    prisma.lmsProduct.count({ where: { isActive: true } }),
    prisma.lmsVideo.count({ where: { isActive: true } }),
    prisma.lmsQuiz.count({ where: { isActive: true } }),
    prisma.lmsProgress.findMany({
      include: { user: { select: { name: true } } },
      orderBy: { xp: 'desc' },
    }),
  ]);

  const links = [
    { href: '/staff-lms/admin/courses', icon: GraduationCap, label: 'Training Modules', desc: 'Course, levels & modules', color: 'bg-indigo-500' },
    { href: '/staff-lms/admin/products', icon: Package, label: 'Manage Products', desc: `${productCount} products`, color: 'bg-blue-500' },
    { href: '/staff-lms/admin/videos', icon: Video, label: 'Manage Videos', desc: `${videoCount} videos`, color: 'bg-purple-500' },
    { href: '/staff-lms/admin/scenarios', icon: BookOpen, label: 'Manage Scenarios', desc: 'Win-a-client playbooks', color: 'bg-green-500' },
    { href: '/staff-lms/admin/team', icon: Users, label: 'Manage Team', desc: `${userCount} members`, color: 'bg-orange-500' },
    { href: '/staff-lms/admin/dashboard', icon: BarChart3, label: 'Performance Dashboard', desc: 'Team analytics', color: 'bg-teal-500' },
    { href: '/staff-lms/admin/announcements', icon: Megaphone, label: 'Announcements', desc: 'Post updates to team', color: 'bg-red-500' },
    { href: '/staff-lms/admin/tips', icon: Lightbulb, label: 'Daily Tips', desc: 'Manage tip of the day', color: 'bg-amber-500' },
    { href: '/staff-lms/admin/research', icon: Search, label: 'Product Research', desc: 'Add URLs, find videos', color: 'bg-cyan-600' },
    { href: '/staff-lms/admin/settings', icon: Settings, label: 'Settings', desc: 'Brands, categories & more', color: 'bg-gray-600' },
  ];

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3">
        {[
          { label: 'Employees', value: userCount },
          { label: 'Products', value: productCount },
          { label: 'Videos', value: videoCount },
          { label: 'Quizzes', value: quizCount },
        ].map(({ label, value }) => (
          <div key={label} className="bg-white rounded-2xl p-4 shadow-sm text-center">
            <p className="text-2xl font-bold text-gray-900">{value}</p>
            <p className="text-xs text-gray-500">{label}</p>
          </div>
        ))}
      </div>

      <div className="space-y-2">
        {links.map(({ href, icon: Icon, label, desc, color }) => (
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

      <div>
        <h3 className="font-bold text-gray-900 flex items-center gap-2 mb-3"><BarChart3 size={18} /> Team Performance</h3>
        <div className="bg-white rounded-2xl shadow-sm divide-y divide-gray-50">
          {teamProgress.map((member) => {
            const daysAgo = Math.floor((Date.now() - new Date(member.lastActiveDate).getTime()) / 86400000);
            return (
              <div key={member.userId} className="flex items-center gap-3 px-4 py-3">
                <div className="w-8 h-8 bg-gray-200 rounded-full flex items-center justify-center text-xs font-bold text-gray-600">
                  {member.user.name.charAt(0)}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-900 truncate">{member.user.name}</p>
                  <p className="text-[10px] text-gray-400">Lvl {member.level} · {getLevelTitle(member.level)} · 🔥 {member.streakDays}d</p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-bold text-blue-600">{member.xp} XP</p>
                  <p className="text-[10px] text-gray-400">{daysAgo === 0 ? 'Today' : `${daysAgo}d ago`}</p>
                </div>
              </div>
            );
          })}
          {teamProgress.length === 0 && <p className="px-4 py-6 text-center text-gray-400 text-sm">No team activity yet.</p>}
        </div>
      </div>
    </div>
  );
}
