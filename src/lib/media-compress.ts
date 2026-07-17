// Client-side media compression before upload to Supabase Storage.
// Storage egress (downloads) is the billed quota — every WhatsApp share and list view
// re-downloads these files, so bytes saved here multiply across every future view.

const IMAGE_MAX_EDGE = 1280;
const IMAGE_SKIP_BELOW = 200 * 1024; // already small enough to not matter
const IMAGE_TARGET_BYTES = 220 * 1024; // step quality down only until we fit this budget

// WebP is ~25–35% smaller than JPEG at the same visual quality; fall back to JPEG on
// browsers that can't encode it (detected once per session).
let webpSupported: boolean | null = null;
function canEncodeWebp(): boolean {
  if (webpSupported === null) {
    try {
      webpSupported = document.createElement("canvas").toDataURL("image/webp").startsWith("data:image/webp");
    } catch {
      webpSupported = false;
    }
  }
  return webpSupported;
}

export type CompressedImage = { blob: Blob; ext: string; contentType: string };

// Downscale + re-encode an image so phone-camera photos (often 5–12 MB) land around
// 100–220 KB. Quality starts high and only steps down while the file is still over the
// byte target, so clean images keep their quality and heavy ones get squeezed harder.
// Falls back to the original file if the browser can't decode it (e.g. HEIC) — the
// server still validates type/size.
export async function compressImageFull(
  file: File,
  opts?: { maxEdge?: number; quality?: number; skipBelow?: number; targetBytes?: number }
): Promise<CompressedImage> {
  const maxEdge = opts?.maxEdge ?? IMAGE_MAX_EDGE;
  const skipBelow = opts?.skipBelow ?? IMAGE_SKIP_BELOW;
  const targetBytes = opts?.targetBytes ?? IMAGE_TARGET_BYTES;
  const original: CompressedImage = {
    blob: file,
    ext: (file.name?.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg",
    contentType: file.type,
  };
  if (!file.type.startsWith("image/")) return original;
  if (file.size < skipBelow) return original;
  try {
    const dataUrl: string = await new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result as string);
      r.onerror = reject;
      r.readAsDataURL(file);
    });
    const img: HTMLImageElement = await new Promise((resolve, reject) => {
      const im = new Image();
      im.onload = () => resolve(im);
      im.onerror = reject;
      im.src = dataUrl;
    });
    let { width, height } = img;
    if (width > maxEdge || height > maxEdge) {
      const s = maxEdge / Math.max(width, height);
      width = Math.round(width * s);
      height = Math.round(height * s);
    }
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return original;
    ctx.drawImage(img, 0, 0, width, height);

    const useWebp = canEncodeWebp();
    const type = useWebp ? "image/webp" : "image/jpeg";
    const ext = useWebp ? "webp" : "jpg";
    // Fixed-quality override keeps callers that want a specific look (e.g. listing photos).
    const ladder = opts?.quality != null ? [opts.quality] : [0.8, 0.72, 0.65, 0.58];

    let best: Blob | null = null;
    for (const q of ladder) {
      const blob: Blob | null = await new Promise((resolve) => canvas.toBlob(resolve, type, q));
      if (!blob || blob.size === 0) break;
      if (!best || blob.size < best.size) best = blob;
      if (blob.size <= targetBytes) { best = blob; break; }
    }
    if (!best || best.size >= file.size) return original;
    return { blob: best, ext, contentType: type };
  } catch {
    return original; // couldn't decode (e.g. HEIC) — upload the original and let the server validate
  }
}

// Back-compat wrapper for callers that only need the bytes.
export async function compressImage(
  file: File,
  opts?: { maxEdge?: number; quality?: number; skipBelow?: number; targetBytes?: number }
): Promise<Blob> {
  return (await compressImageFull(file, opts)).blob;
}

// If the device can't re-encode video at all, refuse originals above this — a raw phone
// clip uploaded as-is gets re-downloaded on every view and burns the egress quota.
export const MAX_UNCOMPRESSED_VIDEO_BYTES = 25 * 1024 * 1024;

const VIDEO_MAX_EDGE = 960; // long edge; keeps damage evidence legible
const VIDEO_FPS = 24; // evidence clips don't need 30fps; ~20% fewer bits for free
const AUDIO_BITS_PER_SECOND = 64_000;

// Scale bitrate to the actual output size instead of one flat number, so small/portrait
// clips aren't over-provisioned. ~0.05 bits per pixel per frame reads clean for
// handheld damage footage. 960×540@24 ≈ 620 kbps ≈ 4.7 MB/min.
function videoBitrateFor(w: number, h: number): number {
  return Math.min(800_000, Math.max(400_000, Math.round(w * h * VIDEO_FPS * 0.05)));
}

// Compress a video in the browser: downscale and re-encode at a low bitrate so a
// 200–300MB phone clip becomes single-digit MB per minute. Audio is captured via Web
// Audio (routed only to the recorder, not the speakers) so processing is silent.
// Real-time (reports progress 0..1). Throws on unsupported browsers (e.g. some iOS
// Safari) so the caller can fall back to the original.
export async function compressVideo(
  file: File,
  onProgress?: (p: number) => void
): Promise<{ blob: Blob; ext: string }> {
  const w = window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext };
  const AudioCtx = w.AudioContext || w.webkitAudioContext;
  const canvasProto = HTMLCanvasElement.prototype as unknown as { captureStream?: unknown };
  if (typeof MediaRecorder === "undefined" || typeof canvasProto.captureStream !== "function" || !AudioCtx) {
    throw new Error("Video compression isn't supported on this browser");
  }

  const video = document.createElement("video");
  video.src = URL.createObjectURL(file);
  video.muted = false;
  video.playsInline = true;
  video.preload = "auto";

  await new Promise<void>((resolve, reject) => {
    video.onloadedmetadata = () => resolve();
    video.onerror = () => reject(new Error("Could not read this video"));
  });

  const srcW = video.videoWidth || 1280;
  const srcH = video.videoHeight || 720;
  let tw = srcW, th = srcH;
  const longest = Math.max(srcW, srcH);
  if (longest > VIDEO_MAX_EDGE) { const s = VIDEO_MAX_EDGE / longest; tw = Math.round(srcW * s); th = Math.round(srcH * s); }
  tw -= tw % 2; th -= th % 2; // even dimensions
  tw = Math.max(2, tw); th = Math.max(2, th);

  const canvas = document.createElement("canvas");
  canvas.width = tw; canvas.height = th;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas unavailable");

  const cStream = (canvas as HTMLCanvasElement & { captureStream(fps?: number): MediaStream }).captureStream(VIDEO_FPS);

  // Audio: tap the element's audio into the recorder WITHOUT connecting to the speakers.
  const actx = new AudioCtx();
  const srcNode = actx.createMediaElementSource(video);
  const dest = actx.createMediaStreamDestination();
  srcNode.connect(dest);
  dest.stream.getAudioTracks().forEach((t) => cStream.addTrack(t));
  try { await actx.resume(); } catch { /* ignore */ }

  const candidates = [
    "video/mp4;codecs=h264,aac",
    "video/mp4",
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
    "video/webm",
  ];
  const mimeType = candidates.find((c) => MediaRecorder.isTypeSupported(c)) || "";
  const recorder = new MediaRecorder(cStream, {
    ...(mimeType ? { mimeType } : {}),
    videoBitsPerSecond: videoBitrateFor(tw, th),
    audioBitsPerSecond: AUDIO_BITS_PER_SECOND,
  });
  const outType = recorder.mimeType || mimeType || "video/webm";
  const ext = outType.includes("mp4") ? "mp4" : "webm";

  const chunks: BlobPart[] = [];
  recorder.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
  const finished = new Promise<Blob>((resolve) => {
    recorder.onstop = () => resolve(new Blob(chunks, { type: outType }));
  });

  let raf = 0;
  const draw = () => {
    ctx.drawImage(video, 0, 0, tw, th);
    if (video.duration && onProgress) onProgress(Math.min(0.99, video.currentTime / video.duration));
    raf = requestAnimationFrame(draw);
  };

  recorder.start(1000);
  await video.play();
  draw();

  await new Promise<void>((resolve) => { video.onended = () => resolve(); });
  cancelAnimationFrame(raf);
  if (recorder.state !== "inactive") recorder.stop();
  const blob = await finished;
  onProgress?.(1);
  try { srcNode.disconnect(); await actx.close(); } catch { /* ignore */ }
  URL.revokeObjectURL(video.src);

  // Never upload something bigger than the original.
  if (blob.size === 0 || blob.size >= file.size) {
    return { blob: file, ext: (file.name.split(".").pop() || "mp4").toLowerCase() };
  }
  return { blob, ext };
}
