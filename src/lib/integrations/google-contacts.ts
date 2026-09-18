// Google Contacts (People API) — the shop's one Google account (plan 1709, R44, P14, P14a–d).
//
// ─── WHY THIS IS NOT `IntegrationClient` ──────────────────────────────────────────────────
//
// `src/lib/integrations/base.ts` is the ZOHO family: one accounts host, one `organization_id`
// query parameter on every call, one `{ code, message }` envelope. Google shares none of that —
// different token host, bearer auth, no organisation id, plain REST errors — so inheriting it
// would mean overriding every method it provides. What IS copied, deliberately and line for
// line in spirit, is the part that matters: credentials live in `IntegrationConfig`, the access
// token is reused while it has more than five minutes left, a refusal stamps `lastAuthErrorAt`
// so a dead connection cannot keep a green badge, and every response goes through `readJson()`.
//
// ─── SECRETS ──────────────────────────────────────────────────────────────────────────────
//
// No token, code or secret is ever logged — not even truncated. Log lines carry the endpoint,
// the status and a count. `IntegrationConfig` stores the secret in plaintext, matching Zoho and
// StorageConfig: a deliberate, recorded trade-off, not an oversight.
//
// ─── SETUP ────────────────────────────────────────────────────────────────────────────────
//
// The one-time Cloud Console steps are in the plan, §3.9a. The redirect URI must match exactly:
//   <app origin>/api/integrations/google-contacts/callback

import { prisma } from "@/lib/db";
import { readJson } from "@/lib/http-json";
import { createLogger } from "@/lib/logger";
import { bare10 } from "@/lib/phone";

const log = createLogger("integrations:google-contacts");

/** The `IntegrationConfig.provider` row this module owns. */
export const GOOGLE_CONTACTS_PROVIDER = "google_contacts";

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const PEOPLE_BASE = "https://people.googleapis.com/v1";

/**
 * The ONE scope this needs: read and write the account's own contacts. Deliberately not
 * `contacts.readonly` (we create) and deliberately not the profile scopes — the account's email
 * address is a nicety for the settings card, not a reason to ask for more access than the job
 * needs. See `fetchAccountEmail` for how the label is filled in without it.
 */
export const GOOGLE_CONTACTS_SCOPE = "https://www.googleapis.com/auth/contacts";

/** The group every customer this app creates is put into (P14b). */
export const CONTACT_GROUP_NAME = "BCH Customers";

/**
 * The httpOnly cookie carrying the CSRF `state` between the connect route and the callback.
 *
 * It lives HERE rather than being exported from the connect route: a Next route module may only
 * export the handlers and the known segment options, so an extra export from `route.ts` fails the
 * build's route-type check.
 */
export const OAUTH_STATE_COOKIE = "gc_oauth_state";

interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  token_type?: string;
  error?: string;
  error_description?: string;
}

export interface GoogleContactsStatus {
  connected: boolean;
  clientId: string | null;
  hasClientSecret: boolean;
  accountEmail: string | null;
  lastSyncAt: string | null;
  lastAuthErrorAt: string | null;
}

/** The consent URL the Connect button sends the admin to. `state` is the CSRF guard. */
export function googleConsentUrl(clientId: string, redirectUri: string, state: string): string {
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: GOOGLE_CONTACTS_SCOPE,
    // offline + consent: without BOTH, a second connect from an account that has already granted
    // this app returns no refresh token, and the integration silently dies an hour later.
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state,
  });
  return `${AUTH_URL}?${params.toString()}`;
}

/** The redirect URI for this deployment, derived from the request so it matches what Google saw. */
export function googleRedirectUri(origin: string): string {
  return `${origin.replace(/\/$/, "")}/api/integrations/google-contacts/callback`;
}

async function postToken(body: URLSearchParams, what: string): Promise<TokenResponse> {
  const started = Date.now();
  log.debug(`-> Google ${what}`, { endpoint: "/token" });
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  // readJson, never res.json(): a Google outage or a WAF page answers HTML, and raw .json()
  // turns that into "Unexpected token '<'" with no clue which call produced it.
  return readJson<TokenResponse>(res, {
    service: `Google (${what})`,
    endpoint: "/token",
    ms: Date.now() - started,
  });
}

/** Exchange the one-time authorization code for an access + refresh token pair. */
export async function exchangeGoogleCode(
  clientId: string,
  clientSecret: string,
  code: string,
  redirectUri: string
): Promise<{ accessToken: string; refreshToken: string; expiresIn: number }> {
  const data = await postToken(
    new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
    "code exchange"
  );

  if (data.error || !data.access_token) {
    log.error("google code exchange rejected", { error: data.error });
    throw new Error(
      data.error === "invalid_grant"
        ? "Google refused that sign-in. Start Connect again — the code is single-use and expires in minutes."
        : data.error_description || data.error || "Google did not return an access token."
    );
  }
  if (!data.refresh_token) {
    // Without a refresh token the connection dies in an hour and nothing says why.
    log.error("google returned no refresh token");
    throw new Error(
      "Google did not return a refresh token. Remove this app at myaccount.google.com → Security → Third-party access, then Connect again."
    );
  }

  log.info("google contacts connected");
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresIn: data.expires_in ?? 3600,
  };
}

/** The saved row, or null when Google Contacts has never been set up. */
async function loadConfig() {
  return prisma.integrationConfig.findUnique({ where: { provider: GOOGLE_CONTACTS_PROVIDER } });
}

export async function googleContactsStatus(): Promise<GoogleContactsStatus> {
  const cfg = await loadConfig();
  return {
    connected: !!cfg?.isConnected && !!cfg.refreshToken,
    clientId: cfg?.clientId ?? null,
    // The secret is NEVER sent to the browser; this is the signal that one is stored, so the
    // field can say "leave blank to keep" rather than forcing a re-type of a value nobody can read.
    hasClientSecret: !!cfg?.clientSecret,
    accountEmail: cfg?.organizationName ?? null,
    lastSyncAt: cfg?.lastSyncAt?.toISOString() ?? null,
    lastAuthErrorAt: cfg?.lastAuthErrorAt?.toISOString() ?? null,
  };
}

/**
 * The People API client. `create()` answers null when the integration is not connected — that is
 * a normal state, not an error, and every caller treats it as "skip".
 */
export class GoogleContactsClient {
  private accessToken: string;
  /** Resolved once per client, then reused across every contact in one sync run. */
  private groupResourceName: string | null = null;
  private warmedUp = false;

  private constructor(accessToken: string) {
    this.accessToken = accessToken;
  }

  static async create(): Promise<GoogleContactsClient | null> {
    const cfg = await loadConfig();
    if (!cfg || !cfg.isConnected || !cfg.refreshToken || !cfg.clientId || !cfg.clientSecret) {
      log.debug("google contacts not connected");
      return null;
    }

    // Reuse the stored token while it has more than five minutes left, so a sync of 200 customers
    // does not refresh 200 times — and so a token cannot expire midway through one.
    if (cfg.accessToken && cfg.accessTokenExpiresAt) {
      if (new Date(cfg.accessTokenExpiresAt).getTime() - 5 * 60 * 1000 > Date.now()) {
        return new GoogleContactsClient(cfg.accessToken);
      }
    }

    const data = await postToken(
      new URLSearchParams({
        refresh_token: cfg.refreshToken,
        client_id: cfg.clientId,
        client_secret: cfg.clientSecret,
        grant_type: "refresh_token",
      }),
      "token refresh"
    );

    if (data.error || !data.access_token) {
      log.error("google token refresh rejected", { error: data.error });
      // Record WHEN the refusal happened, exactly as the Zoho client does: `isConnected` is only
      // written by a successful connect, so without this a revoked grant keeps a green badge
      // while every sync quietly reports "not connected".
      try {
        await prisma.integrationConfig.update({
          where: { provider: GOOGLE_CONTACTS_PROVIDER },
          data: { lastAuthErrorAt: new Date() },
        });
      } catch (e) {
        log.error("could not record lastAuthErrorAt", {
          message: e instanceof Error ? e.message : String(e),
        });
      }
      return null;
    }

    const expiresAt = new Date(Date.now() + (data.expires_in ?? 3600) * 1000);
    await prisma.integrationConfig.update({
      where: { provider: GOOGLE_CONTACTS_PROVIDER },
      data: {
        accessToken: data.access_token,
        accessTokenExpiresAt: expiresAt,
        // Cleared on every success: a warning that survives a reconnect becomes furniture.
        lastAuthErrorAt: null,
      },
    });
    log.info("google access token refreshed");
    return new GoogleContactsClient(data.access_token);
  }

  private async call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const started = Date.now();
    log.debug(`-> Google People ${method} ${path.split("?")[0]}`, {
      ...(body ? { bytes: JSON.stringify(body).length } : {}),
    });
    const res = await fetch(`${PEOPLE_BASE}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        "Content-Type": "application/json",
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const ms = Date.now() - started;

    if (!res.ok) {
      const data = await readJson<{ error?: { message?: string; status?: string } }>(res, {
        service: "Google People API",
        endpoint: path.split("?")[0],
        ms,
      }).catch(() => ({ error: undefined }));
      const message = data.error?.message || `Google People API returned ${res.status}`;
      log.warn(`<- Google People ${path.split("?")[0]} ${res.status}`, { ms, status: data.error?.status });
      throw new Error(message);
    }

    return readJson<T>(res, { service: "Google People API", endpoint: path.split("?")[0], ms });
  }

  /**
   * The account's email, for the settings card. BEST EFFORT — the `contacts` scope alone does not
   * grant the profile, so this is expected to fail on a minimal consent and simply returns null.
   * The card then shows whatever label the admin typed. Never let a label break a connection.
   */
  async accountEmail(): Promise<string | null> {
    try {
      const me = await this.call<{ emailAddresses?: Array<{ value?: string; metadata?: { primary?: boolean } }> }>(
        "GET",
        "/people/me?personFields=emailAddresses"
      );
      const list = me.emailAddresses ?? [];
      return list.find((e) => e.metadata?.primary)?.value ?? list[0]?.value ?? null;
    } catch (error) {
      log.debug("account email not readable with this scope", {
        message: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  /**
   * Google requires a WARM-UP search before the first real one: `people:searchContacts` builds a
   * per-account index on an empty query and returns nothing useful until it has. Skipping it is
   * why "the contact exists but the sync created a duplicate" happens.
   */
  private async warmUp(): Promise<void> {
    if (this.warmedUp) return;
    try {
      await this.call("GET", "/people:searchContacts?query=&readMask=names");
    } catch (error) {
      // A failed warm-up is not fatal; the search may still answer. Recorded, not thrown.
      log.warn("search warm-up failed", {
        message: error instanceof Error ? error.message : String(error),
      });
    }
    this.warmedUp = true;
  }

  /**
   * Find an existing contact by phone number (P14b). Returns its `resourceName`, or null.
   *
   * Searches on the ten digits, because a contact saved as `98765 43210`, `+91 9876543210` or
   * `09876543210` is the same human, and Google's search matches on the stored text.
   */
  async findContactByPhone(phone: string): Promise<string | null> {
    const digits = bare10(phone) ?? phone.replace(/\D/g, "");
    if (!digits) return null;
    await this.warmUp();

    const data = await this.call<{
      results?: Array<{ person?: { resourceName?: string; phoneNumbers?: Array<{ value?: string }> } }>;
    }>("GET", `/people:searchContacts?query=${encodeURIComponent(digits)}&readMask=names,phoneNumbers`);

    for (const r of data.results ?? []) {
      const match = (r.person?.phoneNumbers ?? []).some((p) => (p.value ?? "").replace(/\D/g, "").endsWith(digits));
      if (match && r.person?.resourceName) return r.person.resourceName;
    }
    return null;
  }

  /** The "BCH Customers" group, created on first use. Resolved once per client. */
  async ensureContactGroup(name = CONTACT_GROUP_NAME): Promise<string | null> {
    if (this.groupResourceName) return this.groupResourceName;
    try {
      const list = await this.call<{
        contactGroups?: Array<{ name?: string; formattedName?: string; resourceName?: string }>;
      }>("GET", "/contactGroups?pageSize=200");
      const found = (list.contactGroups ?? []).find(
        (g) => (g.formattedName ?? g.name)?.toLowerCase() === name.toLowerCase()
      );
      if (found?.resourceName) {
        this.groupResourceName = found.resourceName;
        return found.resourceName;
      }

      const created = await this.call<{ resourceName?: string }>("POST", "/contactGroups", {
        contactGroup: { name },
      });
      this.groupResourceName = created.resourceName ?? null;
      log.info("contact group created", { group: name });
      return this.groupResourceName;
    } catch (error) {
      // The group is organisation, not identity: a contact without it is still saved and still
      // syncs to every phone. Refusing the whole sync over a folder would be the wrong trade.
      log.warn("could not resolve the contact group", {
        group: name,
        message: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  /** Create one contact (P14b) and return its `resourceName`. */
  async createContact(input: {
    name: string;
    phone: string;
    alternatePhone?: string | null;
    note?: string | null;
    groupResourceName?: string | null;
  }): Promise<string> {
    const phoneNumbers = [{ value: input.phone, type: "mobile" }];
    if (input.alternatePhone && input.alternatePhone !== input.phone) {
      phoneNumbers.push({ value: input.alternatePhone, type: "other" });
    }

    const body: Record<string, unknown> = {
      names: [{ unstructuredName: input.name }],
      phoneNumbers,
      ...(input.note ? { biographies: [{ value: input.note, contentType: "TEXT_PLAIN" }] } : {}),
      ...(input.groupResourceName
        ? { memberships: [{ contactGroupMembership: { contactGroupResourceName: input.groupResourceName } }] }
        : {}),
    };

    const created = await this.call<{ resourceName?: string }>(
      "POST",
      "/people:createContact?personFields=names,phoneNumbers",
      body
    );
    if (!created.resourceName) throw new Error("Google created the contact but returned no id.");
    return created.resourceName;
  }
}
