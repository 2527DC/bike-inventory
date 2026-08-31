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
   * The origins the bucket currently allows, or null when that cannot be determined.
   *
   * `null` and `[]` are different answers and callers must not conflate them: `[]` means
   * S3 answered and the bucket allows nothing (404 NoSuchCORSConfiguration — the state a
   * fresh bucket is in), while `null` means we were not allowed to look (no
   * s3:GetBucketCors) and know nothing either way. Reporting "no CORS configured" for the
   * second case would send someone to fix a bucket that may be perfectly fine.
   *
   * Origins are parsed with a regex rather than an XML parser on purpose: the response is
   * a fixed, machine-generated shape from S3, and this file has no XML dependency.
   */
  async readCorsOrigins(): Promise<string[] | null> {
    const res = await this.client.fetch(`${this.bucketEndpoint()}/?cors`, { method: "GET" });

    if (res.status === 404) {
      log.debug("bucket has no CORS configuration", { bucket: this.bucket });
      return [];
    }
    if (!res.ok) {
      log.warn("could not read the bucket CORS policy", { bucket: this.bucket, status: res.status });
      return null;
    }

    const xml = await res.text();
    const origins = [...xml.matchAll(/<AllowedOrigin>([^<]*)<\/AllowedOrigin>/g)].map((m) => m[1]);
    log.debug("bucket CORS read", { bucket: this.bucket, origins: origins.length });
    return origins;
  }

  /**
   * Allow `origins` to upload to this bucket from a browser.
   *
   * Without a matching rule every presigned PUT dies at the preflight, and the browser
   * reports it as an opaque network error rather than anything that names CORS — which is
   * exactly why this is offered as a button instead of a documentation step.
   *
   * **Merges rather than replaces.** The first version wrote one rule with one origin, so
   * applying it from localhost silently revoked production's access, and applying it from
   * production revoked localhost's. Whoever clicked last won and the other environment
   * started failing with the same unreadable network error. The union of what the bucket
   * already allows and what is passed in is written back as a single rule; that rule's
   * methods and headers are a superset of what a browser upload needs.
   *
   * Needs s3:PutBucketCors (and s3:GetBucketCors to merge; without it the existing origins
   * cannot be read and only `origins` survives). If PutBucketCors is absent this throws,
   * and the UI falls back to showing the policy for the user to paste into the console.
   *
   * @returns every origin the bucket allows after the write.
   */
  async applyCors(origins: string[]): Promise<string[]> {
    const existing = (await this.readCorsOrigins()) ?? [];
    const merged = [...new Set([...existing, ...origins.filter(Boolean)])];

    const xml =
      `<?xml version="1.0" encoding="UTF-8"?>` +
      `<CORSConfiguration><CORSRule>` +
      merged.map((o) => `<AllowedOrigin>${escapeXml(o)}</AllowedOrigin>`).join("") +
      `<AllowedMethod>GET</AllowedMethod>` +
      `<AllowedMethod>PUT</AllowedMethod>` +
      `<AllowedMethod>HEAD</AllowedMethod>` +
      `<AllowedHeader>*</AllowedHeader>` +
      `<ExposeHeader>ETag</ExposeHeader>` +
      `<MaxAgeSeconds>86400</MaxAgeSeconds>` +
      `</CORSRule></CORSConfiguration>`;

    log.debug("-> PUT bucket CORS", { bucket: this.bucket, origins: merged.length });
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
    log.info("bucket CORS policy applied", { bucket: this.bucket, origins: merged.length });
    return merged;
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
