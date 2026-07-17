// Client-side media upload. Prefers Cloudflare R2 (zero egress cost) via a presigned
// PUT from /api/media/presign; falls back to Supabase Storage while R2 env vars are
// not configured, so the app keeps working during the migration window.
import { uploadImage as supabaseUploadImage, uploadMedia as supabaseUploadMedia } from "@/lib/supabase";

const ONE_YEAR = "public, max-age=31536000, immutable"; // paths are unique+immutable

async function uploadViaR2(blob: Blob, key: string, contentType: string): Promise<string | null> {
  const presign = await fetch("/api/media/presign", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ key, contentType, size: blob.size }),
  });
  if (presign.status === 501) return null; // R2 not configured — use the Supabase fallback
  const data = await presign.json().catch(() => null);
  if (!presign.ok || !data?.success) {
    throw new Error(data?.error || "Could not prepare the upload. Try again.");
  }
  const { uploadUrl, publicUrl } = data.data;
  const put = await fetch(uploadUrl, {
    method: "PUT",
    headers: { "Content-Type": contentType, "Cache-Control": ONE_YEAR },
    body: blob,
  });
  if (!put.ok) throw new Error(`Upload failed (${put.status}). Check your connection and try again.`);
  return publicUrl;
}

export async function uploadImage(file: File, path: string): Promise<string> {
  const url = await uploadViaR2(file, path, file.type || "image/jpeg");
  if (url) return url;
  return supabaseUploadImage(file, path);
}

export async function uploadMedia(blob: Blob, path: string, contentType?: string): Promise<string> {
  const type = contentType || (blob as File).type || "application/octet-stream";
  const url = await uploadViaR2(blob, path, type);
  if (url) return url;
  return supabaseUploadMedia(blob, path, contentType);
}
