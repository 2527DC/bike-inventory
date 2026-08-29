'use client';

import { useRouter } from 'next/navigation';
import { LogOut } from 'lucide-react';

export function LogoutButton() {
  const router = useRouter();

  async function handleLogout() {
    await fetch('/api/staff-lms/auth/logout', { method: 'POST' });
    router.push('/login');
    router.refresh();
  }

  return (
    <button
      onClick={handleLogout}
      className="w-full py-3 flex items-center justify-center gap-2 text-red-500 text-sm font-medium bg-red-50 rounded-xl"
    >
      <LogOut size={16} /> Logout
    </button>
  );
}
