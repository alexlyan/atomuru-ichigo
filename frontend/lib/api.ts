"use client";

import { useCallback, useEffect, useState } from "react";

export class ApiError extends Error {
  status: number;
  detail: unknown;

  constructor(status: number, message: string, detail: unknown) {
    super(message);
    this.status = status;
    this.detail = detail;
  }
}

export function timeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

type ValidationError = { loc?: (string | number)[]; msg?: string };

function messageFrom(status: number, body: unknown): string {
  const detail = (body as { detail?: unknown } | null)?.detail;
  if (typeof detail === "string") return detail;
  if (detail && typeof detail === "object" && !Array.isArray(detail)) {
    const msg = (detail as { message?: unknown }).message;
    if (typeof msg === "string") return msg;
  }
  if (Array.isArray(detail)) {
    return detail
      .map((e: ValidationError) => {
        const field = (e.loc ?? []).filter((p) => p !== "body").join(".");
        const msg = (e.msg ?? "is not valid").replace(/^Value error, /, "");
        return field ? `${field}: ${msg}` : msg;
      })
      .join(". ");
  }
  if (status >= 500) {
    return "The Ichigo server did not answer. Check that the backend is running on port 8000, then try again.";
  }
  if (status === 404) return "Not found. It may have been deleted.";
  return `The request failed with status ${status}.`;
}

export interface ApiInit extends Omit<RequestInit, "body"> {
  json?: unknown;
  body?: BodyInit;
}

/** Fetch a backend route through the Next proxy, with the browser's time zone attached. */
export async function api<T>(path: string, init: ApiInit = {}): Promise<T> {
  const { json, ...rest } = init;
  const headers = new Headers(rest.headers);
  headers.set("X-Timezone", timeZone());
  let body = rest.body;
  if (json !== undefined) {
    headers.set("Content-Type", "application/json");
    body = JSON.stringify(json);
  }
  let res: Response;
  try {
    res = await fetch(path, { ...rest, headers, body, cache: "no-store" });
  } catch {
    throw new ApiError(0, "Could not reach Ichigo. Check your connection, then try again.", null);
  }
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!res.ok) {
    throw new ApiError(res.status, messageFrom(res.status, data), (data as { detail?: unknown } | null)?.detail);
  }
  return data as T;
}

/** Path of a workspace route: /api/w/{lang}{path}. */
export function wsPath(lang: string, path: string): string {
  return `/api/w/${encodeURIComponent(lang)}${path}`;
}

export function errorText(err: unknown): string {
  if (err instanceof Error) return err.message;
  return "Something went wrong. Try again.";
}

interface ApiState<T> {
  data: T | undefined;
  error: ApiError | undefined;
  loading: boolean;
}

/** Small GET hook: refetches when the url changes; pass null to skip. */
export function useApi<T>(url: string | null) {
  const [state, setState] = useState<ApiState<T>>({ data: undefined, error: undefined, loading: url !== null });
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (url === null) return;
    let alive = true;
    setState((s) => ({ ...s, loading: true, error: undefined }));
    api<T>(url)
      .then((data) => {
        if (alive) setState({ data, error: undefined, loading: false });
      })
      .catch((error: unknown) => {
        const e = error instanceof ApiError ? error : new ApiError(0, errorText(error), null);
        if (alive) setState((s) => ({ data: s.data, error: e, loading: false }));
      });
    return () => {
      alive = false;
    };
  }, [url, tick]);

  const reload = useCallback(() => setTick((t) => t + 1), []);
  const setData = useCallback((data: T) => setState((s) => ({ ...s, data })), []);
  return { ...state, reload, setData };
}
