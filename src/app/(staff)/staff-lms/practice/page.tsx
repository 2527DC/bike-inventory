'use client';

import { useState, useRef, useEffect } from 'react';
import { ArrowLeft, Send, MessageSquare, Star, TrendingUp, AlertCircle, Lightbulb, Loader2 } from 'lucide-react';
import type { RoleplayMessage, AiFeedback } from '@/types';

const PERSONAS = [
  { type: 'walk-in', name: 'Screen-addicted kid\'s parent', description: 'Frustrated mother. Son spends 6+ hours on phone. Wants a solution. BCH\'s #1 trigger.', difficulty: 'beginner' },
  { type: 'walk-in', name: 'Rich parent, quick decision', description: 'High-income parent. Doesn\'t negotiate. Wants the best. Decides in 20 minutes.', difficulty: 'intermediate' },
  { type: 'walk-in', name: 'Budget father, EMI needed', description: 'Auto driver earning ₹18K/month. Son begging for e-cycle. Needs ₹999/month EMI.', difficulty: 'intermediate' },
  { type: 'comparison', name: 'Online price checker', description: 'Found Doodle ₹3,000 cheaper on Amazon. Needs proof that BCH is worth more.', difficulty: 'advanced' },
  { type: 'phone', name: 'Phone enquiry parent', description: 'Worried mother calling about e-cycle safety for her 12-year-old son.', difficulty: 'beginner' },
  { type: 'repeat', name: 'Service visit upsell', description: 'Happy customer back for service. Daughter now wants a stylish cycle too.', difficulty: 'intermediate' },
  { type: 'festival', name: 'Dasara shopper', description: 'Family of 3 here during Dasara. Son excited. Expects festival deal. Budget ₹8K-15K.', difficulty: 'beginner' },
  { type: 'walk-in', name: 'Skeptical first-timer', description: 'Buys from roadside shops. Thinks BCH is overpriced. Friend dragged him here.', difficulty: 'advanced' },
  { type: 'walk-in', name: 'E-cycle curious adult', description: 'IT professional. Commutes 8km daily. Spending ₹4K/month on petrol. Wants ROI numbers.', difficulty: 'advanced' },
];

const DIFFICULTY_COLORS: Record<string, string> = {
  beginner: 'text-green-600 bg-green-50',
  intermediate: 'text-yellow-600 bg-yellow-50',
  advanced: 'text-red-600 bg-red-50',
};

const TYPE_LABELS: Record<string, string> = {
  'walk-in': '🚶 Walk-in',
  'phone': '📞 Phone',
  'repeat': '🔄 Repeat',
  'festival': '🎉 Festival',
  'comparison': '⚖️ Comparison',
};

export default function PracticePage() {
  const [selectedPersona, setSelectedPersona] = useState<typeof PERSONAS[0] | null>(null);
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

  async function startSession(persona: typeof PERSONAS[0]) {
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
      setSessionId(data.sessionId);
      if (data.customerResponse) {
        setMessages([{ role: 'customer', content: data.customerResponse, timestamp: new Date().toISOString() }]);
      }
    } catch {
      // Error starting session
    } finally {
      setLoading(false);
    }
  }

  async function sendMessage() {
    if (!input.trim() || !sessionId || loading) return;
    const text = input.trim();
    setInput('');

    const userMsg: RoleplayMessage = { role: 'salesperson', content: text, timestamp: new Date().toISOString() };
    setMessages((prev) => [...prev, userMsg]);
    setLoading(true);

    try {
      const res = await fetch('/api/staff-lms/practice', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, message: text, scenarioType: selectedPersona!.type, persona: selectedPersona!.name }),
      });
      const data = await res.json();
      if (data.customerResponse) {
        setMessages((prev) => [
          ...prev,
          { role: 'customer', content: data.customerResponse, timestamp: new Date().toISOString() },
        ]);
      }
    } catch {
      // Error
    } finally {
      setLoading(false);
    }
  }

  async function getFeedback() {
    if (!sessionId || gettingFeedback) return;
    setGettingFeedback(true);

    try {
      const res = await fetch('/api/staff-lms/practice', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, action: 'feedback', scenarioType: selectedPersona!.type, persona: selectedPersona!.name }),
      });
      const data = await res.json();
      setFeedback(data.feedback);
    } catch {
      // Error
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

  // Scenario Picker
  if (!selectedPersona) {
    return (
      <div className="space-y-4">
        <p className="text-sm text-gray-500">Practice with AI customers. Choose a scenario to begin.</p>

        <div className="space-y-3">
          {PERSONAS.map((persona, i) => (
            <button
              key={i}
              onClick={() => startSession(persona)}
              className="w-full text-left bg-white rounded-2xl p-4 shadow-sm card-hover"
            >
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="font-semibold text-gray-900 text-sm">{persona.name}</h3>
                  <p className="text-xs text-gray-500 mt-0.5">{persona.description}</p>
                  <div className="flex items-center gap-2 mt-2">
                    <span className="text-[10px] text-gray-500">{TYPE_LABELS[persona.type]}</span>
                    <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${DIFFICULTY_COLORS[persona.difficulty]}`}>
                      {persona.difficulty}
                    </span>
                  </div>
                </div>
                <MessageSquare size={20} className="text-purple-400 flex-shrink-0" />
              </div>
            </button>
          ))}
        </div>
      </div>
    );
  }

  // Chat UI
  return (
    <div className="flex flex-col h-[calc(100vh-10rem)]">
      {/* Chat Header */}
      <div className="flex items-center gap-3 pb-3 border-b border-gray-100">
        <button onClick={endSession} className="text-gray-400">
          <ArrowLeft size={20} />
        </button>
        <div>
          <p className="font-semibold text-sm text-gray-900">{selectedPersona.name}</p>
          <p className="text-[10px] text-gray-400">{TYPE_LABELS[selectedPersona.type]} · AI Customer</p>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto py-4 space-y-3">
        {messages.map((msg, i) => (
          <div key={i} className={`flex ${msg.role === 'salesperson' ? 'justify-end' : 'justify-start'}`}>
            <div
              className={`max-w-[80%] rounded-2xl px-4 py-2.5 text-sm ${
                msg.role === 'salesperson'
                  ? 'bg-blue-600 text-white rounded-br-md'
                  : 'bg-gray-100 text-gray-800 rounded-bl-md'
              }`}
            >
              {msg.content}
            </div>
          </div>
        ))}
        {loading && (
          <div className="flex justify-start">
            <div className="bg-gray-100 rounded-2xl px-4 py-3 rounded-bl-md">
              <div className="flex gap-1">
                <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
              </div>
            </div>
          </div>
        )}

        {/* Feedback Card */}
        {feedback && (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5 space-y-4">
            <div className="text-center">
              <p className="text-4xl font-bold" style={{ color: feedback.overall_score >= 70 ? '#10b981' : feedback.overall_score >= 50 ? '#f59e0b' : '#ef4444' }}>
                {feedback.overall_score}
              </p>
              <p className="text-sm text-gray-500">out of 100</p>
            </div>

            {feedback.strengths.length > 0 && (
              <div>
                <p className="font-medium text-green-700 flex items-center gap-1 text-sm mb-1">
                  <Star size={14} /> Strengths
                </p>
                {feedback.strengths.map((s, i) => (
                  <p key={i} className="text-sm text-gray-600 ml-5">• {s}</p>
                ))}
              </div>
            )}

            {feedback.improvements.length > 0 && (
              <div>
                <p className="font-medium text-orange-600 flex items-center gap-1 text-sm mb-1">
                  <TrendingUp size={14} /> To Improve
                </p>
                {feedback.improvements.map((s, i) => (
                  <p key={i} className="text-sm text-gray-600 ml-5">• {s}</p>
                ))}
              </div>
            )}

            {feedback.tips.length > 0 && (
              <div>
                <p className="font-medium text-blue-600 flex items-center gap-1 text-sm mb-1">
                  <Lightbulb size={14} /> Tips
                </p>
                {feedback.tips.map((s, i) => (
                  <p key={i} className="text-sm text-gray-600 ml-5">• {s}</p>
                ))}
              </div>
            )}

            <button
              onClick={endSession}
              className="w-full py-3 bg-blue-600 text-white rounded-xl font-medium text-sm"
            >
              Back to Scenarios
            </button>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input Area */}
      {!feedback && (
        <div className="pt-3 border-t border-gray-100 space-y-2">
          {messages.length >= 8 && !feedback && (
            <button
              onClick={getFeedback}
              disabled={gettingFeedback}
              className="w-full py-2.5 bg-purple-100 text-purple-700 rounded-xl text-sm font-medium flex items-center justify-center gap-2"
            >
              {gettingFeedback ? (
                <><Loader2 size={16} className="animate-spin" /> Analyzing your performance...</>
              ) : (
                <><AlertCircle size={16} /> Get AI Feedback</>
              )}
            </button>
          )}
          <div className="flex gap-2">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && sendMessage()}
              placeholder="Type your response..."
              disabled={loading || !!feedback}
              className="flex-1 px-4 py-3 bg-gray-100 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-200 disabled:opacity-50"
            />
            <button
              onClick={sendMessage}
              disabled={!input.trim() || loading || !!feedback}
              className="px-4 py-3 bg-blue-600 text-white rounded-xl disabled:opacity-30"
            >
              <Send size={18} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
