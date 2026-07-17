export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { requireAuth, AuthError } from "@/lib/auth-helpers";
import { createClient } from "@supabase/supabase-js";
import { isR2Configured, r2Put } from "@/lib/r2";

export async function POST(req: NextRequest) {
  try {
    await requireAuth();
    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    if (!file) return errorResponse("No file provided", 400);

    // Validate file type
    if (!file.type.startsWith("image/")) {
      return errorResponse("Only image files are allowed", 400);
    }

    // Max 5MB
    if (file.size > 5 * 1024 * 1024) {
      return errorResponse("File too large (max 5MB)", 400);
    }

    const ext = file.name.split(".").pop() || "jpg";
    const path = `vendor-issues/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;

    if (isR2Configured()) {
      const publicUrl = await r2Put(path, Buffer.from(await file.arrayBuffer()), file.type);
      return successResponse({ url: publicUrl }, 201);
    }

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !key) return errorResponse("Storage not configured", 500);

    const supabase = createClient(url, key);

    const buffer = Buffer.from(await file.arrayBuffer());
    const { data, error } = await supabase.storage
      .from("product images")
      .upload(path, buffer, {
        contentType: file.type,
        cacheControl: "31536000", // paths are unique+immutable — cache for a year to cut storage egress
      });

    if (error) return errorResponse(`Upload failed: ${error.message}`, 500);

    const { data: urlData } = supabase.storage
      .from("product images")
      .getPublicUrl(data.path);

    return successResponse({ url: urlData.publicUrl }, 201);
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    return errorResponse(error instanceof Error ? error.message : "Upload failed", 500);
  }
}
