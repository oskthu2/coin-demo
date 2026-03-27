/**
 * COS (Cambio Open Services) FHIR R4 client.
 * Handles OAuth 2.0 client-credentials token refresh transparently.
 */

export interface CosClientConfig {
  fhirBaseUrl: string;
  tokenUrl: string;
  clientId: string;
  clientSecret: string;
  scope?: string;
}

interface TokenResponse {
  access_token: string;
  expires_in: number;
  token_type: string;
}

export interface FhirBundle {
  resourceType: "Bundle";
  total?: number;
  entry?: Array<{ resource: FhirResource }>;
}

export interface FhirResource {
  resourceType: string;
  id?: string;
  [key: string]: unknown;
}

export class CosClient {
  private accessToken: string | null = null;
  private tokenExpiresAt = 0;

  constructor(private readonly config: CosClientConfig) {}

  private async fetchToken(): Promise<void> {
    const body = new URLSearchParams({
      grant_type: "client_credentials",
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
    });
    if (this.config.scope) {
      body.set("scope", this.config.scope);
    }

    const res = await fetch(this.config.tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });

    if (!res.ok) {
      throw new Error(`COS auth failed (${res.status}): ${await res.text()}`);
    }

    const data = (await res.json()) as TokenResponse;
    this.accessToken = data.access_token;
    // Refresh 30 s before actual expiry
    this.tokenExpiresAt = Date.now() + (data.expires_in - 30) * 1000;
  }

  private async getToken(): Promise<string> {
    if (!this.accessToken || Date.now() >= this.tokenExpiresAt) {
      await this.fetchToken();
    }
    return this.accessToken!;
  }

  /** Issue a FHIR GET request, auto-refreshing the bearer token as needed. */
  async fhirGet<T = FhirBundle>(
    resourcePath: string,
    params?: Record<string, string>
  ): Promise<T> {
    const token = await this.getToken();
    const base = this.config.fhirBaseUrl.replace(/\/$/, "");
    const url = new URL(`${base}/${resourcePath.replace(/^\//, "")}`);

    if (params) {
      for (const [k, v] of Object.entries(params)) {
        url.searchParams.append(k, v);
      }
    }

    const res = await fetch(url.toString(), {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/fhir+json",
      },
    });

    if (!res.ok) {
      throw new Error(
        `FHIR GET ${resourcePath} failed (${res.status}): ${await res.text()}`
      );
    }

    return res.json() as Promise<T>;
  }

  /** POST a FHIR resource (for setup / synthetic-data scripts). */
  async fhirPost<T = FhirResource>(
    resourceType: string,
    body: object
  ): Promise<T> {
    const token = await this.getToken();
    const base = this.config.fhirBaseUrl.replace(/\/$/, "");
    const res = await fetch(`${base}/${resourceType}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/fhir+json",
        Accept: "application/fhir+json",
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      throw new Error(
        `FHIR POST ${resourceType} failed (${res.status}): ${await res.text()}`
      );
    }

    return res.json() as Promise<T>;
  }
}

/** Build a CosClient from environment variables. */
export function cosClientFromEnv(): CosClient {
  const required = (name: string): string => {
    const v = process.env[name];
    if (!v) throw new Error(`Missing required env var: ${name}`);
    return v;
  };

  return new CosClient({
    fhirBaseUrl: required("COS_FHIR_BASE_URL"),
    tokenUrl: required("COS_TOKEN_URL"),
    clientId: required("COS_CLIENT_ID"),
    clientSecret: required("COS_CLIENT_SECRET"),
    scope: process.env["COS_SCOPE"],
  });
}
