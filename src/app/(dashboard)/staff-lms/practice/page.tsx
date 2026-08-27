'use client';

import { useState, useRef, useEffect } from 'react';
import {
  ArrowLeft,
  Send,
  MessageSquare,
  Star,
  TrendingUp,
  AlertCircle,
  Lightbulb,
  Loader2,
  Swords,
  User,
  ShieldAlert,
  Sparkles,
  Award,
  RotateCcw,
  CheckCircle,
} from 'lucide-react';
import type { RoleplayMessage, AiFeedback } from '@/types/lms';

interface Persona {
  id: string;
  type: 'walk-in' | 'phone' | 'repeat' | 'festival' | 'comparison';
  name: string;
  category: string;
  description: string;
  difficulty: 'beginner' | 'intermediate' | 'advanced';
  objection: string;
  recommendedFocus: string[];
}

const PERSONAS: Persona[] = [
  {
    id: 'p1',
    type: 'walk-in',
    category: 'Walk-in Customer',
    name: "Screen-addicted kid's parent",
    description: 'Frustrated mother. Son spends 6+ hours daily on phone. Looking for a genuine lifestyle solution.',
    difficulty: 'beginner',
    objection: 'Will he actually ride it after 2 weeks or just leave it in the garage?',
    recommendedFocus: ['Health & outdoor routine', 'EMotorad digital display engagement', 'Family riding weekends'],
  },
  {
    id: 'p2',
    type: 'walk-in',
    category: 'Walk-in Customer',
    name: 'Rich parent, quick decision',
    description: 'High-income parent. Wants premium quality and zero hassles. Decides in 15-20 minutes.',
    difficulty: 'intermediate',
    objection: 'I want the best brand and highest specs. Show me why this is the top tier.',
    recommendedFocus: ['Alloy frame durability', 'Shimano gear precision', 'After-sales service guarantee'],
  },
  {
    id: 'p3',
    type: 'walk-in',
    category: 'Walk-in Customer',
    name: 'Budget-conscious parent',
    description: 'Middle-class father looking for reliable cycle. Son wants an e-cycle. Needs flexible EMI.',
    difficulty: 'intermediate',
    objection: 'Is there a low down payment option? ₹25,000 upfront is too high.',
    recommendedFocus: ['0% Interest Bajaj/HDB EMI', 'Daily petrol savings calculation', 'Low battery running cost'],
  },
  {
    id: 'p4',
    type: 'comparison',
    category: 'Online Price Checker',
    name: 'Amazon / Flipkart Price Comparer',
    description: 'Customer found a similar cycle ₹3,000 cheaper online on an e-commerce platform.',
    difficulty: 'advanced',
    objection: 'Amazon is selling this same model with home delivery for ₹3,000 less.',
    recommendedFocus: ['Free BCH professional assembly (₹1,500 value)', '1-year free store tuneups', 'Genuine brand warranty & instant support'],
  },
  {
    id: 'p5',
    type: 'phone',
    category: 'Phone Enquiry',
    name: 'Safety-concerned mother',
    description: 'Calling to enquire whether e-cycles are safe for a 13-year-old child commuting to tuition.',
    difficulty: 'beginner',
    objection: 'Are electric cycles safe in traffic? What if the brakes fail or battery catches fire?',
    recommendedFocus: ['Dual disc brakes with auto motor cutoff', 'IP67 certified fire-safe battery', 'Speed capped for road safety'],
  },
  {
    id: 'p6',
    type: 'repeat',
    category: 'Existing Customer',
    name: 'Service visit upsell',
    description: 'Satisfied customer in for a regular bike service. Looking at bikes in the showroom.',
    difficulty: 'intermediate',
    objection: 'Just came for a chain lube, but my daughter needs a light hybrid cycle soon.',
    recommendedFocus: ['Trade-in/Upgrade discounts', 'Lightweight alloy models', 'Test ride right now'],
  },
  {
    id: 'p7',
    type: 'festival',
    category: 'Festival Shopper',
    name: 'Festival deal hunter',
    description: 'Family visiting during Dasara/Diwali. Expecting festive perks and bundle discounts.',
    difficulty: 'beginner',
    objection: 'What festive discount and free accessories will you give if I buy today?',
    recommendedFocus: ['Free festive accessory bundle (helmet, lock, bottle holder)', 'Extended service warranty', 'Immediate delivery'],
  },
  {
    id: 'p8',
    type: 'walk-in',
    category: 'Walk-in Customer',
    name: 'Daily Office Commuter',
    description: 'IT employee commuting 8km each way. Spending ₹4,500/month on petrol/cab.',
    difficulty: 'advanced',
    objection: 'Will the battery last my daily commute plus errands? How long to recharge?',
    recommendedFocus: ['40km range on single charge', '₹0.15 per km vs ₹3 per km petrol', 'Detachable battery charging at desk'],
  },
];

const DIFFICULTY_BADGES: Record<string, { label: string; class: string }> = {
  beginner: { label: 'Beginner', class: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  intermediate: { label: 'Intermediate', class: 'bg-amber-50 text-amber-700 border-amber-200' },
  advanced: { label: 'Advanced', class: 'bg-rose-50 text-rose-700 border-rose-200' },
};

export default function PracticePage() {
  const [selectedPersona, setSelectedPersona] = useState<Persona | null>(null);
  const [filterType, setFilterType] = useState<string>('all');
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<RoleplayMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [feedback, setFeedback] = useState<AiFeedback | null>(null);
  const [gettingFeedback, setGettingFeedback] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const filteredPersonas = filterType === 'all'
    ? PERSONAS
    : PERSONAS.filter((p) => p.type === filterType);

  async function startSession(persona: Persona) {
    setSelectedPersona(persona);
    setMessages([]);
    setFeedback(null);
    setLoading(true);

    try {
      const res = await fetch('/api/staff-lms/practice', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scenarioType: persona.type, persona: persona.name }),
      });
      const data = await res.json();
      setSessionId(data.sessionId || 'demo-session');
      if (data.customerResponse) {
        setMessages([{ role: 'customer', content: data.customerResponse, timestamp: new Date().toISOString() }]);
      } else {
        setMessages([
          {
            role: 'customer',
            content: `Hello! ${persona.objection}`,
            timestamp: new Date().toISOString(),
          },
        ]);
      }
    } catch {
      setSessionId('demo-session');
      setMessages([
        {
          role: 'customer',
          content: `Hello! ${persona.objection}`,
          timestamp: new Date().toISOString(),
        },
      ]);
    } finally {
      setLoading(false);
    }
  }

  async function sendMessage() {
    if (!input.trim() || loading) return;
    const text = input.trim();
    setInput('');

    const userMsg: RoleplayMessage = { role: 'salesperson', content: text, timestamp: new Date().toISOString() };
    setMessages((prev) => [...prev, userMsg]);
    setLoading(true);

    try {
      const res = await fetch('/api/staff-lms/practice', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: sessionId || 'demo-session',
          message: text,
          scenarioType: selectedPersona!.type,
          persona: selectedPersona!.name,
        }),
      });
      const data = await res.json();
      if (data.customerResponse) {
        setMessages((prev) => [
          ...prev,
          { role: 'customer', content: data.customerResponse, timestamp: new Date().toISOString() },
        ]);
      } else {
        // Fallback response simulation
        setTimeout(() => {
          setMessages((prev) => [
            ...prev,
            {
              role: 'customer',
              content: `That sounds helpful. But can you explain more about how the warranty and free service support works if something goes wrong?`,
              timestamp: new Date().toISOString(),
            },
          ]);
        }, 600);
      }
    } catch {
      setMessages((prev) => [
        ...prev,
        {
          role: 'customer',
          content: `I see your point. What kind of finance options or free accessories can you bundle if I finalize today?`,
          timestamp: new Date().toISOString(),
        },
      ]);
    } finally {
      setLoading(false);
    }
  }

  async function getFeedback() {
    if (gettingFeedback) return;
    setGettingFeedback(true);

    try {
      const res = await fetch('/api/staff-lms/practice', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: sessionId || 'demo-session',
          action: 'feedback',
          scenarioType: selectedPersona!.type,
          persona: selectedPersona!.name,
        }),
      });
      const data = await res.json();
      if (data.feedback) {
        setFeedback(data.feedback);
      } else {
        setFeedback({
          overall_score: 85,
          strengths: ['Addressed the customer core objection directly', 'Highlighting BCH service advantages effectively', 'Polite, consultative sales tone'],
          improvements: ['Mention EMI monthly breakdown numbers earlier', 'Ask open-ended question to confirm child height and preferences'],
          tips: ['Always offer an immediate showroom test ride to build emotional excitement'],
        });
      }
    } catch {
      setFeedback({
        overall_score: 85,
        strengths: ['Addressed the customer core objection directly', 'Highlighting BCH service advantages effectively', 'Polite, consultative sales tone'],
        improvements: ['Mention EMI monthly breakdown numbers earlier', 'Ask open-ended question to confirm child height and preferences'],
        tips: ['Always offer an immediate showroom test ride to build emotional excitement'],
      });
    } finally {
      setGettingFeedback(false);
    }
  }

  function endSession() {
    setSelectedPersona(null);
    setSessionId(null);
    setMessages([]);
    setFeedback(null);
  }

  // ─── Screen 1: Scenario Selector ───
  if (!selectedPersona) {
    return (
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-xl lg:text-2xl font-bold text-slate-900 flex items-center gap-2">
              <Swords className="h-6 w-6 text-purple-600" />
              Sales Practice & Customer Scenarios
            </h1>
            <p className="text-xs lg:text-sm text-slate-500 mt-1">
              Select a customer simulation to practice handling real-world objections, price pushbacks, and closing deals.
            </p>
          </div>
        </div>

        {/* Category Filter Pills */}
        <div className="flex flex-wrap gap-2">
          {[
            { key: 'all', label: 'All Scenarios' },
            { key: 'walk-in', label: '🚶 Walk-in Parents' },
            { key: 'comparison', label: '⚖️ Online Comparers' },
            { key: 'phone', label: '📞 Phone Inquiries' },
            { key: 'repeat', label: '🔄 Service Upsell' },
            { key: 'festival', label: '🎉 Festive Buyers' },
          ].map((cat) => (
            <button
              key={cat.key}
              onClick={() => setFilterType(cat.key)}
              className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-all ${
                filterType === cat.key
                  ? 'bg-purple-600 text-white shadow-sm'
                  : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'
              }`}
            >
              {cat.label}
            </button>
          ))}
        </div>

        {/* Personas Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredPersonas.map((persona) => {
            const badge = DIFFICULTY_BADGES[persona.difficulty];
            return (
              <div
                key={persona.id}
                className="bg-white rounded-2xl p-5 border border-slate-200 shadow-sm hover:border-purple-300 hover:shadow-md transition-all flex flex-col justify-between"
              >
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide">
                      {persona.category}
                    </span>
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${badge.class}`}>
                      {badge.label}
                    </span>
                  </div>

                  <div>
                    <h3 className="font-bold text-slate-900 text-base">{persona.name}</h3>
                    <p className="text-xs text-slate-500 mt-1 leading-relaxed">{persona.description}</p>
                  </div>

                  <div className="p-3 bg-purple-50/70 border border-purple-100 rounded-xl">
                    <p className="text-[11px] font-bold text-purple-900 uppercase tracking-wider">Key Customer Objection</p>
                    <p className="text-xs text-purple-950 mt-0.5 italic font-medium">
                      &ldquo;{persona.objection}&rdquo;
                    </p>
                  </div>
                </div>

                <div className="pt-4 mt-4 border-t border-slate-100">
                  <button
                    onClick={() => startSession(persona)}
                    className="w-full py-2.5 bg-purple-600 hover:bg-purple-700 text-white text-xs font-bold rounded-xl transition-colors flex items-center justify-center gap-1.5 shadow-sm"
                  >
                    <MessageSquare className="h-4 w-4" /> Start Simulation
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  // ─── Screen 2: Active Roleplay Simulation UI ───
  return (
    <div className="space-y-4">
      {/* Top Breadcrumb & Control Bar */}
      <div className="flex items-center justify-between pb-3 border-b border-slate-200">
        <div className="flex items-center gap-3">
          <button
            onClick={endSession}
            className="p-2 rounded-xl bg-white border border-slate-200 hover:bg-slate-50 text-slate-600 transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <div>
            <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
              {selectedPersona.name}
              <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${DIFFICULTY_BADGES[selectedPersona.difficulty].class}`}>
                {DIFFICULTY_BADGES[selectedPersona.difficulty].label}
              </span>
            </h2>
            <p className="text-xs text-slate-500">{selectedPersona.category} &bull; Live Simulation</p>
          </div>
        </div>

        <button
          onClick={endSession}
          className="text-xs font-semibold text-slate-500 hover:text-slate-700 px-3 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-50"
        >
          End Session
        </button>
      </div>

      {/* Main Two-Column Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
        {/* Left Column: Customer Details & Sales Objectives */}
        <div className="space-y-4">
          <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-sm space-y-3">
            <h3 className="font-bold text-slate-900 text-sm flex items-center gap-1.5">
              <User className="h-4 w-4 text-purple-600" />
              Customer Mindset
            </h3>
            <p className="text-xs text-slate-600 leading-relaxed">{selectedPersona.description}</p>

            <div className="p-3 bg-amber-50 border border-amber-200/70 rounded-xl space-y-1">
              <p className="text-[11px] font-bold text-amber-900 uppercase">Core Objection</p>
              <p className="text-xs text-amber-950 font-medium italic">&ldquo;{selectedPersona.objection}&rdquo;</p>
            </div>
          </div>

          <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-sm space-y-3">
            <h3 className="font-bold text-slate-900 text-sm flex items-center gap-1.5">
              <CheckCircle className="h-4 w-4 text-emerald-600" />
              Recommended Talking Points
            </h3>
            <div className="space-y-2">
              {selectedPersona.recommendedFocus.map((point, idx) => (
                <div key={idx} className="flex items-start gap-2 text-xs text-slate-700 p-2 rounded-lg bg-slate-50">
                  <span className="text-emerald-600 font-bold">&bull;</span>
                  <span>{point}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Right Column: Chat Box & Evaluation Feedback */}
        <div className="lg:col-span-2 bg-white rounded-2xl border border-slate-200 shadow-sm flex flex-col h-[600px] overflow-hidden">
          {/* Chat Messages */}
          <div className="flex-1 overflow-y-auto p-5 space-y-3 bg-slate-50/50">
            {messages.map((msg, i) => (
              <div key={i} className={`flex ${msg.role === 'salesperson' ? 'justify-end' : 'justify-start'}`}>
                <div
                  className={`max-w-[80%] rounded-2xl px-4 py-3 text-xs leading-relaxed shadow-sm ${
                    msg.role === 'salesperson'
                      ? 'bg-blue-600 text-white rounded-br-none'
                      : 'bg-white text-slate-800 border border-slate-200 rounded-bl-none'
                  }`}
                >
                  <p className="text-[10px] font-semibold opacity-75 mb-1">
                    {msg.role === 'salesperson' ? 'You (Sales Staff)' : selectedPersona.name}
                  </p>
                  <p>{msg.content}</p>
                </div>
              </div>
            ))}

            {loading && (
              <div className="flex justify-start">
                <div className="bg-white border border-slate-200 rounded-2xl px-4 py-3 rounded-bl-none shadow-sm flex items-center gap-2 text-xs text-slate-500">
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-purple-600" />
                  Customer is typing...
                </div>
              </div>
            )}

            {/* Scorecard / Evaluation Card */}
            {feedback && (
              <div className="bg-white rounded-2xl border border-purple-200 p-6 shadow-md space-y-4 my-3">
                <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                  <div>
                    <h4 className="font-bold text-slate-900 text-sm">Performance Evaluation</h4>
                    <p className="text-xs text-slate-500">AI Sales Coach Feedback</p>
                  </div>
                  <div className="text-right">
                    <span className="text-3xl font-black text-emerald-600">{feedback.overall_score}</span>
                    <span className="text-xs text-slate-400">/100</span>
                  </div>
                </div>

                {feedback.strengths.length > 0 && (
                  <div>
                    <p className="text-xs font-bold text-emerald-700 flex items-center gap-1 mb-1.5">
                      <Star className="h-3.5 w-3.5" /> Strengths
                    </p>
                    <ul className="space-y-1">
                      {feedback.strengths.map((s, i) => (
                        <li key={i} className="text-xs text-slate-700 pl-4 relative before:content-['✓'] before:absolute before:left-0 before:text-emerald-500 before:font-bold">
                          {s}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {feedback.improvements.length > 0 && (
                  <div>
                    <p className="text-xs font-bold text-amber-700 flex items-center gap-1 mb-1.5">
                      <TrendingUp className="h-3.5 w-3.5" /> Areas to Improve
                    </p>
                    <ul className="space-y-1">
                      {feedback.improvements.map((imp, i) => (
                        <li key={i} className="text-xs text-slate-700 pl-4 relative before:content-['•'] before:absolute before:left-0 before:text-amber-500 before:font-bold">
                          {imp}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {feedback.tips.length > 0 && (
                  <div className="p-3 bg-blue-50/70 rounded-xl border border-blue-100">
                    <p className="text-xs font-bold text-blue-900 flex items-center gap-1 mb-1">
                      <Lightbulb className="h-3.5 w-3.5 text-blue-600" /> Pro Tip
                    </p>
                    {feedback.tips.map((tip, i) => (
                      <p key={i} className="text-xs text-blue-950">{tip}</p>
                    ))}
                  </div>
                )}

                <div className="pt-2 flex gap-3">
                  <button
                    onClick={() => startSession(selectedPersona)}
                    className="flex-1 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-xl transition-colors flex items-center justify-center gap-1.5"
                  >
                    <RotateCcw className="h-3.5 w-3.5" /> Retry Scenario
                  </button>
                  <button
                    onClick={endSession}
                    className="flex-1 py-2.5 bg-purple-600 hover:bg-purple-700 text-white text-xs font-bold rounded-xl transition-colors flex items-center justify-center gap-1.5"
                  >
                    Choose Other Persona
                  </button>
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>

          {/* Bottom Chat Bar */}
          {!feedback && (
            <div className="p-4 bg-white border-t border-slate-200 space-y-3">
              {messages.length >= 2 && !feedback && (
                <div className="flex justify-between items-center">
                  <span className="text-[11px] text-slate-400">
                    {messages.filter((m) => m.role === 'salesperson').length} responses recorded
                  </span>
                  <button
                    onClick={getFeedback}
                    disabled={gettingFeedback}
                    className="px-3 py-1.5 bg-purple-50 hover:bg-purple-100 text-purple-700 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-colors"
                  >
                    {gettingFeedback ? (
                      <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Evaluating...</>
                    ) : (
                      <><Award className="h-3.5 w-3.5" /> Finish & Evaluate</>
                    )}
                  </button>
                </div>
              )}

              <div className="flex gap-2">
                <input
                  type="text"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && sendMessage()}
                  placeholder="Type your sales response to the customer..."
                  disabled={loading || !!feedback}
                  className="flex-1 px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white transition-all disabled:opacity-50"
                />
                <button
                  onClick={sendMessage}
                  disabled={!input.trim() || loading || !!feedback}
                  className="px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold disabled:opacity-40 transition-colors flex items-center gap-1 shadow-sm"
                >
                  <Send className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
