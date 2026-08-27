'use client';

import { useState, useEffect } from 'react';
import { ArrowLeft, Plus, X, UserX, Key } from 'lucide-react';
import Link from 'next/link';
import { apiFetch } from '@/lib/api';
import { ErrorToast } from '@/components/error-toast';

export default function AdminTeamPage() {
  const [team, setTeam] = useState<any[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState('');
  const [pin, setPin] = useState('');
  const [role, setRole] = useState('employee');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { load(); }, []);

  async function load() {
    try {
      const res = await apiFetch('/api/staff-lms/admin/team');
      const data = await res.json();
      setTeam(data.team || []);
    } catch (e: any) {
      setError(e.message);
    }
  }

  async function addUser() {
    setSaving(true);
    try {
      await apiFetch('/api/staff-lms/admin/team', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, pin, role }),
      });
      setName(''); setPin(''); setRole('employee'); setShowForm(false);
      load();
    } catch (e: any) {
      setError(e.message);
    }
    setSaving(false);
  }

  async function toggleActive(id: string, isActive: boolean) {
    if (!confirm(isActive ? 'Deactivate this user?' : 'Reactivate this user?')) return;
    try {
      await apiFetch('/api/staff-lms/admin/team', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, is_active: !isActive }),
      });
      load();
    } catch (e: any) {
      setError(e.message);
    }
  }

  async function resetPin(id: string) {
    const newPin = prompt('Enter new 4-digit PIN:');
    if (!newPin || newPin.length !== 4) return;
    try {
      await apiFetch('/api/staff-lms/admin/team', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, pin: newPin }),
      });
      alert('PIN updated.');
    } catch (e: any) {
      setError(e.message);
    }
  }

  return (
    <div className="space-y-4">
      <ErrorToast message={error} onClose={() => setError(null)} />
      <div className="flex items-center justify-between">
        <Link href="/admin" className="inline-flex items-center gap-1 text-sm text-gray-500">
          <ArrowLeft size={16} /> Admin
        </Link>
        <button onClick={() => setShowForm(true)} className="flex items-center gap-1 px-4 py-2 bg-blue-600 text-white rounded-xl text-sm font-medium">
          <Plus size={16} /> Add Employee
        </button>
      </div>

      {showForm && (
        <div className="bg-white rounded-2xl p-5 shadow-sm space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="font-bold text-sm text-gray-900">New Employee</h3>
            <button onClick={() => setShowForm(false)} className="text-gray-400"><X size={18} /></button>
          </div>
          <input placeholder="Full Name" value={name} onChange={(e) => setName(e.target.value)} className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-200" />
          <input placeholder="4-digit PIN" value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 4))} maxLength={4} className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-200" />
          <select value={role} onChange={(e) => setRole(e.target.value)} className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm">
            <option value="employee">Employee</option>
            <option value="admin">Admin</option>
          </select>
          <button onClick={addUser} disabled={!name || pin.length !== 4 || saving} className="w-full py-3 bg-blue-600 text-white rounded-xl font-medium text-sm disabled:opacity-50">
            {saving ? 'Adding...' : 'Add Employee'}
          </button>
        </div>
      )}

      <div className="space-y-2">
        {team.map((member) => (
          <div key={member.id} className={`bg-white rounded-xl p-4 shadow-sm ${!member.is_active ? 'opacity-50' : ''}`}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-gray-200 rounded-full flex items-center justify-center text-sm font-bold text-gray-600">
                  {member.name.charAt(0)}
                </div>
                <div>
                  <p className="font-medium text-sm text-gray-900">
                    {member.name}
                    {member.role === 'admin' && <span className="ml-1 text-[10px] bg-blue-100 text-blue-600 px-1.5 py-0.5 rounded-full">Admin</span>}
                    {!member.is_active && <span className="ml-1 text-[10px] bg-red-100 text-red-600 px-1.5 py-0.5 rounded-full">Inactive</span>}
                  </p>
                  <p className="text-xs text-gray-500">
                    Lvl {member.progress?.level || 1} · {member.progress?.xp || 0} XP · {member.progress?.streak_days || 0}d streak
                  </p>
                  <p className="text-[10px] text-gray-400">
                    Last active: {member.progress?.last_active_date
                      ? new Date(member.progress.last_active_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
                      : 'Never'}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-1">
                <button onClick={() => resetPin(member.id)} className="p-2 text-gray-400 hover:text-blue-500" title="Reset PIN">
                  <Key size={14} />
                </button>
                <button onClick={() => toggleActive(member.id, member.is_active)} className="p-2 text-gray-400 hover:text-red-500" title={member.is_active ? 'Deactivate' : 'Activate'}>
                  <UserX size={14} />
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
