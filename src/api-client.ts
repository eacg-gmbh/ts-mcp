import { logger } from "./logger.js";

export interface ApiResponse {
  status: number;
  body: unknown;
  headers: Record<string, string>;
}

export class TrustSourceClient {
  constructor(
    private baseUrl: string,
    private apiKey: string,
  ) {}

  async validateApiKey(): Promise<boolean> {
    try {
      const response = await this.request(
        "GET",
        "/account/authorization",
        {},
      );
      return response.status === 200;
    } catch {
      return false;
    }
  }

  async request(
    method: string,
    path: string,
    params: {
      query?: Record<string, string>;
      body?: unknown;
      contentType?: string;
    },
  ): Promise<ApiResponse> {
    const url = new URL(this.baseUrl.replace(/\/$/, "") + path);
    if (params.query) {
      for (const [key, value] of Object.entries(params.query)) {
        if (value !== undefined && value !== "") {
          url.searchParams.set(key, value);
        }
      }
    }

    const headers: Record<string, string> = {
      "x-api-key": this.apiKey,
      Accept: "application/json",
    };

    let bodyStr: string | undefined;
    if (params.body !== undefined) {
      headers["Content-Type"] = params.contentType ?? "application/json";
      bodyStr =
        typeof params.body === "string"
          ? params.body
          : JSON.stringify(params.body);
    }

    logger.info(`API ${method} ${path}`, {
      query: params.query,
      hasBody: bodyStr !== undefined,
    });

    const response = await fetch(url.toString(), {
      method,
      headers,
      body: bodyStr,
    });

    const responseHeaders: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      responseHeaders[key] = value;
    });

    let body: unknown;
    const contentType = response.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      body = await response.json();
    } else {
      body = await response.text();
    }

    logger.info(`API response ${response.status}`, {
      path,
      status: response.status,
    });

    return { status: response.status, body, headers: responseHeaders };
  }
}
