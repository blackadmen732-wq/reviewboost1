"use client";

import type { Cell } from "@/features/connections/sheet-columns";

/**
 * Google, from the browser only.
 *
 * The owner signs in with Google's own window and picks one sheet in Google's
 * own file picker. The permission asked for is `drive.file`: access to the
 * files the owner picks in this app and nothing else in their Drive. The token
 * lives in memory for the few seconds it takes to read the sheet and is then
 * revoked. Nothing about the Google account is stored or sent to ReviewBoost's
 * server except the rows themselves, the sheet's title and its id.
 */

const GIS_SRC = "https://accounts.google.com/gsi/client";
const GAPI_SRC = "https://apis.google.com/js/api.js";
const SCOPE = "https://www.googleapis.com/auth/drive.file";
export const MAX_SHEET_ROWS = 2000;

export interface GoogleConfig {
  clientId: string;
  apiKey: string;
  projectNumber: string;
}

export class GoogleSheetsError extends Error {
  constructor(
    message: string,
    readonly code: "load_failed" | "cancelled" | "denied" | "read_failed" | "not_a_sheet" | "too_big",
  ) {
    super(message);
    this.name = "GoogleSheetsError";
  }
}

/* Minimal shapes of the two Google libraries, only what is used here. */
interface TokenResponse {
  access_token?: string;
  error?: string;
  scope?: string;
}
interface TokenClient {
  requestAccessToken(options?: { prompt?: string }): void;
}
interface GoogleGlobal {
  accounts: {
    oauth2: {
      initTokenClient(config: {
        client_id: string;
        scope: string;
        callback: (response: TokenResponse) => void;
        error_callback?: (error: { type?: string }) => void;
      }): TokenClient;
      revoke(token: string, done?: () => void): void;
      hasGrantedAllScopes(response: TokenResponse, scope: string): boolean;
    };
  };
  picker: {
    PickerBuilder: new () => PickerBuilder;
    DocsView: new (viewId: string) => { setMode(mode: string): unknown; setIncludeFolders(v: boolean): unknown };
    ViewId: { SPREADSHEETS: string };
    DocsViewMode: { LIST: string };
    Action: { PICKED: string; CANCEL: string };
    Feature: { NAV_HIDDEN: string };
  };
}
interface PickerBuilder {
  addView(view: unknown): PickerBuilder;
  setOAuthToken(token: string): PickerBuilder;
  setDeveloperKey(key: string): PickerBuilder;
  setAppId(id: string): PickerBuilder;
  setTitle(title: string): PickerBuilder;
  enableFeature(feature: string): PickerBuilder;
  setCallback(cb: (data: { action: string; docs?: Array<{ id: string; name: string; mimeType?: string }> }) => void): PickerBuilder;
  build(): { setVisible(visible: boolean): void };
}
declare global {
  interface Window {
    google?: GoogleGlobal;
    gapi?: { load(name: string, done: () => void): void };
  }
}

const loading = new Map<string, Promise<void>>();

function loadScript(src: string): Promise<void> {
  const existing = loading.get(src);
  if (existing) return existing;
  const promise = new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = src;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => {
      loading.delete(src);
      reject(new GoogleSheetsError("Google didn't load. Check your connection and try again.", "load_failed"));
    };
    document.head.appendChild(script);
  });
  loading.set(src, promise);
  return promise;
}

async function loadGoogle(): Promise<GoogleGlobal> {
  await Promise.all([loadScript(GIS_SRC), loadScript(GAPI_SRC)]);
  await new Promise<void>((resolve) => window.gapi!.load("picker", resolve));
  if (!window.google?.accounts?.oauth2 || !window.google.picker) {
    throw new GoogleSheetsError("Google didn't load. Check your connection and try again.", "load_failed");
  }
  return window.google;
}

/** Load Google's scripts ahead of the click, so the sign-in window isn't blocked as a pop-up. */
export function preloadGoogle(): void {
  void loadGoogle().catch(() => undefined);
}

function requestToken(google: GoogleGlobal, config: GoogleConfig): Promise<string> {
  return new Promise((resolve, reject) => {
    const client = google.accounts.oauth2.initTokenClient({
      client_id: config.clientId,
      scope: SCOPE,
      callback: (response) => {
        if (response.error || !response.access_token) {
          reject(new GoogleSheetsError("Google didn't give permission, so nothing was read.", "denied"));
          return;
        }
        if (!google.accounts.oauth2.hasGrantedAllScopes(response, SCOPE)) {
          google.accounts.oauth2.revoke(response.access_token);
          reject(new GoogleSheetsError("Google didn't give permission, so nothing was read.", "denied"));
          return;
        }
        resolve(response.access_token);
      },
      error_callback: () => reject(new GoogleSheetsError("You closed the Google window. Nothing was read.", "cancelled")),
    });
    client.requestAccessToken({ prompt: "" });
  });
}

function pickSheet(google: GoogleGlobal, config: GoogleConfig, token: string): Promise<{ id: string; name: string }> {
  return new Promise((resolve, reject) => {
    const view = new google.picker.DocsView(google.picker.ViewId.SPREADSHEETS);
    view.setMode(google.picker.DocsViewMode.LIST);
    view.setIncludeFolders(false);
    new google.picker.PickerBuilder()
      .addView(view)
      .setTitle("Pick the sheet with your customers")
      .enableFeature(google.picker.Feature.NAV_HIDDEN)
      .setOAuthToken(token)
      .setDeveloperKey(config.apiKey)
      .setAppId(config.projectNumber)
      .setCallback((data) => {
        if (data.action === google.picker.Action.PICKED && data.docs?.[0]) {
          const doc = data.docs[0];
          if (doc.mimeType && doc.mimeType !== "application/vnd.google-apps.spreadsheet") {
            reject(new GoogleSheetsError("That isn't a Google Sheet. Pick a sheet instead.", "not_a_sheet"));
            return;
          }
          resolve({ id: doc.id, name: doc.name });
        } else if (data.action === google.picker.Action.CANCEL) {
          reject(new GoogleSheetsError("No sheet picked. Nothing was read.", "cancelled"));
        }
      })
      .build()
      .setVisible(true);
  });
}

async function sheetsGet<T>(token: string, path: string): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${path}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch {
    throw new GoogleSheetsError("We couldn't reach Google. Check your connection and try again.", "read_failed");
  }
  if (!response.ok) {
    throw new GoogleSheetsError("Google wouldn't let us read that sheet. Try picking it again.", "read_failed");
  }
  return (await response.json()) as T;
}

export interface PickedSheet {
  id: string;
  title: string;
  tabs: Array<{ title: string; rowCount: number }>;
  /** Reads one tab. Only valid until `done()` is called. */
  readTab(title: string): Promise<Cell[][]>;
  /** Throws the Google permission away. Call when finished, whatever happened. */
  done(): void;
}

/** Sign in with Google, pick one sheet, and return a handle to read it. */
export async function pickGoogleSheet(config: GoogleConfig): Promise<PickedSheet> {
  const google = await loadGoogle();
  const token = await requestToken(google, config);
  let revoked = false;
  const done = () => {
    if (revoked) return;
    revoked = true;
    google.accounts.oauth2.revoke(token);
  };

  try {
    const picked = await pickSheet(google, config, token);
    const meta = await sheetsGet<{
      properties?: { title?: string };
      sheets?: Array<{ properties?: { title?: string; gridProperties?: { rowCount?: number } } }>;
    }>(token, `${encodeURIComponent(picked.id)}?fields=properties.title,sheets.properties(title,gridProperties.rowCount)`);
    const tabs = (meta.sheets ?? [])
      .map((sheet) => ({ title: sheet.properties?.title ?? "", rowCount: sheet.properties?.gridProperties?.rowCount ?? 0 }))
      .filter((tab) => tab.title);
    if (tabs.length === 0) throw new GoogleSheetsError("That sheet is empty.", "read_failed");

    return {
      id: picked.id,
      title: meta.properties?.title ?? picked.name,
      tabs,
      done,
      async readTab(title: string) {
        // A header row plus up to 2,000 people, columns A to Z.
        const range = encodeURIComponent(`'${title.replace(/'/g, "''")}'!A1:Z${MAX_SHEET_ROWS + 10}`);
        const values = await sheetsGet<{ values?: Cell[][] }>(
          token,
          `${encodeURIComponent(picked.id)}/values/${range}?majorDimension=ROWS&valueRenderOption=UNFORMATTED_VALUE`,
        );
        return values.values ?? [];
      },
    };
  } catch (error) {
    done();
    throw error;
  }
}

/**
 * A CSV file the owner picked, shaped like a picked Google Sheet so the same
 * column check, preview and import run on it. Read entirely in the browser.
 */
export async function openCsvFile(file: File): Promise<PickedSheet> {
  const { parseCsv, MAX_CSV_BYTES } = await import("@/lib/csv/parse");
  if (file.size > MAX_CSV_BYTES) {
    throw new GoogleSheetsError("That file is too big. Split it into files of up to 2,000 people.", "too_big");
  }
  const looksCsv = /\.(csv|txt|tsv)$/i.test(file.name) || /csv|text\/plain|tab-separated/i.test(file.type);
  if (!looksCsv) {
    throw new GoogleSheetsError("That isn't a CSV file. In Excel or Numbers, save the list as CSV and pick that file.", "not_a_sheet");
  }
  let text: string;
  try {
    text = await file.text();
  } catch {
    throw new GoogleSheetsError("That file couldn't be read. Try saving it again as CSV.", "read_failed");
  }
  const cells = parseCsv(text);
  const title = file.name.replace(/\.(csv|txt|tsv)$/i, "").slice(0, 120) || "Customer list";
  return {
    id: "",
    title,
    tabs: [{ title, rowCount: cells.length }],
    readTab: async () => cells,
    done: () => undefined,
  };
}
