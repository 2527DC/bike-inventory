// AWS S3 provider.
//
// This is a direct descendant of the old src/lib/r2.ts: R2 was already S3-compatible, so
// aws4fetch and SigV4 signing carry over unchanged. Only two things actually differ from
// the R2 version — the endpoint host, and a real region instead of "auto".
//
// Server-side only. Keys must never reach the browser; the browser uploads via short-lived
// presigned PUT URLs issued by /api/media/presign.
import { AwsClient } from "aws4fetch";
import { createLogger } from "@/lib/logger";
import {
  IMMUTABLE_CACHE_CONTROL,
  type StorageProvider,
  type StorageSettings,
} from "./types";

const log = createLogger("storage:s3");

export class S3Provider implements StorageProvider {
  readonly key = "S3" as const;

  private client: AwsClient;
  private bucket: string;
  private region: string;
  private base: string;

  constructor(private settings: StorageSettings) {
    const { bucket, region, accessKeyId, secretAccessKey } = settings;
    if (!bucket || !region || !accessKeyId || !secretAccessKey) {
      throw new Error("S3 storage is missing bucket, region, accessKeyId or secretAccessKey");
    }
    this.bucket = bucket;
    this.region = region;
    this.client = new AwsClient({ accessKeyId, secretAccessKey, service: "s3", region });
    // publicBaseUrl is what gets STORED in the database with every file, so prefer it: it
    // lets CloudFront (or any custom domain) be put in front later without rewriting a
    // single row. Falling back to the bucket endpoint keeps things working before then.
    this.base = (settings.publicBaseUrl || this.bucketEndpoint()).replace(/\/+$/, "");
  }

  private bucketEndpoint(): string {
    return `https://${this.bucket}.s3.${this.region}.amazonaws.com`;
  }

  /** The signing target. Always the real bucket endpoint, never the CDN alias. */
  private objectUrl(key: string): string {
    return `${this.bucketEndpoint()}/${encodeKey(key)}`;
  }

  publicUrl(key: string): string {
    return `${this.base}/${encodeKey(key)}`;
  }

  keyFromUrl(url: string): string | null {
    if (!url) return null;
    // Accept either the CDN alias or the raw bucket endpoint — a file stored before a
    // custom domain was configured still has to be deletable afterwards.
    for (const prefix of [this.base, this.bucketEndpoint()]) {
      const p = prefix.replace(/\/+$/, "") + "/";
      if (url.startsWith(p)) {
        const raw = url.slice(p.length).split("?")[0];
        return raw ? decodeKey(raw) : null;
      }
    }
    return null;
  }

  async presignPut(key: string, _contentType: string, expiresSeconds = 600): Promise<string> {
    const url = new URL(this.objectUrl(key));
    url.searchParams.set("X-Amz-Expires", String(expiresSeconds));
    const signed = await this.client.sign(new Request(url.toString(), { method: "PUT" }), {
      aws: { signQuery: true },
    });
    log.debug("presigned PUT issued", { key, expiresSeconds });
    return signed.url;
  }

  async put(key: string, body: ArrayBuffer | Buffer | Blob, contentType: string): Promise<string> {
    log.debug("-> PUT object", { key, contentType });
    const res = await this.client.fetch(this.objectUrl(key), {
      method: "PUT",
      headers: { "Content-Type": contentType, "Cache-Control": IMMUTABLE_CACHE_CONTROL },
      body: body as BodyInit,
    });
    if (!res.ok) {
      const detail = (await res.text()).slice(0, 200);
      log.error("S3 upload failed", { key, status: res.status });
      throw new Error(`S3 upload failed (${res.status}): ${detail}`);
    }
    return this.publicUrl(key);
  }

  async exists(key: string): Promise<boolean> {
    const res = await this.client.fetch(this.objectUrl(key), { method: "HEAD" });
    return res.ok;
  }

  async delete(key: string): Promise<void> {
    const res = await this.client.fetch(this.objectUrl(key), { method: "DELETE" });
    // S3 answers 204 whether or not the object was there. A 404 is equally fine: a caller
    // retrying a delete must not see a failure.
    if (!res.ok && res.status !== 404) {
      const detail = (await res.text()).slice(0, 200);
      log.error("S3 delete failed", { key, status: res.status });
      throw new Error(`S3 delete failed (${res.status}): ${detail}`);
    }
  }

  /**
   * Apply the CORS policy that browser presigned uploads require.
   *
   * Without this every direct upload dies at the preflight, and the browser reports it as
   * an opaque network error rather than anything that names CORS — which is exactly why
   * this is offered as a button instead of a documentation step.
   *
   * Needs s3:PutBucketCors on the IAM user. If that grant is absent this throws, and the
   * UI falls back to showing the policy for the user to paste into the console.
   */
  async applyCors(allowedOrigin: string): Promise<void> {
    const xml =
      `<?xml version="1.0" encoding="UTF-8"?>` +
      `<CORSConfiguration><CORSRule>` +
      `<AllowedOrigin>${escapeXml(allowedOrigin)}</AllowedOrigin>` +
      `<AllowedMethod>GET</AllowedMethod>` +
      `<AllowedMethod>PUT</AllowedMethod>` +
      `<AllowedMethod>HEAD</AllowedMethod>` +
      `<AllowedHeader>*</AllowedHeader>` +
      `<ExposeHeader>ETag</ExposeHeader>` +
      `<MaxAgeSeconds>86400</MaxAgeSeconds>` +
      `</CORSRule></CORSConfiguration>`;

    log.debug("-> PUT bucket CORS", { bucket: this.bucket, allowedOrigin });
    const res = await this.client.fetch(`${this.bucketEndpoint()}/?cors`, {
      method: "PUT",
      headers: { "Content-Type": "application/xml" },
      body: xml,
    });
    if (!res.ok) {
      const detail = (await res.text()).slice(0, 300);
      log.error("CORS policy could not be applied", { status: res.status });
      throw new Error(`Could not apply the CORS policy (${res.status}): ${detail}`);
    }
    log.info("bucket CORS policy applied", { bucket: this.bucket });
  }
}

/** Encode each path segment but keep the slashes — the key's shape is part of its identity. */
function encodeKey(key: string): string {
  return key.split("/").map(encodeURIComponent).join("/");
}

function decodeKey(key: string): string {
  return key.split("/").map(decodeURIComponent).join("/");
}

function escapeXml(s: string): string {
  return s.replace(/[<>&"']/g, (c) =>
    ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" })[c] as string
  );
}
