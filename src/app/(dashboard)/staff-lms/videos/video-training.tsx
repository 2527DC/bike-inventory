'use client';

import { useState } from 'react';
import { ChevronDown, Play, Check, X, Video } from 'lucide-react';
import type { VideoCategory, Video as VideoType } from '@/types';
import { extractYoutubeId } from '@/lib/utils';

interface Props {
  categories: VideoCategory[];
  videos: VideoType[];
  watchedIds: string[];
}

export function VideoTraining({ categories, videos, watchedIds }: Props) {
  const [expandedCat, setExpandedCat] = useState<string | null>(categories[0]?.id || null);
  const [activeVideo, setActiveVideo] = useState<VideoType | null>(null);
  const [watched, setWatched] = useState<Set<string>>(new Set(watchedIds));

  async function markWatched(videoId: string) {
    if (watched.has(videoId)) return;
    setWatched((prev) => new Set(prev).add(videoId));
    await fetch('/api/staff-lms/progress', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'video_watched', videoId }),
    });
  }

  if (categories.length === 0) {
    return (
      <div className="text-center py-16">
        <Video size={48} className="mx-auto text-gray-300 mb-4" />
        <p className="text-gray-500">No training videos added yet.</p>
        <p className="text-sm text-gray-400">Ask your admin to add videos.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-500">Watch and learn from curated training content.</p>

      {/* Video Player Modal */}
      {activeVideo && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-lg overflow-hidden">
            <div className="aspect-video">
              <iframe
                src={`https://www.youtube.com/embed/${extractYoutubeId(activeVideo.youtube_url)}?autoplay=1`}
                className="w-full h-full"
                allow="autoplay; encrypted-media"
                allowFullScreen
              />
            </div>
            <div className="p-4">
              <h3 className="font-bold text-gray-900">{activeVideo.title}</h3>
              {activeVideo.description && (
                <p className="text-sm text-gray-500 mt-1">{activeVideo.description}</p>
              )}
              <div className="flex gap-2 mt-4">
                <button
                  onClick={() => { markWatched(activeVideo.id); setActiveVideo(null); }}
                  className="flex-1 py-3 bg-green-600 text-white rounded-xl font-medium text-sm active:bg-green-700"
                >
                  {watched.has(activeVideo.id) ? '✓ Watched' : 'Mark as Watched (+20 XP)'}
                </button>
                <button
                  onClick={() => setActiveVideo(null)}
                  className="px-4 py-3 bg-gray-100 rounded-xl text-gray-600"
                >
                  <X size={18} />
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Categories */}
      {categories.map((cat) => {
        const catVideos = videos.filter((v) => v.category_id === cat.id);
        const isExpanded = expandedCat === cat.id;
        const watchedCount = catVideos.filter((v) => watched.has(v.id)).length;

        return (
          <div key={cat.id} className="bg-white rounded-2xl shadow-sm overflow-hidden">
            <button
              onClick={() => setExpandedCat(isExpanded ? null : cat.id)}
              className="w-full flex items-center justify-between p-4"
            >
              <div>
                <h3 className="font-semibold text-gray-900 text-sm text-left">{cat.name}</h3>
                <p className="text-xs text-gray-400 mt-0.5">
                  {catVideos.length} videos · {watchedCount} watched
                </p>
              </div>
              <ChevronDown
                size={18}
                className={`text-gray-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
              />
            </button>

            {isExpanded && catVideos.length > 0 && (
              <div className="border-t border-gray-50 divide-y divide-gray-50">
                {catVideos.map((video) => {
                  const ytId = extractYoutubeId(video.youtube_url);
                  const isWatched = watched.has(video.id);

                  return (
                    <button
                      key={video.id}
                      onClick={() => setActiveVideo(video)}
                      className="w-full flex items-center gap-3 p-3 text-left hover:bg-gray-50"
                    >
                      <div className="relative w-20 h-12 bg-gray-100 rounded-lg overflow-hidden flex-shrink-0">
                        {ytId && (
                          <img
                            src={`https://img.youtube.com/vi/${ytId}/mqdefault.jpg`}
                            alt=""
                            className="w-full h-full object-cover"
                          />
                        )}
                        <div className="absolute inset-0 flex items-center justify-center bg-black/20">
                          <Play size={16} className="text-white" fill="white" />
                        </div>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-900 truncate">{video.title}</p>
                        {video.duration_minutes && (
                          <p className="text-xs text-gray-400">{video.duration_minutes} min</p>
                        )}
                      </div>
                      {isWatched && (
                        <div className="w-6 h-6 bg-green-100 rounded-full flex items-center justify-center flex-shrink-0">
                          <Check size={14} className="text-green-600" />
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            )}

            {isExpanded && catVideos.length === 0 && (
              <p className="px-4 pb-4 text-sm text-gray-400">No videos in this category yet.</p>
            )}
          </div>
        );
      })}
    </div>
  );
}
