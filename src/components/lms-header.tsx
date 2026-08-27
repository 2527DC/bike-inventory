'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { User, Settings } from 'lucide-react';

export function LmsHeader({ userName, isAdmin }: { userName: string; isAdmin: boolean }) {
  const pathname = usePathname();

  const titles: Record<string, string> = {
    '/': 'BCH Training',
    '/products': 'Product Academy',
    '/playbooks': 'Win-a-Client',
    '/practice': 'AI Practice',
    '/videos': 'Video Training',
    '/quizzes': 'Quizzes',
    '/leaderboard': 'Leaderboard',
    '/profile': 'My Profile',
    '/admin/research': 'Product Research',
    '/admin/dashboard': 'Performance Dashboard',
    '/admin': 'Admin Panel',
    '/compare': 'Compare Products',
    '/flashcards': 'Objection Flashcards',
    '/showroom': 'Showroom',
  };

  const title = Object.entries(titles).find(([path]) =>
    path === '/' ? pathname === '/' : pathname.startsWith(path)
  )?.[1] || 'BCH Training';

  return (
    <header className="sticky top-0 z-40 bg-white/90 backdrop-blur-sm border-b border-gray-100">
      <div className="flex items-center justify-between h-14 px-4 max-w-lg mx-auto">
        <h1 className="text-lg font-bold text-gray-900">{title}</h1>
        <div className="flex items-center gap-2">
          {isAdmin && (
            <Link
              href="/staff-lms/admin"
              className="p-2 rounded-full hover:bg-gray-100 text-gray-500"
            >
              <Settings size={20} />
            </Link>
          )}
          <Link
            href="/staff-lms/profile"
            className="p-2 rounded-full hover:bg-gray-100 text-gray-500"
          >
            <User size={20} />
          </Link>
        </div>
      </div>
    </header>
  );
}
