'use client';

import { useEffect } from 'react';
import { AlertCircle, X } from 'lucide-react';

export function ErrorToast({ message, onClose }: { message: string | null; onClose: () => void }) {
  useEffect(() => {
    if (message) {
      const t = setTimeout(onClose, 6000);
      return () => clearTimeout(t);
    }
  }, [message, onClose]);

  if (!message) return null;

  return (
    <div className="fixed bottom-20 left-4 right-4 max-w-lg mx-auto z-50 animate-in slide-in-from-bottom-4">
      <div className="bg-red-600 text-white rounded-2xl px-4 py-3 shadow-lg flex items-center gap-3">
        <AlertCircle size={18} className="flex-shrink-0" />
        <p className="text-sm flex-1">{message}</p>
        <button onClick={onClose} className="p-1 hover:bg-red-500 rounded-full">
          <X size={14} />
        </button>
      </div>
    </div>
  );
}
