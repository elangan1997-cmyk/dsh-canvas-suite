import z from "@deepseek-ai/schemastery";
import { AuthInteraction, Credential, CredentialInfo, CredentialStore } from "@earendil-works/pi-ai";
import "@deepseek-ai/dsh-attachment";
import { ToolExecution } from "@deepseek-ai/dsh-tools";
import { WebSearchProvider, WebSearchRequest, WebSearchResult } from "@deepseek-ai/dsh-web";
import { Context } from "@deepseek-ai/cordis";
//#region src/tool-policy.d.ts
/** User-controlled image-tool integration. */
interface ImageToolPreferences {
  modifyReadImage: boolean;
  shareImagegenWithOtherModels: boolean;
}
/** Experimental request behavior used only by the OpenAI Codex adapter. */
interface ResponseApiPreferences {
  useWebSocketContextReuse: boolean;
  useNativeCompaction: boolean;
}
/** One selectable model from the complete provider catalog. */
interface ModelCatalogEntry {
  id: string;
  name: string;
}
/** Live subset advertised through dsh model discovery. */
interface ModelCatalogPreferences {
  models: string[];
}
/** Browser projection containing both available and currently visible models. */
interface ModelCatalogSettings extends ModelCatalogPreferences {
  availableModels: ModelCatalogEntry[];
}
interface OpenAICodexPreferences extends ImageToolPreferences, ResponseApiPreferences, ModelCatalogPreferences {
  /** Migration-only key written by the unreleased store:true experiment. */
  useStatefulResponses: boolean;
}
/** Defaults keep generic vision-model interoperability enabled. */
declare const DEFAULT_IMAGE_TOOL_PREFERENCES: ImageToolPreferences;
/** Conservative defaults preserve the established stateless Harness behavior. */
declare const DEFAULT_RESPONSE_API_PREFERENCES: ResponseApiPreferences;
/** Live policy shared by the host tools, Codex adapter, and settings HTTP surface. */
declare class ImageToolPolicy {
  private current;
  private scope;
  private readonly imageWatchers;
  private readonly modelCatalog;
  constructor(base?: Partial<OpenAICodexPreferences>, modelCatalog?: readonly ModelCatalogEntry[]);
  /** Register durable live settings when the active profile supplies ctx.settings. */
  attach(ctx: Context): void;
  /** Return a detached settings projection for the browser. */
  snapshot(): ImageToolPreferences;
  /** Observe live changes that add or remove the scoped `read_image` enhancement. */
  watchImagePreferences(listener: () => void): () => void;
  /** Persist a partial browser update through the settings service. */
  update(patch: Partial<ImageToolPreferences>): Promise<ImageToolPreferences>;
  /** Return the current Codex-only Responses API experiments. */
  responseApiSnapshot(): ResponseApiPreferences;
  /** Persist a partial Responses API experiment update. */
  updateResponseApi(patch: Partial<ResponseApiPreferences>): Promise<ResponseApiPreferences>;
  /** Return available models and the live discovery subset for the browser. */
  modelCatalogSnapshot(): ModelCatalogSettings;
  /** Persist the model subset advertised by this provider. */
  updateModelCatalog(patch: Partial<ModelCatalogPreferences>): Promise<ModelCatalogSettings>;
  /** Enforce imagegen's cross-provider toggle at execution time. */
  assertAllowed(exec: ToolExecution, tool: 'imagegen'): void;
  private replace;
  private normalizeModels;
}
//#endregion
//#region src/read-image-enhancement.d.ts
/** Harness's canonical image-reading tool name. */
declare const READ_IMAGE_TOOL_NAME = "read_image";
//#endregion
//#region src/store.d.ts
/** Provider route and pi-ai provider id owned by this bundle. */
declare const OPENAI_CODEX_PROVIDER = "openai-codex";
/** Basename of the OAuth document inside the Harness home. */
declare const OPENAI_CODEX_AUTH_FILENAME = ".openai-codex-auth.json";
/**
 * Resolve the default OAuth document path.
 * @param dshHome - optional Harness-home override.
 * @returns the absolute owner-only document path.
 */
declare function openAICodexAuthPath(dshHome?: string): string;
/** File-backed pi-ai store scoped to the single OpenAI Codex provider. */
declare class OpenAICodexCredentialStore implements CredentialStore {
  /** Absolute credential document path. */
  readonly filename: string;
  /**
   * @param filename - explicit document path, defaulting under `$DSH_HOME`.
   */
  constructor(filename?: string);
  /** Read and validate the current document without acquiring the writer lock. */
  private readCurrent;
  /** @inheritdoc */
  read(providerId: string): Promise<Credential | undefined>;
  /** @inheritdoc */
  list(): Promise<readonly CredentialInfo[]>;
  /** @inheritdoc */
  modify(providerId: string, fn: (current: Credential | undefined) => Promise<Credential | undefined>): Promise<Credential | undefined>;
  /** @inheritdoc */
  delete(providerId: string): Promise<void>;
}
//#endregion
//#region src/imagegen.d.ts
/** Stable Codex-compatible tool name. */
declare const IMAGEGEN_TOOL_NAME = "imagegen";
/** Image model selected by the official Codex image extension. */
declare const OPENAI_CODEX_IMAGE_MODEL = "gpt-image-2";
/** Standalone generation endpoint used by the official Codex client. */
declare const OPENAI_CODEX_IMAGE_GENERATIONS_URL = "https://chatgpt.com/backend-api/codex/images/generations";
/** Reference-image edit endpoint used by the official Codex client. */
declare const OPENAI_CODEX_IMAGE_EDITS_URL = "https://chatgpt.com/backend-api/codex/images/edits";
/** OAuth-backed client for the two fixed ChatGPT Codex image endpoints. */
declare class OpenAICodexImageClient {
  private readonly models;
  /** @param credentials - shared refreshable OAuth store. */
  constructor(credentials: OpenAICodexCredentialStore);
  /** Send one generation or edit request and return the first PNG payload. */
  generate(prompt: string, images: readonly string[], signal: AbortSignal): Promise<Uint8Array>;
}
//#endregion
//#region src/usage.d.ts
/** Fixed endpoint used by the official Codex client for ChatGPT rate limits. */
declare const OPENAI_CODEX_USAGE_URL = "https://chatgpt.com/backend-api/wham/usage";
/** Stable public discriminant for an expired or revoked Codex OAuth session. */
declare const OPENAI_CODEX_REAUTH_REQUIRED_CODE: "OPENAI_CODEX_REAUTH_REQUIRED";
/** Fixed, secret-free message for a browser-facing reauthorization prompt. */
declare const OPENAI_CODEX_REAUTH_REQUIRED_MESSAGE = "OpenAI Codex authorization must be renewed";
/**
 * Raised when the usage endpoint rejects the current OAuth session.
 *
 * The error intentionally carries no response, credential, or account data so
 * callers can safely pass its fixed message across the Web boundary.
 */
declare class OpenAICodexReauthRequiredError extends Error {
  readonly code: "OPENAI_CODEX_REAUTH_REQUIRED";
  constructor();
}
/** Identify the dedicated reauthorization failure without comparing messages. */
declare function isOpenAICodexReauthRequiredError(error: unknown): error is OpenAICodexReauthRequiredError;
/** One quota window expressed as remaining capacity for direct UI rendering. */
interface OpenAICodexRateLimitWindow {
  /** Percent still available in this window. */
  readonly remainingPercent: number;
  /** Server-declared rolling-window length in seconds. */
  readonly windowSeconds: number;
  /** Server-declared reset time as Unix seconds, when supplied and valid. */
  readonly resetAt?: number;
}
/** One separately metered Codex quota bucket. */
interface OpenAICodexRateLimit {
  /** Stable server feature id. */
  readonly id: string;
  /** Optional server-provided display name. */
  readonly name?: string;
  /** Available rolling windows for this bucket. */
  readonly windows: readonly OpenAICodexRateLimitWindow[];
}
/** Optional exact prepaid-credit balance returned by ChatGPT. */
interface OpenAICodexCredits {
  /** Whether the balance is unmetered. */
  readonly unlimited: boolean;
  /** Exact provider-formatted balance when finite and disclosed. */
  readonly balance?: string;
}
/** Optional exact workspace member spend limit returned by ChatGPT. */
interface OpenAICodexIndividualLimit {
  /** Exact configured limit. */
  readonly limit: string;
  /** Exact amount consumed. */
  readonly used: string;
  /** Exact amount still available. */
  readonly remaining: string;
  /** Percent still available for progress rendering. */
  readonly remainingPercent: number;
}
/** Secret-free quota projection returned to the browser. */
interface OpenAICodexUsage {
  /** Rolling Codex rate-limit buckets. */
  readonly rateLimits: readonly OpenAICodexRateLimit[];
  /** Exact prepaid-credit balance when supported for this account. */
  readonly credits?: OpenAICodexCredits;
  /** Exact workspace member limit when supported for this account. */
  readonly individualLimit?: OpenAICodexIndividualLimit;
}
/**
 * Convert the provider response into the small secret-free object sent to the browser.
 * @param value - opaque JSON returned by the ChatGPT usage endpoint.
 * @returns core and additionally metered quota buckets with remaining percentages.
 */
declare function parseOpenAICodexUsage(value: unknown): OpenAICodexUsage;
/**
 * Read current quota without issuing a model request. OAuth is refreshed through
 * the same provider-native credential lifecycle used by normal Codex turns.
 * @param store - plugin-owned OAuth credential store.
 * @returns current rate-limit buckets safe to expose to the local browser page.
 */
declare function readOpenAICodexRateLimits(store: OpenAICodexCredentialStore): Promise<OpenAICodexUsage>;
//#endregion
//#region src/search.d.ts
/** Stable dsh web-provider id selected by the bundle patch. */
declare const OPENAI_CODEX_SEARCH_PROVIDER = "openai-codex";
/** Trusted first-party Codex base; OAuth credentials never cross to a configured origin. */
declare const OPENAI_CODEX_BASE_URL = "https://chatgpt.com/backend-api/codex";
/** Standalone search endpoint used by the official Codex client. */
declare const OPENAI_CODEX_SEARCH_URL = "https://chatgpt.com/backend-api/codex/alpha/search";
/** Default model used by the standalone search endpoint. */
declare const DEFAULT_OPENAI_CODEX_SEARCH_MODEL = "gpt-5.6-sol";
/** Default search mode, matching the official local Codex client. */
declare const DEFAULT_OPENAI_CODEX_SEARCH_MODE = "cached";
/** Default provider search-context size. */
declare const DEFAULT_OPENAI_CODEX_SEARCH_CONTEXT_SIZE = "medium";
/** Default output budget for the standalone search response. */
declare const DEFAULT_OPENAI_CODEX_SEARCH_MAX_OUTPUT_TOKENS = 10000;
/** Search modes accepted by the official standalone endpoint. */
type OpenAICodexSearchMode = 'cached' | 'indexed' | 'live';
/** Provider search-context sizes accepted by the standalone endpoint. */
type OpenAICodexSearchContextSize = 'low' | 'medium' | 'high';
interface SearchRequestBody {
  readonly id: string;
  readonly model: string;
  readonly input: readonly [{
    readonly type: 'message';
    readonly role: 'user';
    readonly content: readonly [{
      readonly type: 'input_text';
      readonly text: string;
    }];
  }];
  readonly commands: {
    readonly search_query: readonly [{
      readonly q: string;
    }];
  };
  readonly settings: {
    readonly search_context_size: OpenAICodexSearchContextSize;
    readonly allowed_callers: readonly ['direct'];
    readonly external_web_access: boolean | 'indexed';
  };
  readonly max_output_tokens: number;
}
/** Exact secret-free request recorded before a standalone search dispatch. */
interface OpenAICodexSearchRequestRecord {
  /** Fixed first-party endpoint. */
  readonly endpoint: typeof OPENAI_CODEX_SEARCH_URL;
  /** Exact JSON body sent to the provider. */
  readonly body: SearchRequestBody;
}
/** Fully resolved provider options. */
interface OpenAICodexSearchProviderOptions {
  /** Shared persistent OAuth store. */
  readonly credentials: OpenAICodexCredentialStore;
  /** Model sent to the standalone search endpoint. */
  readonly model: string;
  /** Cached, indexed, or live external-web policy. */
  readonly mode: OpenAICodexSearchMode;
  /** Provider-side search context size. */
  readonly contextSize: OpenAICodexSearchContextSize;
  /** Upper bound on the standalone endpoint's generated output. */
  readonly maxOutputTokens: number;
  /** Resolve the request identity, normally the initiating session id. */
  readonly resolveRequestId: () => string;
  /** Record the exact secret-free request before dispatch. */
  readonly recordRequest?: (request: OpenAICodexSearchRequestRecord) => void;
}
/**
 * Map the standalone endpoint's forward-compatible result DTOs into the dsh
 * web result. Unknown DTO types and fields are ignored; malformed envelope
 * fields fail at the network boundary.
 * @param value - parsed response JSON.
 * @returns normalized answer and citeable sources.
 */
declare function mapOpenAICodexSearchResponse(value: unknown): WebSearchResult;
/** OpenAI Codex standalone-search provider using the same refreshable OAuth store as the LLM route. */
declare class OpenAICodexSearchProvider implements WebSearchProvider {
  private readonly options;
  readonly id = "openai-codex";
  private readonly models;
  /**
   * @param options - fixed trusted endpoint policy and deployment tunables.
   */
  constructor(options: OpenAICodexSearchProviderOptions);
  /** The local configuration is usable; credential presence is resolved per request. */
  available(): boolean;
  /** @inheritdoc */
  search(request: WebSearchRequest, signal?: AbortSignal): Promise<WebSearchResult>;
}
//#endregion
//#region src/search-event.d.ts
/** Dedicated log event written before an OpenAI Codex search dispatch. */
declare const OPENAI_CODEX_SEARCH_MODEL_REQUEST_EVENT = "web/openai-codex-search-llm-request";
declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /** Exact secret-free OpenAI Codex standalone-search request. */
    'web/openai-codex-search-llm-request': OpenAICodexSearchRequestRecord;
  }
}
/**
 * Register the plugin-owned event in the running Harness vocabulary. The
 * public DSH build exports its known-event collection as read-only because
 * core code must not mutate it accidentally; the runtime value is the Set
 * deliberately consulted on every persistence read. Registration remains for
 * the process lifetime so sessions written before an HMR cycle stay readable.
 */
declare function installOpenAICodexSearchEvent(): void;
/**
 * Append one resolved request to the initiating agent's session. Searches
 * outside an agent turn have no owning session and therefore produce no log.
 * @param ctx - plugin context carrying the optional active-agent service.
 * @param request - exact request after defaults, excluding credentials.
 */
declare function recordOpenAICodexSearchRequest(ctx: Context, request: OpenAICodexSearchRequestRecord): void;
//#endregion
//#region src/auth.d.ts
/** Non-secret login state shown by the launcher. */
interface OpenAICodexAuthStatus {
  /** Whether a stored OAuth credential exists. */
  authenticated: boolean;
  /** Access-token expiry time; refresh is automatic on the next request. */
  expiresAt?: Date;
}
/**
 * Complete provider-native OAuth and persist the resulting credential.
 * @param interaction - terminal or UI callbacks for the provider flow.
 * @param store - credential store, defaulting under `$DSH_HOME`.
 */
declare function loginOpenAICodex(interaction: AuthInteraction, store?: OpenAICodexCredentialStore): Promise<void>;
/**
 * Remove the stored OpenAI Codex credential.
 * @param store - credential store, defaulting under `$DSH_HOME`.
 */
declare function logoutOpenAICodex(store?: OpenAICodexCredentialStore): Promise<void>;
/**
 * Read non-secret OpenAI Codex login state without refreshing the token.
 * @param store - credential store, defaulting under `$DSH_HOME`.
 * @returns stored login state and expiry.
 */
declare function openAICodexAuthStatus(store?: OpenAICodexCredentialStore): Promise<OpenAICodexAuthStatus>;
//#endregion
//#region src/service.d.ts
declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Provider-owned account and preference service for optional front doors. */
    openAICodex: OpenAICodexService;
  }
}
/** Initial settings contributed by the bundle configuration. */
interface OpenAICodexServiceOptions extends ImageToolPreferences, ResponseApiPreferences {
  models?: string[];
  modelCatalog: readonly ModelCatalogEntry[];
}
/**
 * One provider-owned host service shared by Web routes and terminal adapters.
 * Credentials and live policy stay singletons even when several front doors are mounted.
 */
declare class OpenAICodexService {
  readonly credentials: OpenAICodexCredentialStore;
  readonly policy: ImageToolPolicy;
  constructor(options: OpenAICodexServiceOptions);
  /** Attach the durable settings document when the active profile provides it. */
  attachSettings(ctx: Context): void;
  /** Start the provider-native OAuth lifecycle. */
  login(interaction: AuthInteraction): Promise<void>;
  /** Remove this plugin's credential without touching Codex CLI/Desktop. */
  logout(): Promise<void>;
  /** Read non-secret authentication metadata. */
  authStatus(): Promise<OpenAICodexAuthStatus>;
  /** Read current subscription limits without issuing a model request. */
  usage(): Promise<OpenAICodexUsage>;
  imagePreferences(): ImageToolPreferences;
  updateImagePreferences(patch: Partial<ImageToolPreferences>): Promise<ImageToolPreferences>;
  responsePreferences(): ResponseApiPreferences;
  updateResponsePreferences(patch: Partial<ResponseApiPreferences>): Promise<ResponseApiPreferences>;
}
//#endregion
//#region src/compatibility.d.ts
declare const COMPATIBILITY_SCHEMA_VERSION: 1;
declare const COMPATIBILITY_PACKAGES: readonly ["@deepseek-ai/dsh-llm", "@deepseek-ai/dsh-llm-pi-ai", "@earendil-works/pi-ai"];
type CompatibilityPackageName = (typeof COMPATIBILITY_PACKAGES)[number];
type CompatibilityStatus = 'compatible' | 'incompatible' | 'unknown';
interface CompatibilityEntry {
  supported: string;
  installed: string | null;
  status: CompatibilityStatus;
}
interface CompatibilityReport {
  schemaVersion: typeof COMPATIBILITY_SCHEMA_VERSION;
  status: CompatibilityStatus;
  node: CompatibilityEntry;
  packages: Record<CompatibilityPackageName, CompatibilityEntry>;
}
interface CompatibilityEvaluationInput {
  /** Node version to evaluate; defaults to the running process in detectCompatibility. */
  nodeVersion?: string | null;
  /** Alias accepted by callers that already group installed values. */
  node?: string | null;
  /** Installed package versions keyed by package name. */
  packageVersions?: Partial<Record<CompatibilityPackageName, string | null | undefined>>;
  /** Alias accepted by callers that already group installed values. */
  packages?: Partial<Record<CompatibilityPackageName, string | null | undefined>>;
  /** Nested installed values are useful when feeding a captured diagnostic fixture. */
  installed?: {
    node?: string | null;
    packages?: Partial<Record<CompatibilityPackageName, string | null | undefined>>;
  };
}
interface CompatibilityDetectionOptions extends CompatibilityEvaluationInput {
  /** Test seam for package metadata resolution; no package paths are returned. */
  readPackageVersion?: (name: CompatibilityPackageName) => string | null | undefined | Promise<string | null | undefined>;
}
//#endregion
//#region src/doctor.d.ts
/** Inputs that are safe to obtain without booting OAuth. */
interface OpenAICodexDiagnosticOptions {
  /** Credential pathname to inspect through metadata only. */
  credentialPath?: string;
  /** Provider ids already registered in the active Harness context. */
  providerIds?: readonly string[];
  /** Whether the optional standalone search provider is enabled. */
  enableSearch?: boolean;
  /** Whether the optional image tool is enabled. */
  enableImageTool?: boolean;
  /** Optional pure-function seam for compatibility checks in tests/diagnostic callers. */
  compatibilityOptions?: CompatibilityDetectionOptions;
}
interface OpenAICodexDiagnosticReport {
  package: 'dsh-codex';
  version: string;
  node: string;
  credentialFile: {
    path: string;
    state: 'missing' | 'owner-only' | 'permissions-too-broad' | 'not-a-regular-file' | 'unreadable-metadata';
    mode?: string;
  };
  capabilities: {
    modelProvider: true;
    search: boolean;
    imageTool: boolean;
    changesHarnessDefaultModel: true;
    changesHarnessSearchRoute: true;
  };
  providerConflict: boolean;
  compatibility: CompatibilityReport;
  hints: string[];
}
/** Actionable message for legacy/manual `openai-codex` adapter collisions. */
declare function openAICodexConflictMessage(): string;
/** Fail before the generic registry error so the collision has a migration hint. */
declare function assertNoOpenAICodexProviderConflict(providerIds: readonly string[]): void;
/**
 * Inspect only process and filesystem metadata. This function never opens the
 * OAuth document, refreshes a token, or starts an authorization flow.
 */
declare function diagnoseOpenAICodex(options?: OpenAICodexDiagnosticOptions): Promise<OpenAICodexDiagnosticReport>;
//#endregion
//#region src/fast-mode.d.ts
/** Process-local, per-session OpenAI Codex Fast Mode state. */
/** Maximum number of enabled sessions retained by one plugin instance. */
declare const OPENAI_CODEX_FAST_MODE_MAX_SESSIONS = 256;
/** Maximum UTF-16 code units accepted for an opaque DSH session id. */
declare const OPENAI_CODEX_FAST_MODE_MAX_SESSION_ID_LENGTH = 256;
/**
 * Validate the opaque session identity used by the Fast Mode registry.
 *
 * The registry deliberately does not interpret or normalize session ids.  It
 * only rejects values that cannot safely serve as a bounded map key.
 */
declare function isFastModeSessionId(value: unknown): value is string;
/**
 * In-memory Fast Mode registry.  Entries are positive-only: disabling a
 * session removes its key, and an insertion over the bound evicts the least
 * recently touched key.  A new plugin instance starts with an empty map.
 */
declare class FastModeRegistry {
  private readonly maxSessions;
  private readonly enabledSessions;
  constructor(maxSessions?: number);
  /** Number of currently enabled sessions. */
  get size(): number;
  /** Read one session without exposing the map or any credential state. */
  isEnabled(sessionId: unknown): boolean;
  /** Alias useful to callers that model this as a boolean setting. */
  get(sessionId: unknown): boolean;
  /** Enable or disable exactly one opaque session id. */
  set(sessionId: unknown, enabled: boolean): void;
  /** Explicitly named alias for callers that avoid boolean-setting verbs. */
  setEnabled(sessionId: unknown, enabled: boolean): void;
  /** Disable one session and forget its key. */
  delete(sessionId: unknown): void;
  /** Remove all process-local state during an explicit lifecycle teardown. */
  clear(): void;
}
//#endregion
//#region src/fast-mode-paths.d.ts
/** Node-free Fast Mode route constants shared by Host and browser halves. */
/** GET/POST endpoint for one conversation's process-local Fast Mode state. */
declare const OPENAI_CODEX_FAST_MODE_PATH = "/plugins/dsh-openai-codex/fast-mode";
//#endregion
//#region src/index.d.ts
/** Stable Cordis plugin name. */
declare const name = "llm-openai-codex";
/** LLM and web registries required before the composite provider can register. */
declare const inject: string[];
/** Composite model and standalone-search configuration. */
interface Config {
  /** Model ids advertised by the provider; omitted to advertise the full catalog. */
  models?: string[] | undefined;
  /** Model used for auxiliary standalone searches. */
  searchModel?: string;
  /** Cached, indexed, or live web access. */
  searchMode?: OpenAICodexSearchMode;
  /** Amount of search context returned by the provider. */
  searchContextSize?: OpenAICodexSearchContextSize;
  /** Maximum generated tokens returned by the standalone search endpoint. */
  searchMaxOutputTokens?: number;
  /** Extend Harness read_image with HTTP(S) URL input. */
  modifyReadImage?: boolean;
  /** Allow non-Codex vision models to call imagegen. */
  shareImagegenWithOtherModels?: boolean;
  /** Reuse matching Codex context through the session's WebSocket connection. */
  useWebSocketContextReuse?: boolean;
  /** Use Codex V2 Responses compaction for Harness compaction calls. */
  useNativeCompaction?: boolean;
}
declare const Config: z<Config>;
/**
 * Register the `openai-codex` LLM route and standalone web-search provider
 * with one provider-native OAuth credential store.
 * @param ctx - plugin context carrying the LLM and web registries plus optional agent and attachment services.
 * @param config - standalone-search model, access mode, context size, and output budget.
 */
declare function apply(ctx: Context, config: Config): void;
//#endregion
export { Config, DEFAULT_IMAGE_TOOL_PREFERENCES, DEFAULT_OPENAI_CODEX_SEARCH_CONTEXT_SIZE, DEFAULT_OPENAI_CODEX_SEARCH_MAX_OUTPUT_TOKENS, DEFAULT_OPENAI_CODEX_SEARCH_MODE, DEFAULT_OPENAI_CODEX_SEARCH_MODEL, DEFAULT_RESPONSE_API_PREFERENCES, FastModeRegistry, IMAGEGEN_TOOL_NAME, ImageToolPolicy, type ImageToolPreferences, OPENAI_CODEX_AUTH_FILENAME, OPENAI_CODEX_BASE_URL, OPENAI_CODEX_FAST_MODE_MAX_SESSIONS, OPENAI_CODEX_FAST_MODE_MAX_SESSION_ID_LENGTH, OPENAI_CODEX_FAST_MODE_PATH, OPENAI_CODEX_IMAGE_EDITS_URL, OPENAI_CODEX_IMAGE_GENERATIONS_URL, OPENAI_CODEX_IMAGE_MODEL, OPENAI_CODEX_PROVIDER, OPENAI_CODEX_REAUTH_REQUIRED_CODE, OPENAI_CODEX_REAUTH_REQUIRED_MESSAGE, OPENAI_CODEX_SEARCH_MODEL_REQUEST_EVENT, OPENAI_CODEX_SEARCH_PROVIDER, OPENAI_CODEX_SEARCH_URL, OPENAI_CODEX_USAGE_URL, type OpenAICodexAuthStatus, OpenAICodexCredentialStore, type OpenAICodexCredits, type OpenAICodexDiagnosticOptions, type OpenAICodexDiagnosticReport, OpenAICodexImageClient, type OpenAICodexIndividualLimit, type OpenAICodexRateLimit, type OpenAICodexRateLimitWindow, OpenAICodexReauthRequiredError, type OpenAICodexSearchContextSize, type OpenAICodexSearchMode, OpenAICodexSearchProvider, type OpenAICodexSearchProviderOptions, type OpenAICodexSearchRequestRecord, OpenAICodexService, type OpenAICodexServiceOptions, type OpenAICodexUsage, READ_IMAGE_TOOL_NAME, type ResponseApiPreferences, apply, assertNoOpenAICodexProviderConflict, diagnoseOpenAICodex, inject, installOpenAICodexSearchEvent, isFastModeSessionId, isOpenAICodexReauthRequiredError, loginOpenAICodex, logoutOpenAICodex, mapOpenAICodexSearchResponse, name, openAICodexAuthPath, openAICodexAuthStatus, openAICodexConflictMessage, parseOpenAICodexUsage, readOpenAICodexRateLimits, recordOpenAICodexSearchRequest };