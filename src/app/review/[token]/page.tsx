"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";

type JobData = {
  id: string;
  tokenNumber: string;
  status: string;
  bikeType: string;
  jobType: string;
  workDone: string | null;
  mechanic: { id: string; name: string; emoji: string } | null;
  customer: { name: string } | null;
  review: { id: string; rating: number; comment: string | null } | null;
};

export default function ReviewPage() {
  const { token } = useParams<{ token: string }>();
  const [job, setJob] = useState<JobData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    fetch(`/api/services/reviews?token=${token}`)
      .then(async (res) => {
        if (res.ok) {
          const data = await res.json();
          setJob(data.job);
          if (data.job.review) setSubmitted(true);
        } else {
          setError("Job not found");
        }
      })
      .catch(() => setError("Something went wrong"))
      .finally(() => setLoading(false));
  }, [token]);

  const handleSubmit = async () => {
    if (rating === 0) return;
    setSubmitting(true);

    const res = await fetch("/api/services/reviews", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tokenNumber: token,
        rating,
        comment: comment.trim() || null,
      }),
    });

    if (res.ok) {
      setSubmitted(true);
    } else {
      const data = await res.json();
      setError(data.error || "Failed to submit");
    }
    setSubmitting(false);
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white">
        <div className="text-5xl animate-bounce">⭐</div>
      </div>
    );
  }

  if (error || !job) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white p-6">
        <div className="text-center">
          <div className="text-6xl mb-4">😕</div>
          <h2 className="text-xl font-bold text-gray-700">
            {error || "Job not found"}
          </h2>
          <p className="text-gray-400 mt-2">Check the link and try again</p>
        </div>
      </div>
    );
  }

  // Already reviewed
  if (submitted || job.review) {
    const r = job.review;
    return (
      <div className="min-h-screen bg-white p-6 flex flex-col items-center justify-center">
        <div className="text-center max-w-sm">
          <div className="text-6xl mb-4">🙏</div>
          <h2 className="text-2xl font-bold text-gray-800 mb-2">Thank You!</h2>
          <p className="text-gray-500 mb-6">
            Your feedback for <strong>{job.tokenNumber}</strong> has been recorded.
          </p>
          {r && (
            <div className="bg-gray-50 rounded-2xl p-4">
              <div className="text-3xl mb-2">
                {[1, 2, 3, 4, 5].map((s) => (
                  <span key={s}>{s <= r.rating ? "⭐" : "☆"}</span>
                ))}
              </div>
              {r.comment && (
                <p className="text-gray-600 text-sm">&quot;{r.comment}&quot;</p>
              )}
            </div>
          )}
          {!r && rating > 0 && (
            <div className="bg-green-50 rounded-2xl p-4">
              <div className="text-3xl mb-2">
                {[1, 2, 3, 4, 5].map((s) => (
                  <span key={s}>{s <= rating ? "⭐" : "☆"}</span>
                ))}
              </div>
              {comment && (
                <p className="text-gray-600 text-sm">&quot;{comment}&quot;</p>
              )}
            </div>
          )}
          <p className="text-gray-400 text-sm mt-6">
            🚲 Bharath Cycle Hub
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white p-6">
      <div className="max-w-sm mx-auto">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="text-5xl mb-3">🚲</div>
          <h1 className="text-2xl font-bold text-gray-800">
            Bharath Cycle Hub
          </h1>
          <p className="text-gray-500 mt-1">How was your service?</p>
        </div>

        {/* Job info card */}
        <div className="bg-gray-50 rounded-2xl p-4 mb-6">
          <div className="flex items-center justify-between mb-2">
            <span className="text-lg font-bold text-gray-800">
              🎫 {job.tokenNumber}
            </span>
            <span className="text-sm text-gray-500">{job.bikeType}</span>
          </div>
          {job.mechanic && (
            <div className="text-gray-600">
              {job.mechanic.emoji} Serviced by{" "}
              <strong>{job.mechanic.name}</strong>
            </div>
          )}
          {job.workDone && (
            <div className="text-sm text-gray-500 mt-1">
              🔧 {job.workDone}
            </div>
          )}
        </div>

        {/* Star rating */}
        <div className="text-center mb-6">
          <p className="text-lg font-semibold text-gray-700 mb-3">
            Tap to rate
          </p>
          <div className="flex justify-center gap-2">
            {[1, 2, 3, 4, 5].map((star) => (
              <button
                key={star}
                onClick={() => setRating(star)}
                className="text-5xl transition-transform active:scale-110"
              >
                {star <= rating ? "⭐" : "☆"}
              </button>
            ))}
          </div>
          {rating > 0 && (
            <p className="text-gray-500 mt-2 text-sm">
              {rating === 5
                ? "Excellent! 🎉"
                : rating === 4
                ? "Great! 👍"
                : rating === 3
                ? "Good 👌"
                : rating === 2
                ? "Could be better 😐"
                : "Sorry to hear 😔"}
            </p>
          )}
        </div>

        {/* Comment */}
        <div className="mb-6">
          <textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="Tell us more... (optional)"
            rows={3}
            className="w-full border-2 border-gray-200 rounded-xl px-4 py-3 text-lg focus:border-gray-800 focus:outline-none resize-none"
          />
        </div>

        {/* Submit */}
        <button
          onClick={handleSubmit}
          disabled={rating === 0 || submitting}
          className="w-full bg-gray-800 text-white font-bold py-4 rounded-xl text-xl disabled:bg-gray-300 active:scale-95 transition-transform"
        >
          {submitting ? "Submitting..." : "Submit Review ✨"}
        </button>
      </div>
    </div>
  );
}
