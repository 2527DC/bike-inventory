'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import {
  ArrowLeft, Plus, Trash2, X, ChevronDown, ChevronRight,
  GraduationCap, BookOpen, HelpCircle, PlayCircle, Edit2, Save,
} from 'lucide-react';
import { extractYoutubeId } from '@/lib/utils';
import { apiFetch } from '@/lib/api';
import { ErrorToast } from '@/components/error-toast';

export default function AdminCoursesPage() {
  const [courses, setCourses] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Forms
  const [showCourseForm, setShowCourseForm] = useState(false);
  const [showLevelForm, setShowLevelForm] = useState<string | null>(null);
  const [showModuleForm, setShowModuleForm] = useState<string | null>(null);
  const [showQuestionForm, setShowQuestionForm] = useState<string | null>(null);
  const [editingModule, setEditingModule] = useState<string | null>(null);

  // Course form
  const [courseTitle, setCourseTitle] = useState('');
  const [courseDesc, setCourseDesc] = useState('');

  // Level form
  const [levelTitle, setLevelTitle] = useState('');
  const [levelDesc, setLevelDesc] = useState('');
  const [levelWeek, setLevelWeek] = useState('');
  const [levelBrand, setLevelBrand] = useState('');

  // Module form
  const [modTitle, setModTitle] = useState('');
  const [modDesc, setModDesc] = useState('');
  const [modYoutube, setModYoutube] = useState('');
  const [modPointers, setModPointers] = useState('');
  const [modChecklist, setModChecklist] = useState('');
  const [modXp, setModXp] = useState('30');

  // Question form
  const [qText, setQText] = useState('');
  const [qOpts, setQOpts] = useState(['', '', '', '']);
  const [qCorrect, setQCorrect] = useState(0);
  const [qExplanation, setQExplanation] = useState('');

  // Expanded state
  const [expandedLevels, setExpandedLevels] = useState<Set<string>>(new Set());
  const [expandedModules, setExpandedModules] = useState<Set<string>>(new Set());

  useEffect(() => { load(); }, []);

  async function load() {
    try {
      const res = await apiFetch('/api/staff-lms/courses');
      const data = await res.json();
      setCourses(data);
    } catch (e: any) {
      setError(e.message);
    }
    setLoading(false);
  }

  function toggleExpand(set: Set<string>, id: string, setter: (s: Set<string>) => void) {
    const next = new Set(set);
    if (next.has(id)) next.delete(id); else next.add(id);
    setter(next);
  }

  async function createCourse() {
    setSaving(true);
    try {
      await apiFetch('/api/staff-lms/courses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'course', title: courseTitle, description: courseDesc }),
      });
      setCourseTitle(''); setCourseDesc(''); setShowCourseForm(false);
      load();
    } catch (e: any) { setError(e.message); }
    setSaving(false);
  }

  async function createLevel(courseId: string) {
    setSaving(true);
    try {
      await apiFetch('/api/staff-lms/courses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'level', course_id: courseId, title: levelTitle,
          description: levelDesc || null, week_number: levelWeek ? parseInt(levelWeek) : null,
          brand_focus: levelBrand || null,
        }),
      });
      setLevelTitle(''); setLevelDesc(''); setLevelWeek(''); setLevelBrand('');
      setShowLevelForm(null);
      load();
    } catch (e: any) { setError(e.message); }
    setSaving(false);
  }

  async function createModule(levelId: string) {
    setSaving(true);
    try {
      const pointers = modPointers.split('\n').filter(Boolean);
      const checklist = modChecklist.split('\n').filter(Boolean);
      await apiFetch('/api/staff-lms/courses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'module', level_id: levelId, title: modTitle,
          description: modDesc || null, youtube_url: modYoutube || null,
          key_pointers: pointers, checklist,
          xp_reward: parseInt(modXp) || 30,
        }),
      });
      setModTitle(''); setModDesc(''); setModYoutube(''); setModPointers('');
      setModChecklist(''); setModXp('30'); setShowModuleForm(null);
      load();
    } catch (e: any) { setError(e.message); }
    setSaving(false);
  }

  async function saveModuleEdit(mod: any) {
    setSaving(true);
    try {
      await apiFetch('/api/staff-lms/courses', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'module', id: mod.id, title: modTitle,
          description: modDesc || null, youtube_url: modYoutube || null,
          key_pointers: modPointers.split('\n').filter(Boolean),
          checklist: modChecklist.split('\n').filter(Boolean),
          xp_reward: parseInt(modXp) || 30,
        }),
      });
      setEditingModule(null);
      load();
    } catch (e: any) { setError(e.message); }
    setSaving(false);
  }

  function startEditModule(mod: any) {
    setEditingModule(mod.id);
    setModTitle(mod.title);
    setModDesc(mod.description || '');
    setModYoutube(mod.youtube_url || '');
    setModPointers((mod.key_pointers || []).join('\n'));
    setModChecklist((mod.checklist || []).join('\n'));
    setModXp(String(mod.xp_reward || 30));
  }

  async function addQuestion(moduleId: string) {
    setSaving(true);
    try {
      await apiFetch('/api/staff-lms/courses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'question', module_id: moduleId, question: qText,
          options: qOpts, correct_index: qCorrect, explanation: qExplanation || null,
        }),
      });
      setQText(''); setQOpts(['', '', '', '']); setQCorrect(0); setQExplanation('');
      setShowQuestionForm(null);
      load();
    } catch (e: any) { setError(e.message); }
    setSaving(false);
  }

  async function deleteItem(type: string, id: string) {
    if (!confirm(`Delete this ${type}?`)) return;
    try {
      await apiFetch('/api/staff-lms/courses', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, id }),
      });
      load();
    } catch (e: any) { setError(e.message); }
  }

  const ytPreview = modYoutube ? extractYoutubeId(modYoutube) : null;

  if (loading) return <div className="text-center py-16 text-gray-400">Loading...</div>;

  return (
    <div className="space-y-4">
      <ErrorToast message={error} onClose={() => setError(null)} />

      <div className="flex items-center justify-between">
        <Link href="/admin" className="inline-flex items-center gap-1 text-sm text-gray-500">
          <ArrowLeft size={16} /> Admin
        </Link>
        <button
          onClick={() => setShowCourseForm(true)}
          className="flex items-center gap-1 px-4 py-2 bg-blue-600 text-white rounded-xl text-sm font-medium"
        >
          <Plus size={16} /> New Course
        </button>
      </div>

      {/* Create course form */}
      {showCourseForm && (
        <div className="bg-white rounded-2xl p-4 shadow-sm space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="font-bold text-sm text-gray-900">New Course</h3>
            <button onClick={() => setShowCourseForm(false)} className="text-gray-400"><X size={18} /></button>
          </div>
          <input placeholder="Course Title" value={courseTitle} onChange={(e) => setCourseTitle(e.target.value)} className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-200" />
          <input placeholder="Description" value={courseDesc} onChange={(e) => setCourseDesc(e.target.value)} className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-200" />
          <button onClick={createCourse} disabled={!courseTitle || saving} className="w-full py-2.5 bg-blue-600 text-white rounded-xl text-sm font-medium disabled:opacity-50">
            {saving ? 'Creating...' : 'Create Course'}
          </button>
        </div>
      )}

      {courses.length === 0 && !showCourseForm && (
        <div className="text-center py-16">
          <GraduationCap size={48} className="mx-auto text-gray-300 mb-4" />
          <p className="text-gray-500">No courses yet. Create one to get started.</p>
        </div>
      )}

      {/* Courses */}
      {courses.map((course) => (
        <div key={course.id} className="space-y-3">
          <div className="bg-gradient-to-r from-blue-600 to-indigo-700 rounded-2xl p-4 text-white">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-medium opacity-70 uppercase tracking-wide">Course</p>
                <h2 className="text-lg font-bold">{course.title}</h2>
                {course.description && <p className="text-sm opacity-80">{course.description}</p>}
              </div>
              <div className="flex items-center gap-2">
                <button onClick={() => setShowLevelForm(course.id)} className="bg-white/20 p-2 rounded-xl"><Plus size={16} /></button>
                <button onClick={() => deleteItem('course', course.id)} className="bg-white/20 p-2 rounded-xl"><Trash2 size={16} /></button>
              </div>
            </div>
          </div>

          {/* Add Level form */}
          {showLevelForm === course.id && (
            <div className="bg-white rounded-2xl p-4 shadow-sm space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="font-bold text-sm text-gray-900">New Level</h3>
                <button onClick={() => setShowLevelForm(null)} className="text-gray-400"><X size={18} /></button>
              </div>
              <input placeholder="Level Title (e.g., Foundation)" value={levelTitle} onChange={(e) => setLevelTitle(e.target.value)} className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-200" />
              <input placeholder="Description" value={levelDesc} onChange={(e) => setLevelDesc(e.target.value)} className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-200" />
              <div className="grid grid-cols-2 gap-2">
                <input placeholder="Week # (e.g., 1)" type="number" value={levelWeek} onChange={(e) => setLevelWeek(e.target.value)} className="px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-200" />
                <input placeholder="Brand focus" value={levelBrand} onChange={(e) => setLevelBrand(e.target.value)} className="px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-200" />
              </div>
              <button onClick={() => createLevel(course.id)} disabled={!levelTitle || saving} className="w-full py-2.5 bg-blue-600 text-white rounded-xl text-sm font-medium disabled:opacity-50">
                {saving ? 'Creating...' : 'Add Level'}
              </button>
            </div>
          )}

          {/* Levels */}
          {course.levels.map((level: any, li: number) => {
            const isExpanded = expandedLevels.has(level.id);
            return (
              <div key={level.id} className="bg-white rounded-2xl shadow-sm overflow-hidden">
                <button
                  onClick={() => toggleExpand(expandedLevels, level.id, setExpandedLevels)}
                  className="w-full flex items-center justify-between p-4 text-left"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center text-sm font-bold">
                      {li + 1}
                    </div>
                    <div>
                      <h3 className="font-semibold text-sm text-gray-900">{level.title}</h3>
                      <p className="text-xs text-gray-400">
                        {level.modules.length} modules
                        {level.week_number ? ` · Week ${level.week_number}` : ''}
                        {level.brand_focus ? ` · ${level.brand_focus}` : ''}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button onClick={(e) => { e.stopPropagation(); deleteItem('level', level.id); }} className="text-red-400 p-1"><Trash2 size={14} /></button>
                    {isExpanded ? <ChevronDown size={18} className="text-gray-400" /> : <ChevronRight size={18} className="text-gray-400" />}
                  </div>
                </button>

                {isExpanded && (
                  <div className="border-t border-gray-50 p-4 space-y-3">
                    {/* Modules in this level */}
                    {level.modules.map((mod: any) => {
                      const modExpanded = expandedModules.has(mod.id);
                      const isEditing = editingModule === mod.id;

                      return (
                        <div key={mod.id} className="border border-gray-100 rounded-xl overflow-hidden">
                          <button
                            onClick={() => toggleExpand(expandedModules, mod.id, setExpandedModules)}
                            className="w-full flex items-center justify-between p-3 text-left bg-gray-50"
                          >
                            <div className="flex items-center gap-2">
                              <BookOpen size={14} className="text-blue-500" />
                              <span className="text-sm font-medium text-gray-800">{mod.title}</span>
                            </div>
                            <div className="flex items-center gap-2 text-xs text-gray-400">
                              {mod.has_video && <PlayCircle size={12} />}
                              <span>{mod.question_count}Q</span>
                              {modExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                            </div>
                          </button>

                          {modExpanded && (
                            <div className="p-3 space-y-2">
                              {isEditing ? (
                                <div className="space-y-2">
                                  <input placeholder="Title" value={modTitle} onChange={(e) => setModTitle(e.target.value)} className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-200" />
                                  <input placeholder="Description" value={modDesc} onChange={(e) => setModDesc(e.target.value)} className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-200" />
                                  <input placeholder="YouTube URL" value={modYoutube} onChange={(e) => setModYoutube(e.target.value)} className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-200" />
                                  {ytPreview && <img src={`https://img.youtube.com/vi/${ytPreview}/mqdefault.jpg`} alt="Preview" className="w-full rounded-lg" />}
                                  <textarea placeholder="Key pointers (one per line)" value={modPointers} onChange={(e) => setModPointers(e.target.value)} rows={4} className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-200" />
                                  <textarea placeholder="Checklist items (one per line)" value={modChecklist} onChange={(e) => setModChecklist(e.target.value)} rows={4} className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-200" />
                                  <input placeholder="XP reward" type="number" value={modXp} onChange={(e) => setModXp(e.target.value)} className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-200" />
                                  <div className="flex gap-2">
                                    <button onClick={() => saveModuleEdit(mod)} disabled={saving} className="flex-1 py-2 bg-green-600 text-white rounded-lg text-sm font-medium disabled:opacity-50 flex items-center justify-center gap-1"><Save size={14} /> Save</button>
                                    <button onClick={() => setEditingModule(null)} className="flex-1 py-2 bg-gray-100 text-gray-600 rounded-lg text-sm font-medium">Cancel</button>
                                  </div>
                                </div>
                              ) : (
                                <>
                                  {mod.description && <p className="text-xs text-gray-500">{mod.description}</p>}
                                  {mod.youtube_url && <p className="text-xs text-blue-500">Video: {mod.youtube_url}</p>}
                                  {(mod.key_pointers as any[])?.length > 0 && (
                                    <div className="text-xs text-gray-500">
                                      <p className="font-medium">Key Pointers:</p>
                                      <ul className="list-disc ml-4">
                                        {(mod.key_pointers as string[]).map((p: string, i: number) => <li key={i}>{p}</li>)}
                                      </ul>
                                    </div>
                                  )}
                                  {(mod.checklist as any[])?.length > 0 && (
                                    <div className="text-xs text-gray-500">
                                      <p className="font-medium">Checklist:</p>
                                      <ul className="list-disc ml-4">
                                        {(mod.checklist as string[]).map((c: string, i: number) => <li key={i}>{c}</li>)}
                                      </ul>
                                    </div>
                                  )}
                                  <div className="flex gap-2 mt-2">
                                    <button onClick={() => startEditModule(mod)} className="text-xs text-blue-600 flex items-center gap-1"><Edit2 size={12} /> Edit</button>
                                    <button onClick={() => setShowQuestionForm(mod.id)} className="text-xs text-purple-600 flex items-center gap-1"><Plus size={12} /> Question</button>
                                    <button onClick={() => deleteItem('module', mod.id)} className="text-xs text-red-500 flex items-center gap-1"><Trash2 size={12} /> Delete</button>
                                  </div>
                                </>
                              )}

                              {/* Questions list */}
                              {mod.question_count > 0 && !isEditing && (
                                <div className="mt-2 text-xs text-gray-400">
                                  <p className="font-medium flex items-center gap-1"><HelpCircle size={12} /> {mod.question_count} quiz questions</p>
                                </div>
                              )}

                              {/* Add question form */}
                              {showQuestionForm === mod.id && (
                                <div className="border border-purple-100 rounded-lg p-3 space-y-2 bg-purple-50/50">
                                  <div className="flex items-center justify-between">
                                    <h4 className="text-xs font-bold text-purple-700">Add Question</h4>
                                    <button onClick={() => setShowQuestionForm(null)} className="text-gray-400"><X size={14} /></button>
                                  </div>
                                  <textarea placeholder="Question" value={qText} onChange={(e) => setQText(e.target.value)} rows={2} className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-purple-200" />
                                  {qOpts.map((opt, i) => (
                                    <div key={i} className="flex items-center gap-2">
                                      <button
                                        onClick={() => setQCorrect(i)}
                                        className={`w-6 h-6 rounded-full border-2 flex items-center justify-center text-xs flex-shrink-0 ${qCorrect === i ? 'border-green-500 bg-green-500 text-white' : 'border-gray-300'}`}
                                      >
                                        {qCorrect === i ? '✓' : ''}
                                      </button>
                                      <input
                                        placeholder={`Option ${i + 1}`}
                                        value={opt}
                                        onChange={(e) => { const u = [...qOpts]; u[i] = e.target.value; setQOpts(u); }}
                                        className="flex-1 px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-purple-200"
                                      />
                                    </div>
                                  ))}
                                  <input placeholder="Explanation (optional)" value={qExplanation} onChange={(e) => setQExplanation(e.target.value)} className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-purple-200" />
                                  <button
                                    onClick={() => addQuestion(mod.id)}
                                    disabled={!qText || qOpts.some((o) => !o) || saving}
                                    className="w-full py-2 bg-purple-600 text-white rounded-lg text-sm font-medium disabled:opacity-50"
                                  >
                                    {saving ? 'Adding...' : 'Add Question'}
                                  </button>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}

                    {/* Add module button */}
                    <button
                      onClick={() => {
                        setModTitle(''); setModDesc(''); setModYoutube('');
                        setModPointers(''); setModChecklist(''); setModXp('30');
                        setShowModuleForm(level.id);
                      }}
                      className="w-full py-2.5 border-2 border-dashed border-gray-200 rounded-xl text-sm text-gray-400 flex items-center justify-center gap-1 hover:border-blue-300 hover:text-blue-500"
                    >
                      <Plus size={14} /> Add Module
                    </button>

                    {/* Add module form */}
                    {showModuleForm === level.id && (
                      <div className="bg-blue-50/50 border border-blue-100 rounded-xl p-4 space-y-3">
                        <div className="flex items-center justify-between">
                          <h3 className="font-bold text-sm text-blue-800">New Module</h3>
                          <button onClick={() => setShowModuleForm(null)} className="text-gray-400"><X size={18} /></button>
                        </div>
                        <input placeholder="Module Title" value={modTitle} onChange={(e) => setModTitle(e.target.value)} className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-200" />
                        <input placeholder="Description" value={modDesc} onChange={(e) => setModDesc(e.target.value)} className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-200" />
                        <input placeholder="YouTube URL" value={modYoutube} onChange={(e) => setModYoutube(e.target.value)} className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-200" />
                        {ytPreview && <img src={`https://img.youtube.com/vi/${ytPreview}/mqdefault.jpg`} alt="Preview" className="w-full rounded-xl" />}
                        <textarea placeholder="Key pointers (one per line)" value={modPointers} onChange={(e) => setModPointers(e.target.value)} rows={4} className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-200" />
                        <textarea placeholder="Self-check items (one per line)" value={modChecklist} onChange={(e) => setModChecklist(e.target.value)} rows={4} className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-200" />
                        <input placeholder="XP Reward" type="number" value={modXp} onChange={(e) => setModXp(e.target.value)} className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-200" />
                        <button onClick={() => createModule(level.id)} disabled={!modTitle || saving} className="w-full py-2.5 bg-blue-600 text-white rounded-xl text-sm font-medium disabled:opacity-50">
                          {saving ? 'Creating...' : 'Add Module'}
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
