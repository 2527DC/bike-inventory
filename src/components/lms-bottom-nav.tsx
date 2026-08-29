'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Home, Package, BookOpen, Play, Trophy, GraduationCap } from 'lucide-react';
import { cn } from '@/lib/utils';

const NAV_ITEMS = [
  { href: '/staff-lms', icon: Home, label: 'Home' },
  { href: '/staff-lms/learn', icon: GraduationCap, label: 'Learn' },
  { href: '/staff-lms/products', icon: Package, label: 'Products' },
  { href: '/staff-lms/practice', icon: Play, label: 'Practice' },
  { href: '/staff-lms/leaderboard', icon: Trophy, label: 'Ranks' },
];

export function LmsBottomNav() {
  const pathname = usePathname();

  return (
    <nav className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 safe-bottom z-50">
      <div className="flex justify-around items-center h-16 max-w-lg mx-auto">
        {NAV_ITEMS.map(({ href, icon: Icon, label }) => {
          const active = href === '/staff-lms' ? pathname === '/staff-lms' : pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                'flex flex-col items-center justify-center gap-0.5 px-3 py-1 rounded-lg transition-colors',
                active ? 'text-blue-600' : 'text-gray-400'
              )}
            >
              <Icon size={22} strokeWidth={active ? 2.5 : 1.5} />
              <span className="text-[10px] font-medium">{label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
