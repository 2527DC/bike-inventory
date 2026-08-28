// Server filesystem provider.
//
// Intended for a VPS or a container with a mounted volume. It is NOT usable on Vercel,
// where the filesystem is read-only apart from /tmp and /tmp is wiped between invocations —
// an uploaded photo would vanish before anyone could view it. `probeWritable()` exists so
// that failure is loud at configuration time instead of silent at upload time.
//
// Keys are stored with the same shape they would have in a bucket ("vendor-issues/x.webp"),
// so moving to S3 later is a file copy with no key rewriting and no URL surgery.
import { promises as fs } from "fs";
import path from "path";
import { createLogger } from "@/lib/logger";
import type { StorageProvider, StorageSettings } from "./types";

const log = createLogger("storage:local");

export const DEFAULT_LOCAL_DIR = ".storage";

/** Files are served back through this route, never straight off disk. */
const SERVE_PREFIX = "/api/media";

export class LocalProvider implements StorageProvider {
  readonly key = "LOCAL" as const;

  private root: string;

  constructor(settings: StorageSettings) {
    // turbopackIgnore keeps the bundler from treating this dynamic path as a reason to
    // trace the entire project into the serverless bundle. The directory is deliberately
    // free-form — a VPS deployment points it at a mounted volume like /var/lib/bch-media —
    // so it cannot be statically scoped to a subfolder of cwd.
    this.root = path.resolve(/*turbopackIgnore: true*/ settings.localDir?.trim() || DEFAULT_LOCAL_DIR);
  }

  /**
   * Resolve a key to an absolute path, refusing anything that escapes the root.
   *
   * This is the security boundary of this provider. A key like "../../.env" would otherwise
   * read or overwrite arbitrary files, and keys reach us from request bodies.
   */
  private resolveKey(key: string): string {
    const full = path.resolve(this.root, key);
    const bounded = this.root.endsWith(path.sep) ? this.root : this.root + path.sep;
    if (full !== this.root && !full.startsWith(bounded)) {
      log.error("rejected key escaping the storage root", { key });
      throw new Error("Invalid storage key");
    }
    return full;
  }

  publicUrl(key: string): string {
    return `${SERVE_PREFIX}/${key.split("/").map(encodeURIComponent).join("/")}`;
  }

  keyFromUrl(url: string): string | null {
    if (!url) return null;
    // Accept the relative form we issue, and the absolute form if a full origin was stored.
    const idx = url.indexOf(`${SERVE_PREFIX}/`);
    if (idx === -1) return null;
    const raw = url.slice(idx + SERVE_PREFIX.length + 1).split("?")[0];
    if (!raw) return null;
    return raw.split("/").map(decodeURIComponent).join("/");
  }

  /** No externally reachable endpoint — the browser must post through the API instead. */
  async presignPut(): Promise<null> {
    return null;
  }

  async put(key: string, body: ArrayBuffer | Buffer | Blob, _contentType: string): Promise<string> {
    const full = this.resolveKey(key);
    await fs.mkdir(path.dirname(full), { recursive: true });

    const buf =
      body instanceof Buffer
        ? body
        : body instanceof ArrayBuffer
          ? Buffer.from(body)
          : Buffer.from(await (body as Blob).arrayBuffer());

    await fs.writeFile(full, buf);
    log.debug("wrote file", { key, bytes: buf.byteLength });
    return this.publicUrl(key);
  }

  async exists(key: string): Promise<boolean> {
    try {
      await fs.access(this.resolveKey(key));
      return true;
    } catch {
      // Absent, or unreadable. Either way the caller's question — "can I read this back?" —
      // is answered no. Not logged as an error: the connection test calls this expecting
      // both outcomes.
      return false;
    }
  }

  async delete(key: string): Promise<void> {
    try {
      await fs.unlink(this.resolveKey(key));
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      if (code === "ENOENT") return; // already gone — a retried delete must not fail
      log.error("local delete failed", { key, code });
      throw e;
    }
  }

  /** Read a file back for the serving route. Returns null when it is not there. */
  async read(key: string): Promise<Buffer | null> {
    try {
      return await fs.readFile(this.resolveKey(key));
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      if (code === "ENOENT" || code === "EISDIR") return null;
      log.error("local read failed", { key, code });
      throw e;
    }
  }

  /**
   * Prove the root is actually writable, by writing and removing a probe file.
   *
   * On Vercel this fails with EROFS or EACCES, which is the whole point: the provider
   * refuses to activate rather than accepting uploads it cannot keep.
   */
  async probeWritable(): Promise<{ ok: boolean; reason?: string }> {
    const probe = `.write-probe-${Date.now()}`;
    try {
      await fs.mkdir(this.root, { recursive: true });
      const full = this.resolveKey(probe);
      await fs.writeFile(full, "ok");
      await fs.unlink(full);
      return { ok: true };
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      const reason =
        code === "EROFS" || code === "EACCES" || code === "EPERM"
          ? `The filesystem at ${this.root} is not writable (${code}). This is expected on Vercel, where only /tmp is writable and it is wiped between requests. Use S3 here, or deploy to a VPS or container with a mounted volume.`
          : `Could not write to ${this.root}: ${e instanceof Error ? e.message : String(e)}`;
      log.warn("local storage root is not writable", { root: this.root, code });
      return { ok: false, reason };
    }
  }

  get rootDir(): string {
    return this.root;
  }
}
