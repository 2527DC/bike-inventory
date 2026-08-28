// Zakya POS.
//
// This subclass declares nothing but its identity and its base URL. Every method it needs —
// bills, invoices and customer payments — is shared, which is precisely the point: the
// former zakya.ts was 369 lines of which none were unique behaviour.
import { IntegrationClient, type ProviderKey } from "./base";

export class ZakyaClient extends IntegrationClient {
  protected readonly provider: ProviderKey = "ZAKYA_POS";
  protected readonly apiBase = "https://api.zakya.in/inventory/v1";
}
