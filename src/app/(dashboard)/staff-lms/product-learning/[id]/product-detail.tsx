'use client';

import { useState, useCallback } from 'react';
import { ArrowLeft, Star, Target, MessageSquare, ShieldAlert, ChevronDown, Check, Heart, Brain, Users, AlertTriangle, Sparkles, Eye, Zap, BookOpen, Lightbulb, Trophy, ThumbsDown, ExternalLink, Swords, Info, Award, Edit2, Plus, Trash2, CheckCircle, HelpCircle, Play } from 'lucide-react';
import Link from 'next/link';
import type { LmsProduct as Product, ProductFaq } from '@/types/lms';

const TABS = [
  { key: 'sell', label: 'How to Sell', icon: MessageSquare },
  { key: 'specs', label: 'Specs', icon: BookOpen },
  { key: 'psychology', label: 'Buyer Mind', icon: Brain },
  { key: 'compete', label: 'Compare', icon: Swords },
  { key: 'reviews', label: 'Reviews', icon: Star },
  { key: 'videos', label: 'Videos', icon: Play },
  { key: 'faq', label: 'FAQ', icon: HelpCircle },
] as const;

type TabKey = typeof TABS[number]['key'];

interface ProductVideo {
  id: string;
  title: string;
  description: string | null;
  youtube_url: string;
}

interface Props {
  product: Product;
  isAdmin?: boolean;
  videos?: ProductVideo[];
}

// --- Edit mode helpers ---

function EditWrapper({ editing, onSave, onCancel, saving, saved, error, children }: {
  editing: boolean; onSave: () => void; onCancel: () => void; saving: boolean; saved: boolean; error?: string | null; children: React.ReactNode;
}) {
  if (!editing) return null;
  return (
    <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-3 mt-2 space-y-3">
      {children}
      <div className="flex items-center gap-2 pt-1 flex-wrap">
        <button onClick={onSave} disabled={saving} className="px-4 py-1.5 bg-blue-600 text-white text-xs font-semibold rounded-xl disabled:opacity-50">
          {saving ? 'Saving...' : 'Save'}
        </button>
        <button onClick={onCancel} className="px-4 py-1.5 bg-gray-200 text-gray-700 text-xs font-semibold rounded-xl">Cancel</button>
        {saved && <CheckCircle size={16} className="text-green-500" />}
        {error && <p className="text-xs text-red-600 font-medium w-full">{error}</p>}
      </div>
    </div>
  );
}

function EditButton({ onClick }: { onClick: () => void }) {
  return (
    <button onClick={onClick} className="ml-1.5 p-0.5 text-gray-400 hover:text-blue-600 transition-colors">
      <Edit2 size={13} />
    </button>
  );
}

function AddButton({ onClick, label }: { onClick: () => void; label?: string }) {
  return (
    <button onClick={onClick} className="flex items-center gap-1 text-xs text-blue-600 font-medium mt-1">
      <Plus size={13} /> {label || 'Add'}
    </button>
  );
}

function RemoveButton({ onClick }: { onClick: () => void }) {
  return (
    <button onClick={onClick} className="p-0.5 text-red-400 hover:text-red-600 flex-shrink-0">
      <Trash2 size={13} />
    </button>
  );
}

// --- Hook for section editing ---

function useSectionEdit<T>(initial: T, productId: string, fieldName: string) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<T>(initial);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const startEdit = useCallback(() => {
    setDraft(initial);
    setEditing(true);
    setSaved(false);
    setError(null);
  }, [initial]);

  const cancel = useCallback(() => {
    setEditing(false);
    setSaved(false);
    setError(null);
  }, []);

  const save = useCallback(async (value?: T) => {
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      const body: Record<string, unknown> = { id: productId };
      body[fieldName] = value ?? draft;
      const res = await fetch('/api/staff-lms/products', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || `Save failed (${res.status})`);
        setSaving(false);
        return;
      }
      setSaved(true);
      setTimeout(() => {
        setEditing(false);
        window.location.reload();
      }, 600);
    } catch {
      setError('Network error — check your connection');
    }
    setSaving(false);
  }, [productId, fieldName, draft]);

  return { editing, draft, setDraft, saving, saved, error, startEdit, cancel, save };
}

function extractYouTubeId(url: string): string | null {
  const m = url.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|shorts\/))([a-zA-Z0-9_-]{11})/);
  return m ? m[1] : null;
}

export function ProductDetail({ product, isAdmin = false, videos = [] }: Props) {
  const [learned, setLearned] = useState(false);
  const [expandedObj, setExpandedObj] = useState<number | null>(null);
  const [activeTab, setActiveTab] = useState<TabKey>('sell');
  const [expandedPsych, setExpandedPsych] = useState<string | null>('dream');
  const [expandedFaq, setExpandedFaq] = useState<number | null>(null);

  const bp = product.buyer_psychology;
  const specs = product.specs || {};
  const competitors = product.competitors || [];
  const reviews = product.reviews || { best: [], worst: [] };
  const sources = product.sources || [];
  const faqs = product.faqs || [];

  // Edit hooks
  const uspsEdit = useSectionEdit(product.usps, product.id, 'usps');
  const tpEdit = useSectionEdit(product.talking_points, product.id, 'talking_points');
  const specsEdit = useSectionEdit(specs, product.id, 'specs');
  const objectionsEdit = useSectionEdit(product.common_objections, product.id, 'common_objections');
  const competitorsEdit = useSectionEdit(competitors, product.id, 'competitors');
  const reviewsEdit = useSectionEdit(reviews, product.id, 'reviews');
  const sourcesEdit = useSectionEdit(sources, product.id, 'sources');
  const uniqueFactEdit = useSectionEdit(product.unique_fact || '', product.id, 'unique_fact');
  const targetCustomerEdit = useSectionEdit(product.target_customer || '', product.id, 'target_customer');
  const featuresEdit = useSectionEdit(product.features, product.id, 'features');
  const faqsEdit = useSectionEdit(faqs, product.id, 'faqs');

  async function markLearned() {
    if (learned) return;
    await fetch('/api/staff-lms/progress', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'product_learned', productId: product.id }),
    });
    setLearned(true);
  }

  return (
    <div className="space-y-4 pb-4">
      <Link href="/products" className="inline-flex items-center gap-1 text-sm text-gray-500">
        <ArrowLeft size={16} /> Back
      </Link>

      {/* Product Header */}
      <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
        {product.image_url && (
          <div className="w-full h-48 bg-gray-50 flex items-center justify-center">
            <img src={product.image_url} alt={product.name} className="h-full object-contain" />
          </div>
        )}
        <div className="p-5">
          <div className="flex items-start justify-between">
            <div>
              <h1 className="text-lg font-bold text-gray-900">{product.name}</h1>
              <p className="text-gray-500 text-sm">{product.brand} · {product.category}</p>
            </div>
            {product.price && (
              <p className="text-lg font-bold text-blue-600">₹{product.price.toLocaleString('en-IN')}</p>
            )}
          </div>

          {/* Unique Fact */}
          {(product.unique_fact || uniqueFactEdit.editing) && (
            <div className="mt-3 flex items-start gap-2 bg-amber-50 rounded-xl p-3 border border-amber-200">
              <Award size={15} className="text-amber-500 mt-0.5 flex-shrink-0" />
              <div className="flex-1">
                <p className="text-[10px] font-bold text-amber-600 uppercase tracking-wider">
                  Did You Know?
                  {isAdmin && !uniqueFactEdit.editing && <EditButton onClick={uniqueFactEdit.startEdit} />}
                </p>
                {!uniqueFactEdit.editing && <p className="text-sm text-amber-800">{product.unique_fact}</p>}
                <EditWrapper editing={uniqueFactEdit.editing} onSave={() => uniqueFactEdit.save()} onCancel={uniqueFactEdit.cancel} saving={uniqueFactEdit.saving} saved={uniqueFactEdit.saved} error={uniqueFactEdit.error}>
                  <textarea value={uniqueFactEdit.draft as string} onChange={e => uniqueFactEdit.setDraft(e.target.value)} className="w-full text-sm border border-gray-300 rounded-lg p-2 min-h-[60px]" />
                </EditWrapper>
              </div>
            </div>
          )}

          {/* Target Customer */}
          {(product.target_customer || targetCustomerEdit.editing) && (
            <div className="mt-2 flex items-start gap-2 bg-blue-50 rounded-xl p-3">
              <Target size={15} className="text-blue-500 mt-0.5 flex-shrink-0" />
              <div className="flex-1">
                {!targetCustomerEdit.editing && (
                  <p className="text-sm text-blue-700">
                    {product.target_customer}
                    {isAdmin && <EditButton onClick={targetCustomerEdit.startEdit} />}
                  </p>
                )}
                <EditWrapper editing={targetCustomerEdit.editing} onSave={() => targetCustomerEdit.save()} onCancel={targetCustomerEdit.cancel} saving={targetCustomerEdit.saving} saved={targetCustomerEdit.saved} error={targetCustomerEdit.error}>
                  <textarea value={targetCustomerEdit.draft as string} onChange={e => targetCustomerEdit.setDraft(e.target.value)} className="w-full text-sm border border-gray-300 rounded-lg p-2 min-h-[60px]" />
                </EditWrapper>
              </div>
            </div>
          )}

          {/* Buyer Persona */}
          {bp && bp.buyerPersona && (
            <div className="mt-2 flex items-start gap-2 bg-purple-50 rounded-xl p-3">
              <Brain size={15} className="text-purple-500 mt-0.5 flex-shrink-0" />
              <div>
                <p className="text-xs font-semibold text-purple-600">Who Buys This</p>
                <p className="text-sm text-purple-800">{bp.buyerPersona}</p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Tab Navigation */}
      <div className="flex gap-0.5 bg-gray-100 rounded-2xl p-1 overflow-x-auto">
        {TABS.map((tab) => {
          const Icon = tab.icon;
          const active = activeTab === tab.key;
          return (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`flex-1 flex items-center justify-center gap-1 py-2.5 rounded-xl text-[11px] font-semibold transition-all whitespace-nowrap min-w-0 ${
                active ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-500'
              }`}
            >
              <Icon size={13} />
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* ===== TAB: How to Sell ===== */}
      {activeTab === 'sell' && (
        <div className="space-y-4">
          {(product.usps.length > 0 || uspsEdit.editing) && (
            <div className="bg-white rounded-2xl p-4 shadow-sm">
              <h2 className="font-bold text-gray-900 flex items-center gap-2 mb-3 text-sm">
                <Star size={16} className="text-yellow-500" /> USPs — Memorize These
                {isAdmin && !uspsEdit.editing && <EditButton onClick={uspsEdit.startEdit} />}
              </h2>
              {!uspsEdit.editing && (
                <div className="space-y-2">
                  {product.usps.map((usp, i) => (
                    <div key={i} className="flex items-start gap-2.5">
                      <span className="w-5 h-5 rounded-full bg-yellow-100 text-yellow-700 text-xs font-bold flex items-center justify-center flex-shrink-0 mt-0.5">{i + 1}</span>
                      <p className="text-sm text-gray-800">{usp}</p>
                    </div>
                  ))}
                </div>
              )}
              <EditWrapper editing={uspsEdit.editing} onSave={() => uspsEdit.save()} onCancel={uspsEdit.cancel} saving={uspsEdit.saving} saved={uspsEdit.saved} error={uspsEdit.error}>
                <StringArrayEditor items={uspsEdit.draft} onChange={uspsEdit.setDraft} />
              </EditWrapper>
            </div>
          )}

          {(product.talking_points.length > 0 || tpEdit.editing) && (
            <div className="bg-white rounded-2xl p-4 shadow-sm">
              <h2 className="font-bold text-gray-900 flex items-center gap-2 mb-3 text-sm">
                <MessageSquare size={16} className="text-blue-500" /> What to Say to Customer
                {isAdmin && !tpEdit.editing && <EditButton onClick={tpEdit.startEdit} />}
              </h2>
              {!tpEdit.editing && (
                <div className="space-y-2">
                  {product.talking_points.map((tp, i) => (
                    <div key={i} className="bg-blue-50 rounded-xl p-3 border-l-3 border-blue-400">
                      <p className="text-sm text-gray-800">&ldquo;{tp}&rdquo;</p>
                    </div>
                  ))}
                </div>
              )}
              <EditWrapper editing={tpEdit.editing} onSave={() => tpEdit.save()} onCancel={tpEdit.cancel} saving={tpEdit.saving} saved={tpEdit.saved} error={tpEdit.error}>
                <StringArrayEditor items={tpEdit.draft} onChange={tpEdit.setDraft} />
              </EditWrapper>
            </div>
          )}

          {bp && bp.hiddenMotivation && (
            <div className="bg-gradient-to-r from-amber-50 to-orange-50 rounded-2xl p-4 shadow-sm border border-amber-200">
              <h2 className="font-bold text-gray-900 flex items-center gap-2 mb-2 text-sm">
                <Lightbulb size={16} className="text-amber-500" /> Secret Insight
              </h2>
              <p className="text-xs text-amber-600 mb-1">What the customer won&apos;t tell you, but is driving their decision:</p>
              <p className="text-sm text-amber-900 font-medium italic">&ldquo;{bp.hiddenMotivation}&rdquo;</p>
            </div>
          )}

          {bp && bp.decisionStyle && (
            <div className="bg-white rounded-2xl p-4 shadow-sm">
              <h2 className="font-bold text-gray-900 flex items-center gap-2 mb-2 text-sm">
                <Zap size={16} className="text-teal-500" /> How to Close This Sale
              </h2>
              <p className="text-sm text-gray-700">{bp.decisionStyle}</p>
            </div>
          )}

          {(product.common_objections?.length > 0 || objectionsEdit.editing) && (
            <div className="bg-white rounded-2xl p-4 shadow-sm">
              <h2 className="font-bold text-gray-900 flex items-center gap-2 mb-3 text-sm">
                <ShieldAlert size={16} className="text-red-500" /> When Customer Says...
                {isAdmin && !objectionsEdit.editing && <EditButton onClick={objectionsEdit.startEdit} />}
              </h2>
              {!objectionsEdit.editing && (
                <div className="space-y-2">
                  {product.common_objections.map((obj, i) => (
                    <button key={i} onClick={() => setExpandedObj(expandedObj === i ? null : i)} className="w-full text-left">
                      <div className={`rounded-xl p-3 transition-colors ${expandedObj === i ? 'bg-red-50 ring-1 ring-red-200' : 'bg-gray-50'}`}>
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-sm font-medium text-red-700 flex-1">&ldquo;{obj.objection}&rdquo;</p>
                          <ChevronDown size={16} className={`text-gray-400 transition-transform flex-shrink-0 ${expandedObj === i ? 'rotate-180' : ''}`} />
                        </div>
                        {expandedObj === i && (
                          <div className="mt-3 pt-3 border-t border-red-100">
                            <p className="text-[10px] font-bold text-green-600 uppercase tracking-wider mb-1">You Say:</p>
                            <p className="text-sm text-gray-700">&ldquo;{obj.response}&rdquo;</p>
                          </div>
                        )}
                      </div>
                    </button>
                  ))}
                </div>
              )}
              <EditWrapper editing={objectionsEdit.editing} onSave={() => objectionsEdit.save()} onCancel={objectionsEdit.cancel} saving={objectionsEdit.saving} saved={objectionsEdit.saved} error={objectionsEdit.error}>
                <ObjectionsEditor items={objectionsEdit.draft} onChange={objectionsEdit.setDraft} />
              </EditWrapper>
            </div>
          )}
        </div>
      )}

      {/* ===== TAB: Specs ===== */}
      {activeTab === 'specs' && (
        <div className="space-y-4">
          {(Object.keys(specs).length > 0 || specsEdit.editing) && (
            <div className="bg-white rounded-2xl p-4 shadow-sm">
              <h2 className="font-bold text-gray-900 mb-3 text-sm">
                Specifications
                {isAdmin && !specsEdit.editing && <EditButton onClick={specsEdit.startEdit} />}
              </h2>
              {!specsEdit.editing && (
                <div className="divide-y divide-gray-100">
                  {Object.entries(specs).map(([key, val]) => (
                    <div key={key} className="flex justify-between py-2.5 text-sm">
                      <span className="text-gray-500 capitalize">{key.replace(/([A-Z])/g, ' $1').trim()}</span>
                      <span className="font-medium text-gray-900 text-right max-w-[55%]">{val as string}</span>
                    </div>
                  ))}
                </div>
              )}
              <EditWrapper editing={specsEdit.editing} onSave={() => specsEdit.save()} onCancel={specsEdit.cancel} saving={specsEdit.saving} saved={specsEdit.saved} error={specsEdit.error}>
                <SpecsEditor specs={specsEdit.draft as Record<string, string>} onChange={specsEdit.setDraft} />
              </EditWrapper>
            </div>
          )}

          {(product.features.length > 0 || featuresEdit.editing) && (
            <div className="bg-white rounded-2xl p-4 shadow-sm">
              <h2 className="font-bold text-gray-900 mb-3 text-sm">
                Key Features
                {isAdmin && !featuresEdit.editing && <EditButton onClick={featuresEdit.startEdit} />}
              </h2>
              {!featuresEdit.editing && (
                <div className="grid grid-cols-2 gap-2">
                  {product.features.map((f, i) => (
                    <div key={i} className="flex items-start gap-2 bg-gray-50 rounded-xl p-2.5">
                      <Check size={13} className="text-green-500 mt-0.5 flex-shrink-0" />
                      <p className="text-xs text-gray-700">{f}</p>
                    </div>
                  ))}
                </div>
              )}
              <EditWrapper editing={featuresEdit.editing} onSave={() => featuresEdit.save()} onCancel={featuresEdit.cancel} saving={featuresEdit.saving} saved={featuresEdit.saved} error={featuresEdit.error}>
                <StringArrayEditor items={featuresEdit.draft} onChange={featuresEdit.setDraft} />
              </EditWrapper>
            </div>
          )}

          <div className="bg-white rounded-2xl p-4 shadow-sm">
            <h2 className="font-bold text-gray-900 mb-3 text-sm">Quick Facts</h2>
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">Brand</span>
                <span className="font-medium text-gray-900">{product.brand}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">Category</span>
                <span className="font-medium text-gray-900">{product.category}</span>
              </div>
              {product.price && (
                <div className="flex justify-between text-sm">
                  <span className="text-gray-500">Price</span>
                  <span className="font-bold text-blue-600">₹{product.price.toLocaleString('en-IN')}</span>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ===== TAB: Buyer Mind ===== */}
      {activeTab === 'psychology' && bp && (
        <div className="space-y-3">
          {bp.dreamOutcome && (
            <div className="bg-gradient-to-br from-purple-600 to-indigo-700 rounded-2xl p-5 shadow-sm">
              <div className="flex items-center gap-2 mb-2">
                <Sparkles size={16} className="text-purple-200" />
                <p className="text-xs font-bold text-purple-200 uppercase tracking-wider">What They Really Want</p>
              </div>
              <p className="text-white font-medium text-sm leading-relaxed">&ldquo;{bp.dreamOutcome}&rdquo;</p>
            </div>
          )}

          <PsychSection id="emotional" title="Emotional Triggers" subtitle="What makes them FEEL like buying" icon={<Heart size={16} className="text-red-500" />} color="red" items={bp.emotionalTriggers} expanded={expandedPsych} onToggle={setExpandedPsych} />
          <PsychSection id="social" title="Social Needs" subtitle="Status, belonging & identity" icon={<Users size={16} className="text-blue-500" />} color="blue" items={bp.socialNeeds} expanded={expandedPsych} onToggle={setExpandedPsych} />
          <PsychSection id="drivers" title="Sales Tactics" subtitle="Psychological techniques that work" icon={<Brain size={16} className="text-green-600" />} color="green" items={bp.psychologicalDrivers} expanded={expandedPsych} onToggle={setExpandedPsych} />
          <PsychSection id="fears" title="Fears & Worries" subtitle="Address these BEFORE they bring them up" icon={<AlertTriangle size={16} className="text-orange-500" />} color="orange" items={bp.fearAndAnxiety} expanded={expandedPsych} onToggle={setExpandedPsych} />

          {bp.hiddenMotivation && (
            <div className="bg-amber-50 rounded-2xl p-4 shadow-sm border border-amber-200">
              <div className="flex items-center gap-2 mb-1">
                <Eye size={14} className="text-amber-600" />
                <p className="text-xs font-bold text-amber-700 uppercase">The Unspoken Truth</p>
              </div>
              <p className="text-sm text-amber-900 italic">&ldquo;{bp.hiddenMotivation}&rdquo;</p>
            </div>
          )}
        </div>
      )}

      {activeTab === 'psychology' && !bp && (
        <div className="bg-white rounded-2xl p-8 shadow-sm text-center">
          <Brain size={32} className="text-gray-300 mx-auto mb-2" />
          <p className="text-sm text-gray-400">Psychology data not available yet.</p>
        </div>
      )}

      {/* ===== TAB: Compare ===== */}
      {activeTab === 'compete' && (
        <div className="space-y-4">
          {isAdmin && !competitorsEdit.editing && (
            <div className="flex justify-end">
              <button onClick={competitorsEdit.startEdit} className="flex items-center gap-1 text-xs text-blue-600 font-medium bg-blue-50 px-3 py-1.5 rounded-xl">
                <Edit2 size={13} /> Edit Competitors
              </button>
            </div>
          )}
          {competitorsEdit.editing && (
            <div className="bg-yellow-50 border border-yellow-200 rounded-2xl p-4 space-y-3">
              <CompetitorsEditor items={competitorsEdit.draft} onChange={competitorsEdit.setDraft} />
              <div className="flex items-center gap-2 pt-1 flex-wrap">
                <button onClick={() => competitorsEdit.save()} disabled={competitorsEdit.saving} className="px-4 py-1.5 bg-blue-600 text-white text-xs font-semibold rounded-xl disabled:opacity-50">
                  {competitorsEdit.saving ? 'Saving...' : 'Save'}
                </button>
                <button onClick={competitorsEdit.cancel} className="px-4 py-1.5 bg-gray-200 text-gray-700 text-xs font-semibold rounded-xl">Cancel</button>
                {competitorsEdit.saved && <CheckCircle size={16} className="text-green-500" />}
                {competitorsEdit.error && <p className="text-xs text-red-600 font-medium w-full">{competitorsEdit.error}</p>}
              </div>
            </div>
          )}
          {!competitorsEdit.editing && competitors.length > 0 ? (
            <>
              <div className="bg-white rounded-2xl p-4 shadow-sm">
                <h2 className="font-bold text-gray-900 flex items-center gap-2 mb-3 text-sm">
                  <Swords size={16} className="text-indigo-500" /> How We Compare
                </h2>
                <div className="overflow-x-auto -mx-2">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-gray-200">
                        <th className="text-left py-2 px-2 text-gray-500 font-medium">Model</th>
                        <th className="text-left py-2 px-2 text-gray-500 font-medium">Brand</th>
                        <th className="text-right py-2 px-2 text-gray-500 font-medium">Price</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr className="bg-blue-50 border-b border-blue-100">
                        <td className="py-2.5 px-2 font-bold text-blue-700">{product.name} ⭐</td>
                        <td className="py-2.5 px-2 text-blue-600">{product.brand}</td>
                        <td className="py-2.5 px-2 text-right font-bold text-blue-700">₹{product.price?.toLocaleString('en-IN')}</td>
                      </tr>
                      {competitors.map((c, i) => (
                        <tr key={i} className="border-b border-gray-50">
                          <td className="py-2.5 px-2 font-medium text-gray-800">{c.name}</td>
                          <td className="py-2.5 px-2 text-gray-500">{c.brand}</td>
                          <td className="py-2.5 px-2 text-right font-medium text-gray-700">₹{c.price?.toLocaleString('en-IN')}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {competitors.map((c, i) => (
                <div key={i} className="bg-white rounded-2xl p-4 shadow-sm">
                  <div className="flex items-center justify-between mb-3">
                    <div>
                      <p className="font-bold text-sm text-gray-900">{c.name}</p>
                      <p className="text-xs text-gray-500">{c.brand} · ₹{c.price?.toLocaleString('en-IN')}</p>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3 mb-3">
                    <div>
                      <p className="text-[10px] font-bold text-green-600 uppercase mb-1">Their Strengths</p>
                      {c.pros?.map((p: string, j: number) => (
                        <div key={j} className="flex items-start gap-1.5 mb-1">
                          <Check size={11} className="text-green-500 mt-0.5 flex-shrink-0" />
                          <p className="text-xs text-gray-700">{p}</p>
                        </div>
                      ))}
                    </div>
                    <div>
                      <p className="text-[10px] font-bold text-red-600 uppercase mb-1">Their Weakness</p>
                      {c.cons?.map((con: string, j: number) => (
                        <div key={j} className="flex items-start gap-1.5 mb-1">
                          <ThumbsDown size={11} className="text-red-400 mt-0.5 flex-shrink-0" />
                          <p className="text-xs text-gray-700">{con}</p>
                        </div>
                      ))}
                    </div>
                  </div>

                  {c.verdict && (
                    <div className="bg-blue-50 rounded-xl p-3">
                      <p className="text-[10px] font-bold text-blue-600 uppercase mb-0.5">Your Winning Line</p>
                      <p className="text-xs text-blue-800 italic">&ldquo;{c.verdict}&rdquo;</p>
                    </div>
                  )}
                </div>
              ))}
            </>
          ) : !competitorsEdit.editing ? (
            <div className="bg-white rounded-2xl p-8 shadow-sm text-center">
              <Swords size={32} className="text-gray-300 mx-auto mb-2" />
              <p className="text-sm text-gray-400">Competitor data not available yet.</p>
            </div>
          ) : null}
        </div>
      )}

      {/* ===== TAB: Reviews ===== */}
      {activeTab === 'reviews' && (
        <div className="space-y-4">
          {isAdmin && !reviewsEdit.editing && (
            <div className="flex justify-end">
              <button onClick={reviewsEdit.startEdit} className="flex items-center gap-1 text-xs text-blue-600 font-medium bg-blue-50 px-3 py-1.5 rounded-xl">
                <Edit2 size={13} /> Edit Reviews
              </button>
            </div>
          )}
          {reviewsEdit.editing && (
            <div className="bg-yellow-50 border border-yellow-200 rounded-2xl p-4 space-y-3">
              <ReviewsEditor reviews={reviewsEdit.draft} onChange={reviewsEdit.setDraft} />
              <div className="flex items-center gap-2 pt-1 flex-wrap">
                <button onClick={() => reviewsEdit.save()} disabled={reviewsEdit.saving} className="px-4 py-1.5 bg-blue-600 text-white text-xs font-semibold rounded-xl disabled:opacity-50">
                  {reviewsEdit.saving ? 'Saving...' : 'Save'}
                </button>
                <button onClick={reviewsEdit.cancel} className="px-4 py-1.5 bg-gray-200 text-gray-700 text-xs font-semibold rounded-xl">Cancel</button>
                {reviewsEdit.saved && <CheckCircle size={16} className="text-green-500" />}
                {reviewsEdit.error && <p className="text-xs text-red-600 font-medium w-full">{reviewsEdit.error}</p>}
              </div>
            </div>
          )}
          {!reviewsEdit.editing && reviews.best?.length > 0 ? (
            <>
              <div className="bg-white rounded-2xl p-4 shadow-sm">
                <h2 className="font-bold text-gray-900 flex items-center gap-2 mb-3 text-sm">
                  <Trophy size={16} className="text-green-500" /> Top Reviews — Use These to Convince
                </h2>
                <div className="space-y-2">
                  {reviews.best.map((r, i) => (
                    <div key={i} className="bg-green-50 rounded-xl p-3">
                      <div className="flex items-center gap-1 mb-1">
                        {Array.from({ length: r.rating ?? 0 }).map((_, s) => (
                          <Star key={s} size={11} className="text-yellow-400 fill-yellow-400" />
                        ))}
                        {r.source && <span className="text-[10px] text-gray-400 ml-auto">{r.source}</span>}
                      </div>
                      <p className="text-xs text-gray-800">&ldquo;{r.summary}&rdquo;</p>
                    </div>
                  ))}
                </div>
              </div>

              {reviews.worst?.length > 0 && (
                <div className="bg-white rounded-2xl p-4 shadow-sm">
                  <h2 className="font-bold text-gray-900 flex items-center gap-2 mb-3 text-sm">
                    <AlertTriangle size={16} className="text-red-500" /> Customer Complaints — Be Ready For These
                  </h2>
                  <div className="space-y-2">
                    {reviews.worst.map((r, i) => (
                      <div key={i} className="bg-red-50 rounded-xl p-3">
                        <div className="flex items-center gap-1 mb-1">
                          {Array.from({ length: r.rating ?? 0 }).map((_, s) => (
                            <Star key={s} size={11} className="text-yellow-400 fill-yellow-400" />
                          ))}
                          {Array.from({ length: 5 - (r.rating ?? 0) }).map((_, s) => (
                            <Star key={s} size={11} className="text-gray-300" />
                          ))}
                          {r.source && <span className="text-[10px] text-gray-400 ml-auto">{r.source}</span>}
                        </div>
                        <p className="text-xs text-gray-800">&ldquo;{r.summary}&rdquo;</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          ) : !reviewsEdit.editing ? (
            <div className="bg-white rounded-2xl p-8 shadow-sm text-center">
              <Star size={32} className="text-gray-300 mx-auto mb-2" />
              <p className="text-sm text-gray-400">Reviews not available yet.</p>
            </div>
          ) : null}
        </div>
      )}

      {/* ===== TAB: Videos ===== */}
      {activeTab === 'videos' && (
        <div className="space-y-4">
          {videos.length > 0 ? (
            <>
              <div className="bg-white rounded-2xl p-4 shadow-sm">
                <h2 className="font-bold text-gray-900 flex items-center gap-2 mb-3 text-sm">
                  <Play size={16} className="text-red-500" /> Product Videos
                </h2>
                <div className="space-y-3">
                  {videos.map((video) => {
                    const videoId = extractYouTubeId(video.youtube_url);
                    return (
                      <div key={video.id} className="space-y-2">
                        {videoId && (
                          <div className="relative w-full rounded-xl overflow-hidden bg-black" style={{ paddingBottom: '56.25%' }}>
                            <iframe
                              src={`https://www.youtube.com/embed/${videoId}`}
                              title={video.title}
                              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                              allowFullScreen
                              className="absolute inset-0 w-full h-full"
                            />
                          </div>
                        )}
                        <div>
                          <p className="text-sm font-semibold text-gray-900">{video.title}</p>
                          {video.description && <p className="text-xs text-gray-500 mt-0.5">{video.description}</p>}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </>
          ) : (
            <div className="bg-white rounded-2xl p-8 shadow-sm text-center">
              <Play size={32} className="text-gray-300 mx-auto mb-2" />
              <p className="text-sm text-gray-400">No videos available yet.</p>
            </div>
          )}
        </div>
      )}

      {/* ===== TAB: FAQ ===== */}
      {activeTab === 'faq' && (
        <div className="space-y-4">
          {isAdmin && !faqsEdit.editing && (
            <div className="flex justify-end">
              <button onClick={faqsEdit.startEdit} className="flex items-center gap-1 text-xs text-blue-600 font-medium bg-blue-50 px-3 py-1.5 rounded-xl">
                <Edit2 size={13} /> Edit FAQs
              </button>
            </div>
          )}
          {faqsEdit.editing && (
            <div className="bg-yellow-50 border border-yellow-200 rounded-2xl p-4 space-y-3">
              <FaqsEditor items={faqsEdit.draft} onChange={faqsEdit.setDraft} />
              <div className="flex items-center gap-2 pt-1 flex-wrap">
                <button onClick={() => faqsEdit.save()} disabled={faqsEdit.saving} className="px-4 py-1.5 bg-blue-600 text-white text-xs font-semibold rounded-xl disabled:opacity-50">
                  {faqsEdit.saving ? 'Saving...' : 'Save'}
                </button>
                <button onClick={faqsEdit.cancel} className="px-4 py-1.5 bg-gray-200 text-gray-700 text-xs font-semibold rounded-xl">Cancel</button>
                {faqsEdit.saved && <CheckCircle size={16} className="text-green-500" />}
                {faqsEdit.error && <p className="text-xs text-red-600 font-medium w-full">{faqsEdit.error}</p>}
              </div>
            </div>
          )}
          {!faqsEdit.editing && faqs.length > 0 ? (
            <div className="bg-white rounded-2xl p-4 shadow-sm">
              <h2 className="font-bold text-gray-900 flex items-center gap-2 mb-3 text-sm">
                <HelpCircle size={16} className="text-blue-500" /> Frequently Asked Questions
              </h2>
              <div className="space-y-2">
                {faqs.map((faq, i) => (
                  <button key={i} onClick={() => setExpandedFaq(expandedFaq === i ? null : i)} className="w-full text-left">
                    <div className={`rounded-xl p-3 transition-colors ${expandedFaq === i ? 'bg-blue-50 ring-1 ring-blue-200' : 'bg-gray-50'}`}>
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-sm font-medium text-gray-800 flex-1">{faq.question}</p>
                        <ChevronDown size={16} className={`text-gray-400 transition-transform flex-shrink-0 ${expandedFaq === i ? 'rotate-180' : ''}`} />
                      </div>
                      {expandedFaq === i && (
                        <div className="mt-3 pt-3 border-t border-blue-100">
                          <p className="text-sm text-gray-700">{faq.answer}</p>
                        </div>
                      )}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          ) : !faqsEdit.editing ? (
            <div className="bg-white rounded-2xl p-8 shadow-sm text-center">
              <HelpCircle size={32} className="text-gray-300 mx-auto mb-2" />
              <p className="text-sm text-gray-400">No FAQs available yet.</p>
            </div>
          ) : null}
        </div>
      )}

      {/* Sources — shown on all tabs when available */}
      {(sources.length > 0 || sourcesEdit.editing) && (
        <div className="bg-gray-50 rounded-2xl p-4">
          <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2 flex items-center gap-1">
            <Info size={12} /> Sources
            {isAdmin && !sourcesEdit.editing && <EditButton onClick={sourcesEdit.startEdit} />}
          </h3>
          {!sourcesEdit.editing && (
            <div className="space-y-1">
              {sources.map((s, i) => (
                <a key={i} href={s.url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 text-xs text-blue-600 hover:text-blue-800">
                  <ExternalLink size={10} className="flex-shrink-0" />
                  {s.title}
                </a>
              ))}
            </div>
          )}
          <EditWrapper editing={sourcesEdit.editing} onSave={() => sourcesEdit.save()} onCancel={sourcesEdit.cancel} saving={sourcesEdit.saving} saved={sourcesEdit.saved} error={sourcesEdit.error}>
            <SourcesEditor items={sourcesEdit.draft} onChange={sourcesEdit.setDraft} />
          </EditWrapper>
        </div>
      )}

      {/* Mark as Learned */}
      <button
        onClick={markLearned}
        disabled={learned}
        className={`w-full py-4 rounded-2xl text-center font-bold text-sm transition-all ${
          learned ? 'bg-green-100 text-green-700' : 'bg-blue-600 text-white active:bg-blue-700'
        }`}
      >
        {learned ? '✓ Marked as Learned (+10 XP)' : 'Mark as Learned'}
      </button>
    </div>
  );
}

/* ===== Editor Components ===== */

function StringArrayEditor({ items, onChange }: { items: string[]; onChange: (v: string[]) => void }) {
  return (
    <div className="space-y-2">
      {items.map((item, i) => (
        <div key={i} className="flex gap-2">
          <textarea value={item} onChange={e => { const n = [...items]; n[i] = e.target.value; onChange(n); }} className="flex-1 text-sm border border-gray-300 rounded-lg p-2 min-h-[40px]" />
          <RemoveButton onClick={() => onChange(items.filter((_, j) => j !== i))} />
        </div>
      ))}
      <AddButton onClick={() => onChange([...items, ''])} />
    </div>
  );
}

function SpecsEditor({ specs, onChange }: { specs: Record<string, string>; onChange: (v: any) => void }) {
  const entries = Object.entries(specs);
  return (
    <div className="space-y-2">
      {entries.map(([key, val], i) => (
        <div key={i} className="flex gap-2">
          <input value={key} onChange={e => {
            const newEntries = [...entries]; newEntries[i] = [e.target.value, val];
            onChange(Object.fromEntries(newEntries));
          }} placeholder="Key" className="w-1/3 text-sm border border-gray-300 rounded-lg p-2" />
          <input value={val} onChange={e => {
            const newEntries = [...entries]; newEntries[i] = [key, e.target.value];
            onChange(Object.fromEntries(newEntries));
          }} placeholder="Value" className="flex-1 text-sm border border-gray-300 rounded-lg p-2" />
          <RemoveButton onClick={() => {
            const newEntries = entries.filter((_, j) => j !== i);
            onChange(Object.fromEntries(newEntries));
          }} />
        </div>
      ))}
      <AddButton onClick={() => onChange({ ...specs, '': '' })} />
    </div>
  );
}

function ObjectionsEditor({ items, onChange }: { items: { objection: string; response: string }[]; onChange: (v: any) => void }) {
  return (
    <div className="space-y-3">
      {items.map((obj, i) => (
        <div key={i} className="border border-gray-200 rounded-lg p-2 space-y-1 bg-white">
          <div className="flex items-start gap-2">
            <div className="flex-1 space-y-1">
              <textarea value={obj.objection} onChange={e => { const n = [...items]; n[i] = { ...n[i], objection: e.target.value }; onChange(n); }} placeholder="Customer objection..." className="w-full text-sm border border-gray-300 rounded-lg p-2 min-h-[36px]" />
              <textarea value={obj.response} onChange={e => { const n = [...items]; n[i] = { ...n[i], response: e.target.value }; onChange(n); }} placeholder="Your response..." className="w-full text-sm border border-gray-300 rounded-lg p-2 min-h-[36px]" />
            </div>
            <RemoveButton onClick={() => onChange(items.filter((_, j) => j !== i))} />
          </div>
        </div>
      ))}
      <AddButton onClick={() => onChange([...items, { objection: '', response: '' }])} />
    </div>
  );
}

function CompetitorsEditor({ items, onChange }: { items: any[]; onChange: (v: any) => void }) {
  return (
    <div className="space-y-4">
      <p className="text-xs font-bold text-gray-600 uppercase">Competitors</p>
      {items.map((c, i) => (
        <div key={i} className="border border-gray-200 rounded-lg p-3 space-y-2 bg-white">
          <div className="flex gap-2">
            <input value={c.name || ''} onChange={e => { const n = [...items]; n[i] = { ...n[i], name: e.target.value }; onChange(n); }} placeholder="Name" className="flex-1 text-sm border border-gray-300 rounded-lg p-2" />
            <input value={c.brand || ''} onChange={e => { const n = [...items]; n[i] = { ...n[i], brand: e.target.value }; onChange(n); }} placeholder="Brand" className="flex-1 text-sm border border-gray-300 rounded-lg p-2" />
            <input value={c.price || ''} onChange={e => { const n = [...items]; n[i] = { ...n[i], price: Number(e.target.value) || 0 }; onChange(n); }} placeholder="Price" type="number" className="w-24 text-sm border border-gray-300 rounded-lg p-2" />
            <RemoveButton onClick={() => onChange(items.filter((_, j) => j !== i))} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <p className="text-[10px] font-bold text-green-600 uppercase mb-1">Pros</p>
              {(c.pros || []).map((p: string, j: number) => (
                <div key={j} className="flex gap-1 mb-1">
                  <input value={p} onChange={e => { const n = [...items]; const pros = [...(n[i].pros || [])]; pros[j] = e.target.value; n[i] = { ...n[i], pros }; onChange(n); }} className="flex-1 text-xs border border-gray-300 rounded p-1" />
                  <button onClick={() => { const n = [...items]; n[i] = { ...n[i], pros: (n[i].pros || []).filter((_: any, k: number) => k !== j) }; onChange(n); }} className="text-red-400 text-xs">x</button>
                </div>
              ))}
              <button onClick={() => { const n = [...items]; n[i] = { ...n[i], pros: [...(n[i].pros || []), ''] }; onChange(n); }} className="text-[10px] text-blue-600 font-medium">+ Add pro</button>
            </div>
            <div>
              <p className="text-[10px] font-bold text-red-600 uppercase mb-1">Cons</p>
              {(c.cons || []).map((con: string, j: number) => (
                <div key={j} className="flex gap-1 mb-1">
                  <input value={con} onChange={e => { const n = [...items]; const cons = [...(n[i].cons || [])]; cons[j] = e.target.value; n[i] = { ...n[i], cons }; onChange(n); }} className="flex-1 text-xs border border-gray-300 rounded p-1" />
                  <button onClick={() => { const n = [...items]; n[i] = { ...n[i], cons: (n[i].cons || []).filter((_: any, k: number) => k !== j) }; onChange(n); }} className="text-red-400 text-xs">x</button>
                </div>
              ))}
              <button onClick={() => { const n = [...items]; n[i] = { ...n[i], cons: [...(n[i].cons || []), ''] }; onChange(n); }} className="text-[10px] text-blue-600 font-medium">+ Add con</button>
            </div>
          </div>
          <textarea value={c.verdict || ''} onChange={e => { const n = [...items]; n[i] = { ...n[i], verdict: e.target.value }; onChange(n); }} placeholder="Winning line / verdict..." className="w-full text-sm border border-gray-300 rounded-lg p-2 min-h-[36px]" />
        </div>
      ))}
      <AddButton onClick={() => onChange([...items, { name: '', brand: '', price: 0, pros: [], cons: [], verdict: '' }])} label="Add Competitor" />
    </div>
  );
}

function ReviewsEditor({ reviews, onChange }: { reviews: { best: any[]; worst: any[] }; onChange: (v: any) => void }) {
  const updateList = (type: 'best' | 'worst', list: any[]) => onChange({ ...reviews, [type]: list });

  const renderList = (type: 'best' | 'worst', label: string) => {
    const list = reviews[type] || [];
    return (
      <div>
        <p className="text-xs font-bold text-gray-600 uppercase mb-2">{label}</p>
        {list.map((r: any, i: number) => (
          <div key={i} className="flex gap-2 mb-2 items-start">
            <div className="flex-1 space-y-1">
              <input value={r.summary || ''} onChange={e => { const n = [...list]; n[i] = { ...n[i], summary: e.target.value }; updateList(type, n); }} placeholder="Review summary" className="w-full text-sm border border-gray-300 rounded-lg p-2" />
              <div className="flex gap-2">
                <input value={r.rating || ''} onChange={e => { const n = [...list]; n[i] = { ...n[i], rating: Number(e.target.value) || 0 }; updateList(type, n); }} placeholder="Rating (1-5)" type="number" min={1} max={5} className="w-20 text-sm border border-gray-300 rounded-lg p-2" />
                <input value={r.source || ''} onChange={e => { const n = [...list]; n[i] = { ...n[i], source: e.target.value }; updateList(type, n); }} placeholder="Source" className="flex-1 text-sm border border-gray-300 rounded-lg p-2" />
              </div>
            </div>
            <RemoveButton onClick={() => updateList(type, list.filter((_: any, j: number) => j !== i))} />
          </div>
        ))}
        <AddButton onClick={() => updateList(type, [...list, { summary: '', rating: 5, source: '' }])} />
      </div>
    );
  };

  return (
    <div className="space-y-4">
      {renderList('best', 'Best Reviews')}
      {renderList('worst', 'Worst Reviews')}
    </div>
  );
}

function SourcesEditor({ items, onChange }: { items: { title: string; url: string }[]; onChange: (v: any) => void }) {
  return (
    <div className="space-y-2">
      {items.map((s, i) => (
        <div key={i} className="flex gap-2">
          <input value={s.title} onChange={e => { const n = [...items]; n[i] = { ...n[i], title: e.target.value }; onChange(n); }} placeholder="Title" className="flex-1 text-sm border border-gray-300 rounded-lg p-2" />
          <input value={s.url} onChange={e => { const n = [...items]; n[i] = { ...n[i], url: e.target.value }; onChange(n); }} placeholder="URL" className="flex-1 text-sm border border-gray-300 rounded-lg p-2" />
          <RemoveButton onClick={() => onChange(items.filter((_, j) => j !== i))} />
        </div>
      ))}
      <AddButton onClick={() => onChange([...items, { title: '', url: '' }])} label="Add Source" />
    </div>
  );
}

function FaqsEditor({ items, onChange }: { items: ProductFaq[]; onChange: (v: ProductFaq[]) => void }) {
  return (
    <div className="space-y-3">
      <p className="text-xs font-bold text-gray-600 uppercase">FAQs</p>
      {items.map((faq, i) => (
        <div key={i} className="border border-gray-200 rounded-lg p-2 space-y-1 bg-white">
          <div className="flex items-start gap-2">
            <div className="flex-1 space-y-1">
              <textarea value={faq.question} onChange={e => { const n = [...items]; n[i] = { ...n[i], question: e.target.value }; onChange(n); }} placeholder="Question..." className="w-full text-sm border border-gray-300 rounded-lg p-2 min-h-[36px]" />
              <textarea value={faq.answer} onChange={e => { const n = [...items]; n[i] = { ...n[i], answer: e.target.value }; onChange(n); }} placeholder="Answer..." className="w-full text-sm border border-gray-300 rounded-lg p-2 min-h-[36px]" />
            </div>
            <RemoveButton onClick={() => onChange(items.filter((_, j) => j !== i))} />
          </div>
        </div>
      ))}
      <AddButton onClick={() => onChange([...items, { question: '', answer: '' }])} label="Add FAQ" />
    </div>
  );
}

/* Collapsible psychology section */
function PsychSection({
  id, title, subtitle, icon, color, items, expanded, onToggle,
}: {
  id: string;
  title: string;
  subtitle: string;
  icon: React.ReactNode;
  color: string;
  items: string[];
  expanded: string | null;
  onToggle: (id: string | null) => void;
}) {
  if (!items || items.length === 0) return null;
  const isOpen = expanded === id;

  const bgColors: Record<string, string> = { red: 'bg-red-50', blue: 'bg-blue-50', green: 'bg-green-50', orange: 'bg-orange-50' };
  const textColors: Record<string, string> = { red: 'text-red-800', blue: 'text-blue-800', green: 'text-green-800', orange: 'text-orange-800' };

  return (
    <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
      <button onClick={() => onToggle(isOpen ? null : id)} className="w-full flex items-center justify-between p-4 text-left">
        <div className="flex items-center gap-2.5">
          {icon}
          <div>
            <p className="text-sm font-bold text-gray-900">{title}</p>
            <p className="text-[11px] text-gray-400">{subtitle}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-semibold text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">{items.length}</span>
          <ChevronDown size={16} className={`text-gray-400 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
        </div>
      </button>
      {isOpen && (
        <div className="px-4 pb-4 space-y-2">
          {items.map((item, i) => (
            <div key={i} className={`${bgColors[color]} rounded-xl px-3 py-2.5`}>
              <p className={`text-sm ${textColors[color]}`}>{item}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
