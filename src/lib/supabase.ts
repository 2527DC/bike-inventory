import { createClient, SupabaseClient } from '@supabase/supabase-js';

let _supabase: SupabaseClient | null = null;

function getSupabase(): SupabaseClient {
  if (!_supabase) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !key) throw new Error("Supabase not configured. Add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.");
    _supabase = createClient(url, key);
  }
  return _supabase;
}

export async function uploadImage(file: File, path: string): Promise<string> {
  const supabase = getSupabase();
  const { data, error } = await supabase.storage
    .from('product images')
    .upload(path, file, { cacheControl: '31536000' }); // paths are unique+immutable — cache for a year to cut storage egress
  if (error) throw new Error(`Upload failed: ${error.message}`);
  const { data: urlData } = supabase.storage
    .from('product images')
    .getPublicUrl(data.path);
  return urlData.publicUrl;
}

// Generic media upload (images or videos). Uploads straight from the browser to Supabase Storage,
// so large video files bypass the serverless request-body limit. Returns the public URL.
export async function uploadMedia(file: Blob, path: string, contentType?: string): Promise<string> {
  const supabase = getSupabase();
  const { data, error } = await supabase.storage
    .from('product images')
    .upload(path, file, { cacheControl: '31536000', contentType: contentType || (file as File).type || undefined });
  if (error) throw new Error(`Upload failed: ${error.message}`);
  const { data: urlData } = supabase.storage
    .from('product images')
    .getPublicUrl(data.path);
  return urlData.publicUrl;
}
