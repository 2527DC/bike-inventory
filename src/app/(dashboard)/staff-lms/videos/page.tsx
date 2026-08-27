import { prisma } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth';
import { VideoTraining } from './video-training';

export default async function VideosPage() {
  const user = await getCurrentUser();

  const [categories, videos, progress] = await Promise.all([
    prisma.lmsVideoCategory.findMany({ orderBy: { sortOrder: 'asc' } }),
    prisma.lmsVideo.findMany({ where: { isActive: true }, orderBy: { sortOrder: 'asc' } }),
    prisma.lmsProgress.findUnique({ where: { userId: user!.id }, select: { videosWatched: true } }),
  ]);

  const serializedCats = categories.map((c) => ({
    id: c.id,
    name: c.name,
    description: c.description,
    sort_order: c.sortOrder,
    created_at: c.createdAt.toISOString(),
  }));

  const serializedVids = videos.map((v) => ({
    id: v.id,
    title: v.title,
    description: v.description,
    youtube_url: v.youtubeUrl,
    category_id: v.categoryId,
    duration_minutes: v.durationMinutes,
    sort_order: v.sortOrder,
    is_active: v.isActive,
    created_at: v.createdAt.toISOString(),
  }));

  return (
    <VideoTraining
      categories={serializedCats as any[]}
      videos={serializedVids as any[]}
      watchedIds={progress?.videosWatched || []}
    />
  );
}
