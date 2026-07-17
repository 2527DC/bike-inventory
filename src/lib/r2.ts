// Cloudflare R2 storage (S3-compatible). R2 has ZERO egress charges, which is why media
// lives here — every WhatsApp share / list view downloads files for free.
// Server-side only: keys must never reach the browser. Browsers upload via short-lived
// presigned PUT URLs issued by /api/media/presign.
import { AwsClient } from "aws4fetch";

const ONE_YEAR = "public, max-age=31536000, immutable"; // keys are unique+immutable

function env(name: string): string | undefined {
  const v = process.env[name];
  return v && v.trim() ? v.trim() : undefined;
}

export function isR2Configured(): boolean {
  return !!(env("R2_ACCOUNT_ID") && env("R2_ACCESS_KEY_ID") && env("R2_SECRET_ACCESS_KEY") && env("R2_BUCKET") && env("R2_PUBLIC_BASE_URL"));
}

function client(): AwsClient {
  return new AwsClient({
    accessKeyId: env("R2_ACCESS_KEY_ID")!,
    secretAccessKey: env("R2_SECRET_ACCESS_KEY")!,
    service: "s3",
    region: "auto",
  });
}

function objectUrl(key: string): string {
  return `https://${env("R2_ACCOUNT_ID")}.r2.cloudflarestorage.com/${env("R2_BUCKET")}/${key.split("/").map(encodeURIComponent).join("/")}`;
}

export function r2PublicUrl(key: string): string {
  const base = env("R2_PUBLIC_BASE_URL")!.replace(/\/+$/, "");
  return `${base}/${key.split("/").map(encodeURIComponent).join("/")}`;
}

// Short-lived presigned PUT URL so the browser can upload straight to R2
// (large videos bypass the serverless request-body limit, same as before).
export async function r2PresignPut(key: string, expiresSeconds = 600): Promise<string> {
  const url = new URL(objectUrl(key));
  url.searchParams.set("X-Amz-Expires", String(expiresSeconds));
  const signed = await client().sign(new Request(url.toString(), { method: "PUT" }), {
    aws: { signQuery: true },
  });
  return signed.url;
}

// Server-side upload (small files that pass through our API, and the migration script).
export async function r2Put(key: string, body: ArrayBuffer | Buffer | Blob, contentType: string): Promise<string> {
  const res = await client().fetch(objectUrl(key), {
    method: "PUT",
    headers: { "Content-Type": contentType, "Cache-Control": ONE_YEAR },
    body: body as BodyInit,
  });
  if (!res.ok) throw new Error(`R2 upload failed (${res.status}): ${(await res.text()).slice(0, 200)}`);
  return r2PublicUrl(key);
}
