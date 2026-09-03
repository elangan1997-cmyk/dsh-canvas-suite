import { randomUUID } from "node:crypto";
import z from "@deepseek-ai/schemastery";
import { createAssistantMessageEventStream, createModels } from "@earendil-works/pi-ai";
import { openaiCodexProvider } from "@earendil-works/pi-ai/providers/openai-codex";
import { createUserMessage, resolveRetryPolicy } from "@deepseek-ai/dsh-llm";
import { PiAiAdapter } from "@deepseek-ai/dsh-llm-pi-ai";
import { link, lstat, mkdir, open, readFile, rename, rm, stat } from "node:fs/promises";
import { basename, dirname, join, parse, resolve } from "node:path";
import { withFileLock, writeFileAtomic } from "@deepseek-ai/dsh-atomic-write";
import { resolveDshHome } from "@deepseek-ai/dsh-home-paths";
import { convertResponsesMessages, convertResponsesTools } from "@earendil-works/pi-ai/api/openai-responses-shared";
import { AttachmentId } from "@deepseek-ai/dsh-attachment";
import { defineTool } from "@deepseek-ai/dsh-tools";
import { lookup } from "node:dns/promises";
import { request } from "node:http";
import { request as request$1 } from "node:https";
import { BlockList, isIP } from "node:net";
import { WebError } from "@deepseek-ai/dsh-web";
import { fileURLToPath } from "node:url";
import { FsError } from "@deepseek-ai/dsh-fs";
import { KNOWN_SESSION_EVENT_TYPES } from "@deepseek-ai/dsh-session";
import { settingsNamespace } from "@deepseek-ai/dsh-settings";
//#region src/store.ts
/**
* Owner-only persistent OAuth credential storage for the OpenAI Codex bundle.
* @module dsh-codex/store
*/
/** Provider route and pi-ai provider id owned by this bundle. */
const OPENAI_CODEX_PROVIDER = "openai-codex";
/** Basename of the OAuth document inside the Harness home. */
const OPENAI_CODEX_AUTH_FILENAME = ".openai-codex-auth.json";
/** Current on-disk format; pre-release readers reject every other version. */
const AUTH_FORMAT_VERSION = 1;
/** Whether a filesystem error reports an absent path. */
function isENOENT$1(error) {
	return error?.code === "ENOENT";
}
/** Reject a credential document readable by another POSIX user. */
async function assertOwnerOnly$1(filename) {
	let mode;
	try {
		mode = (await stat(filename)).mode;
	} catch (error) {
		if (isENOENT$1(error)) return;
		throw error;
	}
	/* v8 ignore next -- native Windows coverage takes the mode-less branch */
	if (process.platform === "win32") return;
	/* v8 ignore start -- POSIX tests cover this branch; Windows cannot express it */
	if ((mode & 63) !== 0) throw new Error(`openai-codex: ${filename} is readable beyond its owner (mode ${(mode & 511).toString(8)}); run "chmod 600 ${filename}" before starting again`);
	/* v8 ignore stop */
}
/** Validate the strict JSON document without quoting token-bearing input. */
function parseDocument$1(text, filename) {
	let value;
	try {
		value = JSON.parse(text);
	} catch {
		throw new Error(`openai-codex: ${filename} is not valid JSON`);
	}
	if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error(`openai-codex: ${filename} must contain an object`);
	const document = value;
	if (document["version"] !== AUTH_FORMAT_VERSION) throw new Error(`openai-codex: ${filename} has unsupported auth format version ${String(document["version"])}`);
	if (Object.keys(document).some((key) => key !== "version" && key !== "credential")) throw new Error(`openai-codex: ${filename} contains an unknown top-level field`);
	const raw = document["credential"];
	if (typeof raw !== "object" || raw === null || Array.isArray(raw)) throw new Error(`openai-codex: ${filename} credential must be an object`);
	const credential = raw;
	if (Object.keys(credential).some((key) => ![
		"type",
		"access",
		"refresh",
		"expires",
		"accountId"
	].includes(key))) throw new Error(`openai-codex: ${filename} credential contains an unknown field`);
	if (credential["type"] !== "oauth") throw new Error(`openai-codex: ${filename} credential type must be oauth`);
	for (const key of [
		"access",
		"refresh",
		"accountId"
	]) if (typeof credential[key] !== "string" || credential[key].length === 0) throw new Error(`openai-codex: ${filename} credential ${key} must be a non-empty string`);
	if (typeof credential["expires"] !== "number" || !Number.isFinite(credential["expires"]) || credential["expires"] <= 0) throw new Error(`openai-codex: ${filename} credential expires must be a positive finite number`);
	return {
		version: AUTH_FORMAT_VERSION,
		credential
	};
}
/** Detach a credential from callers that may mutate provider-owned extras. */
function cloneCredential(credential) {
	return structuredClone(credential);
}
/**
* Resolve the default OAuth document path.
* @param dshHome - optional Harness-home override.
* @returns the absolute owner-only document path.
*/
function openAICodexAuthPath(dshHome) {
	return resolve(join(resolveDshHome(dshHome), OPENAI_CODEX_AUTH_FILENAME));
}
/** File-backed pi-ai store scoped to the single OpenAI Codex provider. */
var OpenAICodexCredentialStore = class {
	/** Absolute credential document path. */
	filename;
	/**
	* @param filename - explicit document path, defaulting under `$DSH_HOME`.
	*/
	constructor(filename = openAICodexAuthPath()) {
		this.filename = resolve(filename);
	}
	/** Read and validate the current document without acquiring the writer lock. */
	async readCurrent() {
		await assertOwnerOnly$1(this.filename);
		let text;
		try {
			text = await readFile(this.filename, "utf8");
		} catch (error) {
			if (isENOENT$1(error)) return void 0;
			throw error;
		}
		return cloneCredential(parseDocument$1(text, this.filename).credential);
	}
	/** @inheritdoc */
	async read(providerId) {
		return providerId === "openai-codex" ? this.readCurrent() : void 0;
	}
	/** @inheritdoc */
	async list() {
		return await this.readCurrent() === void 0 ? [] : [{
			providerId: OPENAI_CODEX_PROVIDER,
			type: "oauth"
		}];
	}
	/** @inheritdoc */
	async modify(providerId, fn) {
		if (providerId !== "openai-codex") throw new Error(`openai-codex: credential store does not own provider "${providerId}"`);
		await mkdir(dirname(this.filename), {
			recursive: true,
			mode: 448
		});
		return withFileLock(this.filename, async () => {
			const current = await this.readCurrent();
			const candidate = await fn(current);
			if (candidate === void 0) return current;
			const document = parseDocument$1(JSON.stringify({
				version: AUTH_FORMAT_VERSION,
				credential: candidate
			}), this.filename);
			await writeFileAtomic(this.filename, `${JSON.stringify(document, null, 2)}\n`, {
				mode: 384,
				dirMode: 448
			});
			return cloneCredential(document.credential);
		});
	}
	/** @inheritdoc */
	async delete(providerId) {
		if (providerId !== "openai-codex") return;
		await mkdir(dirname(this.filename), {
			recursive: true,
			mode: 448
		});
		await withFileLock(this.filename, () => rm(this.filename, { force: true }));
	}
};
//#endregion
//#region src/responses.ts
/** Codex WebSocket transport selection and native compaction experiments. */
/** Responses endpoint used by the official Codex client, including V2 compaction. */
const OPENAI_CODEX_RESPONSES_URL = "https://chatgpt.com/backend-api/codex/responses";
const CODEX_TOOL_CALL_PROVIDERS = /* @__PURE__ */ new Set([
	"openai",
	"openai-codex",
	"opencode"
]);
const COMPACTION_MARKER_OPEN = "<dsh-openai-codex-compaction-4f5cf1b7-v1>";
const COMPACTION_MARKER_CLOSE = "</dsh-openai-codex-compaction-4f5cf1b7-v1>";
const NO_SESSION = "<no-session>";
const MAX_NATIVE_COMPACTION_RETRIES = 2;
/** Whether an opaque value is a non-array record. */
function isRecord$3(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
/** Read a finite non-negative number from an API usage object. */
function usageNumber(record, key) {
	const value = record?.[key];
	return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0;
}
function emptyUsage() {
	return {
		input: 0,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
		totalTokens: 0,
		cost: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			total: 0
		}
	};
}
/** Map Responses usage without assigning a price to subscription traffic. */
function compactUsage(raw) {
	if (raw === void 0) return emptyUsage();
	const inputDetails = isRecord$3(raw["input_tokens_details"]) ? raw["input_tokens_details"] : void 0;
	const outputDetails = isRecord$3(raw["output_tokens_details"]) ? raw["output_tokens_details"] : void 0;
	const inputTokens = usageNumber(raw, "input_tokens");
	const cacheRead = usageNumber(inputDetails, "cached_tokens");
	const cacheWrite = usageNumber(inputDetails, "cache_write_tokens");
	const reasoning = usageNumber(outputDetails, "reasoning_tokens");
	return {
		input: Math.max(0, inputTokens - cacheRead - cacheWrite),
		output: usageNumber(raw, "output_tokens"),
		cacheRead,
		cacheWrite,
		reasoning,
		totalTokens: usageNumber(raw, "total_tokens"),
		cost: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			total: 0
		}
	};
}
/** Extract the ChatGPT account id paired with a Codex OAuth access token. */
function accountIdFromToken$2(access) {
	try {
		const parts = access.split(".");
		if (parts.length !== 3 || parts[1] === void 0) throw new Error("invalid JWT");
		const auth = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"))["https://api.openai.com/auth"];
		if (!isRecord$3(auth)) throw new Error("missing auth claim");
		const accountId = auth["chatgpt_account_id"];
		if (typeof accountId !== "string" || accountId.length === 0) throw new Error("missing account id");
		return accountId;
	} catch (error) {
		throw new Error("OpenAI Codex credential has no usable account id; sign in again", { cause: error });
	}
}
/** Validate and encode provider-native compact output inside a durable text checkpoint. */
function nativeCompactionMarker(output) {
	if (!output.some((item) => isRecord$3(item) && item["type"] === "compaction")) throw new Error("OpenAI Codex compact response did not contain a compaction item");
	return `${COMPACTION_MARKER_OPEN}${JSON.stringify(output)}${COMPACTION_MARKER_CLOSE}`;
}
/** Decode one plugin-owned marker. User text without a complete valid marker is untouched. */
function markerOutput(text) {
	const start = text.indexOf(COMPACTION_MARKER_OPEN);
	if (start < 0) return void 0;
	const payloadStart = start + 41;
	const end = text.indexOf(COMPACTION_MARKER_CLOSE, payloadStart);
	if (end < 0) return void 0;
	const parsed = JSON.parse(text.slice(payloadStart, end));
	if (!Array.isArray(parsed) || !parsed.some((item) => isRecord$3(item) && item["type"] === "compaction")) throw new Error("OpenAI Codex native compaction checkpoint is malformed");
	return parsed;
}
/** Replace a framed Harness checkpoint with the native items it durably carries. */
function expandNativeCompactionMarkers(input) {
	const expanded = [];
	for (const item of input) {
		if (!isRecord$3(item) || item["role"] !== "user" || !Array.isArray(item["content"])) {
			expanded.push(item);
			continue;
		}
		let replacement;
		for (const content of item["content"]) {
			if (!isRecord$3(content) || content["type"] !== "input_text" || typeof content["text"] !== "string") continue;
			const decoded = markerOutput(content["text"]);
			if (decoded !== void 0) {
				replacement = decoded;
				break;
			}
		}
		if (replacement === void 0) expanded.push(item);
		else expanded.push(...replacement);
	}
	return expanded;
}
function sessionKey(sessionId) {
	return sessionId ?? NO_SESSION;
}
/** Emit a one-block pi-ai response containing the durable native checkpoint marker. */
function markerStream(model, response) {
	const stream = createAssistantMessageEventStream();
	const text = nativeCompactionMarker(response.output);
	const partial = {
		role: "assistant",
		content: [],
		api: "openai-codex-responses",
		provider: model.provider,
		model: model.id,
		...response.id === void 0 ? {} : { responseId: response.id },
		usage: compactUsage(response.usage),
		stopReason: "stop",
		timestamp: Date.now()
	};
	queueMicrotask(() => {
		stream.push({
			type: "start",
			partial
		});
		partial.content.push({
			type: "text",
			text: ""
		});
		stream.push({
			type: "text_start",
			contentIndex: 0,
			partial
		});
		partial.content[0].text = text;
		stream.push({
			type: "text_delta",
			contentIndex: 0,
			delta: text,
			partial
		});
		stream.push({
			type: "text_end",
			contentIndex: 0,
			content: text,
			partial
		});
		stream.push({
			type: "done",
			reason: "stop",
			message: partial
		});
	});
	return stream;
}
function failedStream(model, error, signal) {
	const stream = createAssistantMessageEventStream();
	const aborted = signal?.aborted === true;
	const failure = {
		role: "assistant",
		content: [],
		api: "openai-codex-responses",
		provider: model.provider,
		model: model.id,
		usage: emptyUsage(),
		stopReason: aborted ? "aborted" : "error",
		errorMessage: error instanceof Error ? error.message : String(error),
		timestamp: Date.now()
	};
	queueMicrotask(() => {
		stream.push({
			type: "error",
			reason: aborted ? "aborted" : "error",
			error: failure
		});
	});
	return stream;
}
function responseHeaders(headers) {
	const result = {};
	headers.forEach((value, key) => {
		result[key] = value;
	});
	return result;
}
function retryDelayMs(response, attempt) {
	const retryAfterMsHeader = response.headers.get("retry-after-ms");
	if (retryAfterMsHeader !== null) {
		const retryAfterMs = Number(retryAfterMsHeader);
		if (Number.isFinite(retryAfterMs) && retryAfterMs >= 0) return retryAfterMs;
	}
	const retryAfter = response.headers.get("retry-after");
	if (retryAfter !== null) {
		const seconds = Number(retryAfter);
		if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1e3;
		const date = Date.parse(retryAfter);
		if (!Number.isNaN(date)) return Math.max(0, date - Date.now());
	}
	return Math.min(4e3, 500 * 2 ** attempt);
}
function retryableStatus(status) {
	return status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
}
async function waitForRetry(delay, signal) {
	await new Promise((resolve, reject) => {
		if (signal === void 0) {
			setTimeout(resolve, delay);
			return;
		}
		if (signal.aborted) {
			reject(signal.reason);
			return;
		}
		const onAbort = () => {
			clearTimeout(timeout);
			reject(signal.reason);
		};
		const timeout = setTimeout(() => {
			signal.removeEventListener("abort", onAbort);
			resolve();
		}, delay);
		signal.addEventListener("abort", onAbort, { once: true });
	});
}
function requestSignal(signal, timeoutMs) {
	if (timeoutMs === void 0 || timeoutMs <= 0) return signal;
	const timeout = AbortSignal.timeout(timeoutMs);
	return signal === void 0 ? timeout : AbortSignal.any([signal, timeout]);
}
/** Parse the V2 compaction item from a normal Responses SSE stream. */
async function compactResponse(response, retained) {
	if (response.body === null) throw new Error("OpenAI Codex compact response had no body");
	const reader = response.body.getReader();
	const decoder = new TextDecoder();
	let buffer = "";
	let compaction;
	let responseId;
	let usage;
	let completed = false;
	const consumeEvent = (raw) => {
		const data = raw.split(/\r?\n/).filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trimStart()).join("\n");
		if (data.length === 0 || data === "[DONE]") return;
		const event = JSON.parse(data);
		if (!isRecord$3(event)) return;
		if (event["type"] === "response.output_item.done") {
			const item = event["item"];
			if (isRecord$3(item) && item["type"] === "compaction") {
				if (compaction !== void 0) throw new Error("OpenAI Codex compact response contained multiple compaction items");
				compaction = item;
			}
			return;
		}
		if (event["type"] === "response.failed" || event["type"] === "error") throw new Error(`OpenAI Codex compact stream failed: ${JSON.stringify(event).slice(0, 1e3)}`);
		if (event["type"] !== "response.completed" && event["type"] !== "response.done") return;
		const terminal = event["response"];
		if (!isRecord$3(terminal)) throw new Error("OpenAI Codex compact stream returned a malformed terminal event");
		const id = terminal["id"];
		if (id !== void 0 && typeof id !== "string") throw new Error("OpenAI Codex returned a malformed compact response id");
		responseId = id;
		const rawUsage = terminal["usage"];
		if (rawUsage !== void 0 && !isRecord$3(rawUsage)) throw new Error("OpenAI Codex returned malformed compact usage");
		usage = rawUsage;
		completed = true;
	};
	try {
		while (true) {
			const { done, value } = await reader.read();
			buffer += decoder.decode(value, { stream: !done });
			let boundary = buffer.search(/\r?\n\r?\n/);
			while (boundary >= 0) {
				const match = /\r?\n\r?\n/.exec(buffer);
				if (match === null) break;
				consumeEvent(buffer.slice(0, match.index));
				buffer = buffer.slice(match.index + match[0].length);
				boundary = buffer.search(/\r?\n\r?\n/);
			}
			if (done) break;
		}
		if (buffer.trim().length > 0) consumeEvent(buffer);
	} finally {
		reader.releaseLock();
	}
	if (!completed) throw new Error("OpenAI Codex compact stream ended before response.completed");
	if (compaction === void 0) throw new Error("OpenAI Codex compact response did not contain a compaction item");
	return {
		...responseId === void 0 ? {} : { id: responseId },
		output: [...retained, compaction],
		...usage === void 0 ? {} : { usage }
	};
}
/** Match Codex V2's durable-history shape: recent client messages plus the opaque item. */
function retainedCompactionInput(input) {
	return input.filter((item) => isRecord$3(item) && (item["role"] === "user" || item["role"] === "developer" || item["role"] === "system"));
}
/** Mutable request policy shared by the Harness adapter and its pi-ai provider. */
var OpenAICodexResponseRuntime = class {
	preferences;
	compactionCalls = /* @__PURE__ */ new Map();
	constructor(preferences) {
		this.preferences = preferences;
	}
	/** Mark one Harness stream call as compaction until its iterator closes. */
	enterCompaction(sessionId) {
		const key = sessionKey(sessionId);
		this.compactionCalls.set(key, (this.compactionCalls.get(key) ?? 0) + 1);
		return () => {
			const remaining = (this.compactionCalls.get(key) ?? 1) - 1;
			if (remaining <= 0) this.compactionCalls.delete(key);
			else this.compactionCalls.set(key, remaining);
		};
	}
	/** Add Codex-only request behavior without changing the provider catalog or OAuth flow. */
	wrap(provider) {
		return {
			...provider,
			streamSimple: (model, context, options) => this.streamSimple(provider, model, context, options)
		};
	}
	streamSimple(provider, model, context, options) {
		const key = sessionKey(options?.sessionId);
		const compaction = (this.compactionCalls.get(key) ?? 0) > 0;
		const preferences = this.preferences();
		if (compaction && preferences.useNativeCompaction) return this.nativeCompactionStream(provider, model, context, options);
		return this.standardStream(provider, model, context, options, !compaction && preferences.useWebSocketContextReuse);
	}
	standardStream(provider, model, context, options, reuseWebSocketContext) {
		return provider.streamSimple(model, context, {
			...options,
			transport: reuseWebSocketContext ? "websocket-cached" : "sse",
			onPayload: async (payload, payloadModel) => {
				if (!isRecord$3(payload)) throw new Error("OpenAI Codex generated a non-object Responses payload");
				const input = Array.isArray(payload["input"]) ? expandNativeCompactionMarkers(payload["input"]) : payload["input"];
				const transformed = {
					...payload,
					input
				};
				return options?.onPayload === void 0 ? transformed : await options.onPayload(transformed, payloadModel);
			}
		});
	}
	nativeCompactionStream(provider, model, context, options) {
		const target = createAssistantMessageEventStream();
		this.requestNativeCompaction(model, context, options).then((response) => {
			const source = markerStream(model, response);
			(async () => {
				for await (const event of source) target.push(event);
			})();
		}, (error) => {
			const source = options?.signal?.aborted === true ? failedStream(model, error, options.signal) : this.standardStream(provider, model, context, options, false);
			(async () => {
				for await (const event of source) target.push(event);
			})();
		});
		return target;
	}
	async requestNativeCompaction(model, context, options) {
		const access = options?.apiKey;
		if (access === void 0 || access.length === 0) throw new Error("OpenAI Codex compact request has no OAuth token");
		const messages = context.messages.length === 0 ? [] : context.messages.slice(0, -1);
		const input = expandNativeCompactionMarkers(convertResponsesMessages(model, {
			...context,
			messages
		}, CODEX_TOOL_CALL_PROVIDERS, { includeSystemPrompt: false }));
		const compat = model.compat;
		const supportsStrictMode = compat?.supportsStrictMode ?? true;
		const supportsOpenAIGrammarTools = compat?.supportsOpenAIGrammarTools ?? false;
		const tools = context.tools === void 0 || context.tools.length === 0 ? void 0 : convertResponsesTools(context.tools, {
			strict: null,
			supportsStrictMode,
			supportsOpenAIGrammarTools
		});
		const mappedEffort = options?.reasoning === void 0 ? void 0 : model.thinkingLevelMap?.[options.reasoning] ?? options.reasoning;
		const retained = retainedCompactionInput(input);
		let body = {
			model: model.id,
			store: false,
			stream: true,
			input: [...input, { type: "compaction_trigger" }],
			instructions: context.systemPrompt ?? "",
			...tools === void 0 ? {} : { tools },
			tool_choice: "auto",
			parallel_tool_calls: true,
			include: ["reasoning.encrypted_content"],
			...mappedEffort === void 0 || mappedEffort === null ? {} : { reasoning: {
				effort: mappedEffort,
				summary: "auto"
			} },
			...options?.sessionId === void 0 ? {} : { prompt_cache_key: options.sessionId },
			text: { verbosity: "low" }
		};
		if (options?.onPayload !== void 0) body = await options.onPayload(body, model) ?? body;
		if (!isRecord$3(body)) throw new Error("OpenAI Codex generated a non-object compact Responses payload");
		const headers = new Headers(model.headers);
		for (const [key, value] of Object.entries(options?.headers ?? {})) if (value === null) headers.delete(key);
		else headers.set(key, value);
		headers.set("authorization", `Bearer ${access}`);
		headers.set("chatgpt-account-id", accountIdFromToken$2(access));
		headers.set("originator", "dsh-codex");
		headers.set("accept", "text/event-stream");
		headers.set("content-type", "application/json");
		headers.set("openai-beta", "responses=experimental");
		if (options?.sessionId !== void 0) {
			headers.set("session-id", options.sessionId);
			headers.set("thread-id", options.sessionId);
			headers.set("x-client-request-id", options.sessionId);
		}
		headers.set("x-codex-routing-hint", `model=${model.id}`);
		const maxRetries = Math.min(MAX_NATIVE_COMPACTION_RETRIES, Math.max(0, options?.maxRetries ?? MAX_NATIVE_COMPACTION_RETRIES));
		let lastError;
		for (let attempt = 0; attempt <= maxRetries; attempt++) {
			let response;
			try {
				const signal = requestSignal(options?.signal, options?.timeoutMs);
				response = await fetch(OPENAI_CODEX_RESPONSES_URL, {
					method: "POST",
					headers,
					body: JSON.stringify(body),
					...signal === void 0 ? {} : { signal }
				});
			} catch (error) {
				if (options?.signal?.aborted === true || attempt === maxRetries) throw error;
				lastError = error;
				await waitForRetry(Math.min(4e3, 500 * 2 ** attempt), options?.signal);
				continue;
			}
			await options?.onResponse?.({
				status: response.status,
				headers: responseHeaders(response.headers)
			}, model);
			if (response.ok) return await compactResponse(response, retained);
			const detail = (await response.text()).slice(0, 1e3);
			const error = /* @__PURE__ */ new Error(`OpenAI Codex compact request failed with HTTP ${response.status}${detail.length === 0 ? "" : `: ${detail}`}`);
			if (!retryableStatus(response.status) || attempt === maxRetries) throw error;
			lastError = error;
			await waitForRetry(retryDelayMs(response, attempt), options?.signal);
		}
		throw lastError;
	}
};
//#endregion
//#region src/adapter.ts
/** OpenAI Codex adapter assembled from public dsh-llm-pi-ai extension points. */
/** Return a detached copy of the complete pi-ai Codex model catalog. */
function openAICodexModelCatalog() {
	return openaiCodexProvider().getModels().map((model) => ({
		id: model.id,
		name: model.name
	}));
}
/** Provider idle ceiling used by the composite route. */
const OPENAI_CODEX_STREAM_IDLE_TIMEOUT_MS = 3e5;
function record(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value) ? value : void 0;
}
/** Lift the pre-rc.7 pi-ai replay shape into the current envelope on read. */
function migrateLegacyOpenAICodexReplayState(value) {
	const legacy = record(value);
	if (legacy?.["kind"] !== "pi-ai" || legacy["version"] !== 1 || !Array.isArray(legacy["blocks"])) return value;
	const { blocks, kind: _kind, version: _version, ...response } = legacy;
	return {
		response: {
			...response,
			kind: "pi-ai",
			version: 2
		},
		blocks
	};
}
function migrateReplayHistory(options) {
	let changed = false;
	const messages = options.messages.map((message) => {
		if (message.source.kind !== "model" || message.source.replayState === void 0) return message;
		const replayState = migrateLegacyOpenAICodexReplayState(message.source.replayState);
		if (replayState === message.source.replayState) return message;
		changed = true;
		return {
			...message,
			source: {
				...message.source,
				replayState
			}
		};
	});
	return changed ? {
		...options,
		messages
	} : options;
}
/**
* Codex traffic rides on chatgpt.com, which is frequently reached through a
* local proxy tunnel that blips for tens of seconds at a time. The dsh
* default stops after 2 retries and caps scheduled delays at 10 seconds, so
* this provider retries longer and backs off further to ride out such a blip.
*/
const OPENAI_CODEX_RETRY_POLICY = resolveRetryPolicy({
	mode: "normal",
	maxRetries: 5,
	backoff: {
		initialDelayMs: 1e3,
		maxDelayMs: 3e4,
		jitterRatio: .2
	}
}, "dsh-openai-codex retryPolicy");
/**
* Give the generic dsh adapter a request-scoped bearer-token entry without
* changing the provider's user-facing OAuth flow. The resolver accepts only
* the explicit override supplied by this plugin; it never discovers an API
* key from the environment or persistent api-key credentials.
*/
function isPayloadRecord(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
/** Add the request-scoped Fast Mode hint without changing other payload fields. */
function withOpenAICodexFastMode(provider, fastMode) {
	const streamSimple = provider.streamSimple;
	return {
		...provider,
		streamSimple(model, context, options) {
			if (!(provider.id === "openai-codex" && model.provider === "openai-codex" && fastMode?.isEnabled(options?.sessionId) === true)) return streamSimple.call(provider, model, context, options);
			const previousOnPayload = options?.onPayload;
			return streamSimple.call(provider, model, context, {
				...options,
				async onPayload(payload, payloadModel) {
					const replaced = await previousOnPayload?.(payload, payloadModel);
					const nextPayload = replaced === void 0 ? payload : replaced;
					return isPayloadRecord(nextPayload) ? {
						...nextPayload,
						service_tier: "priority"
					} : nextPayload;
				}
			});
		}
	};
}
function requestProvider(provider, fastMode) {
	return {
		...withOpenAICodexFastMode(provider, fastMode),
		auth: {
			...provider.auth,
			apiKey: {
				name: "OpenAI Codex OAuth bearer token",
				async resolve({ credential }) {
					const apiKey = credential?.key;
					return apiKey === void 0 || apiKey.length === 0 ? void 0 : {
						auth: { apiKey },
						source: "OAuth"
					};
				}
			}
		}
	};
}
/** Preserve Harness call purpose until the generic pi-ai adapter reaches the provider. */
var OpenAICodexAdapter = class extends PiAiAdapter {
	responses;
	visibleModelIds;
	constructor(options, responses, visibleModelIds) {
		super(options);
		this.responses = responses;
		this.visibleModelIds = visibleModelIds;
	}
	async listModels(provider) {
		const models = await super.listModels(provider);
		const visibleModelIds = this.visibleModelIds?.();
		if (visibleModelIds === void 0) return models;
		const visible = new Set(visibleModelIds);
		return models.filter((model) => visible.has(model.id));
	}
	async *stream(options) {
		const release = options.purpose === "compaction" ? this.responses.enterCompaction(options.sessionId === void 0 ? void 0 : String(options.sessionId)) : void 0;
		try {
			for await (const chunk of super.stream(migrateReplayHistory(options))) yield chunk;
		} finally {
			release?.();
		}
	}
};
/**
* Create the Codex subscription adapter without requiring a dsh fork. The
* public pi-ai adapter owns Harness message conversion, image attachment
* resolution, streaming, and reasoning metadata. This plugin adds optional
* Codex-native request state/compaction and supplies the provider OAuth token.
*/
function createOpenAICodexAdapter(credentials, resolveAttachments, responsePreferences, fastMode, visibleModelIds) {
	const provider = openaiCodexProvider();
	const responses = new OpenAICodexResponseRuntime(responsePreferences);
	const profile = {
		provider: OPENAI_CODEX_PROVIDER,
		displayName: "OpenAI Codex",
		streamIdleTimeoutMs: OPENAI_CODEX_STREAM_IDLE_TIMEOUT_MS,
		retryPolicy: OPENAI_CODEX_RETRY_POLICY,
		configuredMaxTokens: /* @__PURE__ */ new Map(),
		piProvider: responses.wrap(requestProvider(provider, fastMode))
	};
	const profiles = /* @__PURE__ */ new Map([[OPENAI_CODEX_PROVIDER, profile]]);
	const models = createModels({ credentials });
	models.setProvider(provider);
	return new OpenAICodexAdapter({
		profiles: () => profiles,
		resolveApiKey: async () => (await models.getAuth(OPENAI_CODEX_PROVIDER))?.auth.apiKey,
		resolveAttachments
	}, responses, visibleModelIds);
}
//#endregion
//#region src/auth.ts
/**
* OpenAI Codex OAuth orchestration shared by the plugin and standalone launcher.
* @module dsh-codex/auth
*/
/**
* Complete provider-native OAuth and persist the resulting credential.
* @param interaction - terminal or UI callbacks for the provider flow.
* @param store - credential store, defaulting under `$DSH_HOME`.
*/
async function loginOpenAICodex(interaction, store = new OpenAICodexCredentialStore()) {
	const models = createModels({ credentials: store });
	models.setProvider(openaiCodexProvider());
	await models.login(OPENAI_CODEX_PROVIDER, "oauth", interaction);
}
/**
* Remove the stored OpenAI Codex credential.
* @param store - credential store, defaulting under `$DSH_HOME`.
*/
async function logoutOpenAICodex(store = new OpenAICodexCredentialStore()) {
	await store.delete(OPENAI_CODEX_PROVIDER);
}
/**
* Read non-secret OpenAI Codex login state without refreshing the token.
* @param store - credential store, defaulting under `$DSH_HOME`.
* @returns stored login state and expiry.
*/
async function openAICodexAuthStatus(store = new OpenAICodexCredentialStore()) {
	const credential = await store.read(OPENAI_CODEX_PROVIDER);
	return credential?.type === "oauth" ? {
		authenticated: true,
		expiresAt: new Date(credential.expires)
	} : { authenticated: false };
}
//#endregion
//#region src/usage.ts
/** Live ChatGPT Codex rate-limit usage for the browser account page. */
/** Fixed endpoint used by the official Codex client for ChatGPT rate limits. */
const OPENAI_CODEX_USAGE_URL = "https://chatgpt.com/backend-api/wham/usage";
const USAGE_REQUEST_TIMEOUT_MS = 15e3;
/** Stable public discriminant for an expired or revoked Codex OAuth session. */
const OPENAI_CODEX_REAUTH_REQUIRED_CODE = "OPENAI_CODEX_REAUTH_REQUIRED";
/** Fixed, secret-free message for a browser-facing reauthorization prompt. */
const OPENAI_CODEX_REAUTH_REQUIRED_MESSAGE = "OpenAI Codex authorization must be renewed";
/**
* Raised when the usage endpoint rejects the current OAuth session.
*
* The error intentionally carries no response, credential, or account data so
* callers can safely pass its fixed message across the Web boundary.
*/
var OpenAICodexReauthRequiredError = class extends Error {
	code = OPENAI_CODEX_REAUTH_REQUIRED_CODE;
	constructor() {
		super(OPENAI_CODEX_REAUTH_REQUIRED_MESSAGE);
		this.name = "OpenAICodexReauthRequiredError";
	}
};
/** Identify the dedicated reauthorization failure without comparing messages. */
function isOpenAICodexReauthRequiredError(error) {
	return error instanceof OpenAICodexReauthRequiredError;
}
function isRecord$2(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
/** JavaScript Date's maximum representable instant, expressed in Unix seconds. */
const MAX_DATE_UNIX_SECONDS = Math.floor(864e10);
function parseResetAt(record) {
	if (!Object.hasOwn(record, "reset_at")) return void 0;
	const value = record["reset_at"];
	if (value === null) return void 0;
	if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0 || value > MAX_DATE_UNIX_SECONDS) throw new Error("OpenAI Codex returned an invalid rate-limit reset time");
	if (!Number.isFinite((/* @__PURE__ */ new Date(value * 1e3)).getTime())) throw new Error("OpenAI Codex returned an invalid rate-limit reset time");
	return value;
}
function parseWindow(value) {
	if (value === void 0 || value === null) return void 0;
	if (!isRecord$2(value)) throw new Error("OpenAI Codex returned a malformed rate-limit window");
	const usedPercent = value["used_percent"];
	const windowSeconds = value["limit_window_seconds"];
	if (typeof usedPercent !== "number" || !Number.isFinite(usedPercent) || usedPercent < 0 || usedPercent > 100) throw new Error("OpenAI Codex returned an invalid used percentage");
	if (typeof windowSeconds !== "number" || !Number.isInteger(windowSeconds) || windowSeconds <= 0) throw new Error("OpenAI Codex returned an invalid rate-limit window duration");
	const resetAt = parseResetAt(value);
	return {
		remainingPercent: 100 - usedPercent,
		windowSeconds,
		...resetAt === void 0 ? {} : { resetAt }
	};
}
function parseLimit(id, name, value) {
	if (value === void 0 || value === null) return void 0;
	if (!isRecord$2(value)) throw new Error("OpenAI Codex returned malformed rate-limit details");
	const windows = [parseWindow(value["primary_window"]), parseWindow(value["secondary_window"])].filter((window) => window !== void 0);
	return windows.length === 0 ? void 0 : {
		id,
		...name === void 0 ? {} : { name },
		windows
	};
}
function exactAmount(record, key) {
	const value = record[key];
	if (typeof value !== "string" || value.length === 0 || value.length > 64 || !/^-?\d+(?:\.\d+)?$/u.test(value)) throw new Error(`OpenAI Codex returned an invalid ${key} amount`);
	return value;
}
function parseCredits(value) {
	if (value === void 0 || value === null) return void 0;
	if (!isRecord$2(value) || typeof value["has_credits"] !== "boolean" || typeof value["unlimited"] !== "boolean") throw new Error("OpenAI Codex returned malformed credit details");
	if (!value["has_credits"]) return void 0;
	const balance = value["balance"];
	if (balance !== void 0 && balance !== null && (typeof balance !== "string" || balance.length === 0 || balance.length > 64 || !/^-?\d+(?:\.\d+)?$/u.test(balance))) throw new Error("OpenAI Codex returned an invalid credit balance");
	return {
		unlimited: value["unlimited"],
		...typeof balance === "string" ? { balance } : {}
	};
}
function parseIndividualLimit(value) {
	if (value === void 0 || value === null) return void 0;
	if (!isRecord$2(value)) throw new Error("OpenAI Codex returned malformed spend-control details");
	const individual = value["individual_limit"];
	if (individual === void 0 || individual === null) return void 0;
	if (!isRecord$2(individual)) throw new Error("OpenAI Codex returned a malformed individual limit");
	const remainingPercent = individual["remaining_percent"];
	if (typeof remainingPercent !== "number" || !Number.isFinite(remainingPercent) || remainingPercent < 0 || remainingPercent > 100) throw new Error("OpenAI Codex returned an invalid individual-limit percentage");
	return {
		limit: exactAmount(individual, "limit"),
		used: exactAmount(individual, "used"),
		remaining: exactAmount(individual, "remaining"),
		remainingPercent
	};
}
/**
* Convert the provider response into the small secret-free object sent to the browser.
* @param value - opaque JSON returned by the ChatGPT usage endpoint.
* @returns core and additionally metered quota buckets with remaining percentages.
*/
function parseOpenAICodexUsage(value) {
	if (!isRecord$2(value)) throw new Error("OpenAI Codex returned a malformed usage response");
	const limits = [];
	const primary = parseLimit("codex", "Codex", value["rate_limit"]);
	if (primary !== void 0) limits.push(primary);
	const additional = value["additional_rate_limits"];
	if (additional !== void 0 && additional !== null && !Array.isArray(additional)) throw new Error("OpenAI Codex returned malformed additional rate limits");
	for (const item of additional ?? []) {
		if (!isRecord$2(item)) throw new Error("OpenAI Codex returned a malformed additional rate limit");
		const id = item["metered_feature"];
		const name = item["limit_name"];
		if (typeof id !== "string" || id.length === 0) throw new Error("OpenAI Codex returned an additional rate limit without an id");
		if (name !== void 0 && name !== null && typeof name !== "string") throw new Error("OpenAI Codex returned an invalid additional rate-limit name");
		const limit = parseLimit(id, typeof name === "string" && name.length > 0 ? name : void 0, item["rate_limit"]);
		if (limit !== void 0) limits.push(limit);
	}
	const credits = parseCredits(value["credits"]);
	const individualLimit = parseIndividualLimit(value["spend_control"]);
	return {
		rateLimits: limits,
		...credits === void 0 ? {} : { credits },
		...individualLimit === void 0 ? {} : { individualLimit }
	};
}
/**
* Read current quota without issuing a model request. OAuth is refreshed through
* the same provider-native credential lifecycle used by normal Codex turns.
* @param store - plugin-owned OAuth credential store.
* @returns current rate-limit buckets safe to expose to the local browser page.
*/
async function readOpenAICodexRateLimits(store) {
	const models = createModels({ credentials: store });
	models.setProvider(openaiCodexProvider());
	const auth = await models.getAuth(OPENAI_CODEX_PROVIDER);
	const credential = await store.read(OPENAI_CODEX_PROVIDER);
	const access = auth?.auth.apiKey;
	const accountId = credential?.type === "oauth" ? credential.accountId : void 0;
	if (access === void 0 || access.length === 0 || typeof accountId !== "string" || accountId.length === 0) throw new Error("OpenAI Codex is signed out");
	const response = await fetch(OPENAI_CODEX_USAGE_URL, {
		method: "GET",
		redirect: "error",
		headers: {
			authorization: `Bearer ${access}`,
			"chatgpt-account-id": accountId,
			accept: "application/json",
			"cache-control": "no-store",
			"user-agent": "dsh-openai-codex"
		},
		signal: AbortSignal.timeout(USAGE_REQUEST_TIMEOUT_MS)
	});
	if (!response.ok) {
		if (response.status === 401 || response.status === 403) throw new OpenAICodexReauthRequiredError();
		throw new Error(`OpenAI Codex usage request failed with HTTP ${response.status}`);
	}
	let value;
	try {
		value = await response.json();
	} catch (error) {
		throw new Error("OpenAI Codex returned an unreadable usage response", { cause: error });
	}
	return parseOpenAICodexUsage(value);
}
//#endregion
//#region src/auth-paths.ts
/** Node-free route constants shared by the Host and browser plugin halves. */
/** Plugin-owned status endpoint consumed by its browser half. */
const OPENAI_CODEX_AUTH_STATUS_PATH = "/plugins/dsh-openai-codex/auth/status";
/** Plugin-owned browser-login endpoint consumed by its browser half. */
const OPENAI_CODEX_AUTH_LOGIN_PATH = "/plugins/dsh-openai-codex/auth/login";
/** Plugin-owned logout endpoint consumed by its browser half. */
const OPENAI_CODEX_AUTH_LOGOUT_PATH = "/plugins/dsh-openai-codex/auth/logout";
//#endregion
//#region src/trusted-origins.ts
/** Owner-only allowlist for browser origins that may reach the Web OAuth routes. */
/** Basename of the DSH-home-scoped browser-origin allowlist. */
const OPENAI_CODEX_TRUSTED_ORIGINS_FILENAME = ".openai-codex-trusted-origins.json";
/** Only supported policy mode; a future mode must not be silently accepted. */
const TRUSTED_ORIGINS_MODE = "allowlist";
/** Whether a filesystem error reports an absent path. */
function isENOENT(error) {
	return error?.code === "ENOENT";
}
/** Reject a sidecar readable by another POSIX user. */
async function assertOwnerOnly(filename) {
	let metadata;
	try {
		metadata = await lstat(filename);
	} catch (error) {
		if (isENOENT(error)) return;
		throw error;
	}
	if (!metadata.isFile()) throw new Error(`openai-codex: ${filename} is not a regular file`);
	/* v8 ignore next -- native Windows coverage takes the mode-less branch */
	if (process.platform === "win32") return;
	/* v8 ignore start -- POSIX tests cover this branch; Windows cannot express it */
	if ((metadata.mode & 63) !== 0) throw new Error(`openai-codex: ${filename} is readable beyond its owner (mode ${(metadata.mode & 511).toString(8)}); run "chmod 600 ${filename}" before starting again`);
	/* v8 ignore stop */
}
/** Reject malformed input without echoing its contents into an error. */
function parseDocument(text, filename) {
	let value;
	try {
		value = JSON.parse(text);
	} catch {
		throw new Error(`openai-codex: ${filename} is not valid JSON`);
	}
	if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error(`openai-codex: ${filename} must contain an object`);
	const document = value;
	if (Object.keys(document).some((key) => ![
		"version",
		"mode",
		"origins"
	].includes(key))) throw new Error(`openai-codex: ${filename} contains an unknown top-level field`);
	if (document["version"] !== 1) throw new Error(`openai-codex: ${filename} has unsupported trusted-origins format version ${String(document["version"])}`);
	if (document["mode"] !== "allowlist") throw new Error(`openai-codex: ${filename} has unsupported trusted-origins mode`);
	const rawOrigins = document["origins"];
	if (!Array.isArray(rawOrigins)) throw new Error(`openai-codex: ${filename} origins must be an array`);
	const origins = /* @__PURE__ */ new Set();
	for (const rawOrigin of rawOrigins) {
		if (typeof rawOrigin !== "string") throw new Error(`openai-codex: ${filename} origins must contain strings`);
		try {
			origins.add(normalizeTrustedOrigin(rawOrigin));
		} catch {
			throw new Error(`openai-codex: ${filename} contains an invalid trusted origin`);
		}
	}
	return {
		version: 1,
		mode: TRUSTED_ORIGINS_MODE,
		origins: [...origins].sort()
	};
}
/**
* Normalize one exact browser origin.
*
* Only HTTP(S) origins are accepted. Credentials, non-root paths, queries,
* fragments, wildcards, and CIDR-looking host paths are rejected. WHATWG URL
* normalization lowercases the scheme/host and removes default ports.
*/
function normalizeTrustedOrigin(rawOrigin) {
	if (typeof rawOrigin !== "string" || rawOrigin.length === 0 || rawOrigin.trim() !== rawOrigin) throw new Error("trusted origin must be a non-empty URL without surrounding whitespace");
	let origin;
	try {
		origin = new URL(rawOrigin);
	} catch {
		throw new Error("trusted origin must be a valid URL");
	}
	if (origin.protocol !== "http:" && origin.protocol !== "https:") throw new Error("trusted origin protocol must be http or https");
	if (origin.username !== "" || origin.password !== "") throw new Error("trusted origin must not contain credentials");
	if (origin.pathname !== "/" || origin.search !== "" || origin.hash !== "") throw new Error("trusted origin must not contain a path, query, or fragment");
	if (origin.hostname === "" || origin.hostname.includes("*")) throw new Error("trusted origin host must be exact");
	if (origin.pathname !== "/" || /(?:^|\/)\d+\/\d+$/u.test(rawOrigin)) throw new Error("trusted origin must not be a CIDR or path");
	if (origin.origin === "null") throw new Error("trusted origin must have an HTTP(S) host");
	return origin.origin;
}
/** Resolve the sidecar path under one DSH home. */
function openAICodexTrustedOriginsPath(dshHome) {
	return resolve(join(resolveDshHome(dshHome), OPENAI_CODEX_TRUSTED_ORIGINS_FILENAME));
}
/** File-backed exact-origin allowlist. */
var OpenAICodexTrustedOriginsStore = class {
	/** Absolute sidecar path. */
	filename;
	constructor(filename = openAICodexTrustedOriginsPath()) {
		this.filename = resolve(filename);
	}
	async readCurrent() {
		await assertOwnerOnly(this.filename);
		let text;
		try {
			text = await readFile(this.filename, "utf8");
		} catch (error) {
			if (isENOENT(error)) return {
				version: 1,
				mode: TRUSTED_ORIGINS_MODE,
				origins: []
			};
			throw error;
		}
		return parseDocument(text, this.filename);
	}
	/** Read the current canonical list without acquiring the writer lock. */
	async list() {
		return [...(await this.readCurrent()).origins];
	}
	/** Whether an exact normalized origin is currently trusted. */
	async has(origin) {
		const normalized = normalizeTrustedOrigin(origin);
		return (await this.readCurrent()).origins.includes(normalized);
	}
	/** Add one origin idempotently and return the resulting sorted list. */
	async trust(origin) {
		const normalized = normalizeTrustedOrigin(origin);
		await mkdir(dirname(this.filename), {
			recursive: true,
			mode: 448
		});
		return withFileLock(this.filename, async () => {
			const current = await this.readCurrent();
			if (current.origins.includes(normalized)) return [...current.origins];
			const next = {
				version: 1,
				mode: TRUSTED_ORIGINS_MODE,
				origins: [...current.origins, normalized].sort()
			};
			await writeFileAtomic(this.filename, `${JSON.stringify(next, null, 2)}\n`, {
				mode: 384,
				dirMode: 448
			});
			return [...next.origins];
		});
	}
	/** Remove one origin idempotently and return the resulting sorted list. */
	async untrust(origin) {
		const normalized = normalizeTrustedOrigin(origin);
		await mkdir(dirname(this.filename), {
			recursive: true,
			mode: 448
		});
		return withFileLock(this.filename, async () => {
			const current = await this.readCurrent();
			if (!current.origins.includes(normalized)) return [...current.origins];
			const next = {
				version: 1,
				mode: TRUSTED_ORIGINS_MODE,
				origins: current.origins.filter((candidate) => candidate !== normalized)
			};
			await writeFileAtomic(this.filename, `${JSON.stringify(next, null, 2)}\n`, {
				mode: 384,
				dirMode: 448
			});
			return [...next.origins];
		});
	}
};
//#endregion
//#region src/fast-mode.ts
/** Process-local, per-session OpenAI Codex Fast Mode state. */
/** Maximum number of enabled sessions retained by one plugin instance. */
const OPENAI_CODEX_FAST_MODE_MAX_SESSIONS = 256;
/** Maximum UTF-16 code units accepted for an opaque DSH session id. */
const OPENAI_CODEX_FAST_MODE_MAX_SESSION_ID_LENGTH = 256;
/**
* Validate the opaque session identity used by the Fast Mode registry.
*
* The registry deliberately does not interpret or normalize session ids.  It
* only rejects values that cannot safely serve as a bounded map key.
*/
function isFastModeSessionId(value) {
	return typeof value === "string" && value.trim().length > 0 && value.length <= 256;
}
/**
* In-memory Fast Mode registry.  Entries are positive-only: disabling a
* session removes its key, and an insertion over the bound evicts the least
* recently touched key.  A new plugin instance starts with an empty map.
*/
var FastModeRegistry = class {
	maxSessions;
	enabledSessions = /* @__PURE__ */ new Map();
	constructor(maxSessions = 256) {
		this.maxSessions = maxSessions;
		if (!Number.isSafeInteger(maxSessions) || maxSessions < 1 || maxSessions > 256) throw new RangeError("Fast Mode registry capacity is out of bounds");
	}
	/** Number of currently enabled sessions. */
	get size() {
		return this.enabledSessions.size;
	}
	/** Read one session without exposing the map or any credential state. */
	isEnabled(sessionId) {
		if (!isFastModeSessionId(sessionId)) return false;
		if (this.enabledSessions.get(sessionId) === void 0) return false;
		this.enabledSessions.delete(sessionId);
		this.enabledSessions.set(sessionId, true);
		return true;
	}
	/** Alias useful to callers that model this as a boolean setting. */
	get(sessionId) {
		return this.isEnabled(sessionId);
	}
	/** Enable or disable exactly one opaque session id. */
	set(sessionId, enabled) {
		if (!isFastModeSessionId(sessionId)) throw new TypeError("Invalid Fast Mode session id");
		if (typeof enabled !== "boolean") throw new TypeError("Fast Mode enabled must be boolean");
		if (!enabled) {
			this.enabledSessions.delete(sessionId);
			return;
		}
		this.enabledSessions.delete(sessionId);
		while (this.enabledSessions.size >= this.maxSessions) {
			const oldest = this.enabledSessions.keys().next().value;
			if (oldest === void 0) break;
			this.enabledSessions.delete(oldest);
		}
		this.enabledSessions.set(sessionId, true);
	}
	/** Explicitly named alias for callers that avoid boolean-setting verbs. */
	setEnabled(sessionId, enabled) {
		this.set(sessionId, enabled);
	}
	/** Disable one session and forget its key. */
	delete(sessionId) {
		if (!isFastModeSessionId(sessionId)) return;
		this.enabledSessions.delete(sessionId);
	}
	/** Remove all process-local state during an explicit lifecycle teardown. */
	clear() {
		this.enabledSessions.clear();
	}
};
//#endregion
//#region src/fast-mode-paths.ts
/** Node-free Fast Mode route constants shared by Host and browser halves. */
/** GET/POST endpoint for one conversation's process-local Fast Mode state. */
const OPENAI_CODEX_FAST_MODE_PATH = "/plugins/dsh-openai-codex/fast-mode";
//#endregion
//#region src/auth-routes.ts
/** Plugin-owned image-tool preference endpoint consumed by its browser half. */
const OPENAI_CODEX_IMAGE_TOOL_SETTINGS_PATH = "/plugins/dsh-openai-codex/image-tools";
/** Plugin-owned Responses API experiment endpoint consumed by its browser half. */
const OPENAI_CODEX_RESPONSE_API_SETTINGS_PATH = "/plugins/dsh-openai-codex/response-api";
/** Plugin-owned model discovery preference endpoint consumed by its browser half. */
const OPENAI_CODEX_MODEL_CATALOG_SETTINGS_PATH = "/plugins/dsh-openai-codex/models";
/** Stable, non-sensitive error returned when a browser origin needs CLI trust. */
const REMOTE_WEB_ORIGIN_NOT_TRUSTED = "remote-web-origin-not-trusted";
/** Redact provider diagnostics before they cross to the browser. */
function safeMessage(error) {
	return (error instanceof Error ? error.message : String(error)).replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/gu, "[redacted token]").replace(/(\b(?:code|token|refresh_token|access_token)=)[^&\s]+/giu, "$1[redacted]").slice(0, 1e3);
}
/** Reject with the prompt's abort reason while browser callback owns completion. */
function waitForPromptAbort(prompt) {
	const signal = prompt.signal;
	if (signal === void 0) return new Promise(() => {});
	if (signal.aborted) return Promise.reject(signal.reason);
	return new Promise((_resolve, reject) => {
		signal.addEventListener("abort", () => {
			reject(signal.reason);
		}, { once: true });
	});
}
/** One lifecycle owner for the callback server, challenge, and public status. */
var OpenAICodexWebAuth = class {
	store;
	state = { status: "signed-out" };
	operation;
	cancellation;
	challenge;
	challengeWaiters = [];
	challengeTimer;
	challengeTimeoutMs;
	signInTimeoutMs;
	constructor(store, options = {}) {
		this.store = store;
		this.challengeTimeoutMs = options.challengeTimeoutMs ?? 3e4;
		this.signInTimeoutMs = options.signInTimeoutMs ?? 6e5;
		if (!Number.isFinite(this.challengeTimeoutMs) || this.challengeTimeoutMs <= 0) throw new TypeError("OpenAI Codex auth URL timeout must be a positive finite number");
		if (!Number.isFinite(this.signInTimeoutMs) || this.signInTimeoutMs <= 0) throw new TypeError("OpenAI Codex sign-in timeout must be a positive finite number");
	}
	/** Read current public state, consulting durable storage while idle. */
	async status() {
		if (this.operation !== void 0) return this.state;
		if (this.state.status === "error") return this.state;
		return this.readStoredStatus();
	}
	/** Start or join the current browser-login operation. */
	async signIn() {
		if (this.operation === void 0) this.start();
		if (this.challenge !== void 0) return this.challenge;
		return new Promise((resolve, reject) => {
			this.challengeWaiters.push({
				resolve,
				reject
			});
		});
	}
	/** Cancel any callback listener, wait for quiescence, then delete the credential. */
	async signOut() {
		this.cancelSignIn(/* @__PURE__ */ new Error("OpenAI Codex sign-in cancelled"));
		await this.operation?.catch(() => void 0);
		await logoutOpenAICodex(this.store);
		this.challenge = void 0;
		this.state = { status: "signed-out" };
	}
	/** Stop the owned callback listener during plugin disposal. */
	async dispose() {
		this.cancelSignIn(/* @__PURE__ */ new Error("OpenAI Codex plugin disposed"));
		await this.operation?.catch(() => void 0);
	}
	start() {
		const cancellation = new AbortController();
		this.cancellation = cancellation;
		this.challenge = void 0;
		this.state = { status: "signing-in" };
		this.challengeTimer = setTimeout(() => {
			this.cancelSignIn(/* @__PURE__ */ new Error(`OpenAI Codex did not provide an authorization URL within ${String(this.challengeTimeoutMs)}ms`));
		}, this.challengeTimeoutMs);
		this.challengeTimer.unref();
		const signInTimer = setTimeout(() => {
			this.cancelSignIn(/* @__PURE__ */ new Error("OpenAI Codex sign-in timed out waiting for the browser callback"));
		}, this.signInTimeoutMs);
		signInTimer.unref();
		this.operation = loginOpenAICodex({
			signal: cancellation.signal,
			prompt: (prompt) => prompt.type === "select" ? Promise.resolve("browser") : waitForPromptAbort(prompt),
			notify: (event) => {
				this.onEvent(event);
			}
		}, this.store).then(async () => {
			if (this.challenge === void 0) {
				const error = /* @__PURE__ */ new Error("OpenAI Codex sign-in finished without an authorization URL");
				this.rejectChallenge(error);
				this.state = {
					status: "error",
					message: safeMessage(error)
				};
				return;
			}
			this.state = await this.readStoredStatus();
		}, async (error) => {
			this.rejectChallenge(error);
			try {
				const stored = await this.readStoredStatus();
				if (stored.status === "signed-in") {
					this.state = stored;
					return;
				}
			} catch {}
			this.state = {
				status: "error",
				message: safeMessage(error)
			};
		}).finally(() => {
			this.clearChallengeTimer();
			clearTimeout(signInTimer);
			this.operation = void 0;
			this.cancellation = void 0;
		});
	}
	onEvent(event) {
		if (event.type !== "auth_url") return;
		let url;
		try {
			url = new URL(event.url);
		} catch {
			const error = /* @__PURE__ */ new Error("OpenAI returned an invalid authorization URL");
			this.cancelSignIn(error);
			return;
		}
		if (url.protocol !== "https:" || url.username !== "" || url.password !== "") {
			const error = /* @__PURE__ */ new Error("OpenAI returned an unsafe authorization URL");
			this.cancelSignIn(error);
			return;
		}
		const challenge = { url: event.url };
		this.challenge = challenge;
		this.clearChallengeTimer();
		for (const waiter of this.challengeWaiters.splice(0)) waiter.resolve(challenge);
	}
	async readStoredStatus() {
		if (!(await openAICodexAuthStatus(this.store)).authenticated) return { status: "signed-out" };
		try {
			return {
				status: "signed-in",
				usage: await readOpenAICodexRateLimits(this.store)
			};
		} catch (error) {
			if (isOpenAICodexReauthRequiredError(error)) return {
				status: "reauth-required",
				message: OPENAI_CODEX_REAUTH_REQUIRED_MESSAGE
			};
			return {
				status: "signed-in",
				usage: { rateLimits: [] },
				quotaError: safeMessage(error)
			};
		}
	}
	rejectChallenge(error) {
		this.clearChallengeTimer();
		for (const waiter of this.challengeWaiters.splice(0)) waiter.reject(error);
	}
	clearChallengeTimer() {
		if (this.challengeTimer === void 0) return;
		clearTimeout(this.challengeTimer);
		this.challengeTimer = void 0;
	}
	cancelSignIn(error) {
		this.rejectChallenge(error);
		this.cancellation?.abort(error);
	}
};
function loopbackHost(rawHost) {
	if (/[\\/@?#]/u.test(rawHost)) return false;
	try {
		const parsed = new URL(`http://${rawHost}`);
		if (parsed.username !== "" || parsed.password !== "" || parsed.pathname !== "/" || parsed.search !== "" || parsed.hash !== "") return false;
		const hostname = (parsed.hostname.startsWith("[") && parsed.hostname.endsWith("]") ? parsed.hostname.slice(1, -1) : parsed.hostname).toLowerCase().replace(/\.$/u, "");
		return hostname === "localhost" || hostname.endsWith(".localhost") || hostname === "127.0.0.1" || hostname === "::1" || hostname === "::ffff:127.0.0.1";
	} catch {
		return false;
	}
}
function exactOrigin(req, rawHost, rawOrigin) {
	try {
		const effective = normalizeTrustedOrigin(`${req.socket.encrypted === true ? "https" : "http"}://${rawHost}`);
		return normalizeTrustedOrigin(rawOrigin) === effective;
	} catch {
		return false;
	}
}
function effectiveOrigin(req, rawHost) {
	try {
		return normalizeTrustedOrigin(`${req.socket.encrypted === true ? "https" : "http"}://${rawHost}`);
	} catch {
		return;
	}
}
function sameOriginMetadata(req, host) {
	const origin = req.headers.origin;
	if (origin === void 0) return true;
	return typeof origin === "string" && exactOrigin(req, host, origin);
}
/** Evaluate one request against loopback defaults and the current sidecar. */
async function trustedRequestDecision(req, trustedOrigins = new OpenAICodexTrustedOriginsStore()) {
	const remote = req.socket.remoteAddress;
	const localPeer = remote === "127.0.0.1" || remote === "::1" || remote === "::ffff:127.0.0.1";
	const fetchSite = req.headers["sec-fetch-site"];
	if (typeof fetchSite === "string" ? fetchSite.trim().toLowerCase() === "cross-site" : Array.isArray(fetchSite) && fetchSite.some((value) => value.trim().toLowerCase() === "cross-site")) return {
		trusted: false,
		error: "forbidden"
	};
	const host = req.headers.host;
	if (typeof host !== "string") return {
		trusted: false,
		error: "forbidden"
	};
	const origin = effectiveOrigin(req, host);
	if (origin === void 0) return {
		trusted: false,
		error: "forbidden"
	};
	if (!sameOriginMetadata(req, host)) return {
		trusted: false,
		error: "forbidden"
	};
	if (localPeer && loopbackHost(host)) return { trusted: true };
	try {
		if (await trustedOrigins.has(origin)) return { trusted: true };
	} catch {
		return {
			trusted: false,
			error: "forbidden"
		};
	}
	return {
		trusted: false,
		error: REMOTE_WEB_ORIGIN_NOT_TRUSTED
	};
}
function json(res, status, value) {
	res.writeHead(status, {
		"content-type": "application/json; charset=utf-8",
		"cache-control": "no-store",
		"x-content-type-options": "nosniff"
	});
	res.end(JSON.stringify(value));
}
function header(req, name) {
	const value = req.headers[name];
	if (Array.isArray(value)) return value[0];
	return value;
}
function contentLength(req) {
	const raw = header(req, "content-length");
	if (raw === void 0) return void 0;
	if (!/^\d+$/u.test(raw.trim())) throw new TypeError("Fast Mode request content length is invalid");
	const value = Number(raw);
	if (!Number.isSafeInteger(value)) throw new TypeError("Fast Mode request content length is invalid");
	return value;
}
/** Collect one small JSON body without exposing or logging its contents. */
async function readFastModeBody(req) {
	const declared = contentLength(req);
	if (declared !== void 0 && (!Number.isFinite(declared) || declared > 4096)) throw new RangeError("Fast Mode request body is too large");
	const chunks = [];
	let total = 0;
	const iterable = req;
	if (typeof req[Symbol.asyncIterator] === "function") for await (const chunk of iterable) {
		const bytes = typeof chunk === "string" ? Buffer.from(chunk) : new Uint8Array(chunk);
		total += bytes.byteLength;
		if (total > 4096) throw new RangeError("Fast Mode request body is too large");
		chunks.push(bytes);
	}
	else {
		const body = req.body;
		if (typeof body === "string") {
			const bytes = Buffer.from(body);
			if (bytes.byteLength > 4096) throw new RangeError("Fast Mode request body is too large");
			chunks.push(bytes);
		} else if (body instanceof Uint8Array) {
			if (body.byteLength > 4096) throw new RangeError("Fast Mode request body is too large");
			chunks.push(new Uint8Array(body));
		} else if (body !== void 0) throw new TypeError("Fast Mode request body is invalid");
	}
	const bytes = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)));
	if (bytes.byteLength === 0) throw new TypeError("Fast Mode request body is invalid");
	let text;
	try {
		text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
	} catch {
		throw new TypeError("Fast Mode request body is invalid");
	}
	try {
		return JSON.parse(text);
	} catch {
		throw new TypeError("Fast Mode request body is invalid");
	}
}
function fastModeSessionIdFromQuery(req) {
	const rawUrl = req.url;
	if (typeof rawUrl !== "string") return void 0;
	try {
		const values = new URL(rawUrl, "http://dsh.invalid").searchParams.getAll("sessionId");
		return values.length === 1 && isFastModeSessionId(values[0]) ? values[0] : void 0;
	} catch {
		return;
	}
}
function fastModeBody(value) {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return void 0;
	const record = value;
	if (Object.keys(record).length !== 2) return void 0;
	const sessionId = record["sessionId"];
	const enabled = record["enabled"];
	return isFastModeSessionId(sessionId) && typeof enabled === "boolean" ? {
		sessionId,
		enabled
	} : void 0;
}
async function readSettingsBody(req) {
	const value = await readFastModeBody(req);
	if (typeof value !== "object" || value === null || Array.isArray(value)) throw new TypeError("request body must be an object");
	return value;
}
function imagePreferencePatch(value) {
	const allowed = /* @__PURE__ */ new Set(["modifyReadImage", "shareImagegenWithOtherModels"]);
	if (Object.keys(value).some((key) => !allowed.has(key))) throw new TypeError("request contains an unknown image-tool setting");
	const patch = {};
	for (const key of allowed) {
		if (value[key] === void 0) continue;
		if (typeof value[key] !== "boolean") throw new TypeError(`${key} must be a boolean`);
		patch[key] = value[key];
	}
	return patch;
}
function responseApiPatch(value) {
	const allowed = /* @__PURE__ */ new Set(["useWebSocketContextReuse", "useNativeCompaction"]);
	if (Object.keys(value).some((key) => !allowed.has(key))) throw new TypeError("request contains an unknown Responses API setting");
	const patch = {};
	for (const key of allowed) {
		if (value[key] === void 0) continue;
		if (typeof value[key] !== "boolean") throw new TypeError(`${key} must be a boolean`);
		patch[key] = value[key];
	}
	return patch;
}
function modelCatalogPatch(value) {
	if (Object.keys(value).some((key) => key !== "models")) throw new TypeError("request contains an unknown model setting");
	const models = value["models"];
	if (!Array.isArray(models) || models.some((model) => typeof model !== "string")) throw new TypeError("models must be an array of strings");
	return { models };
}
/** Register the plugin-owned OAuth routes when the Web server is composed. */
function registerOpenAICodexAuthRoutes(ctx, store, trustedOriginsOverride, fastModeOverride, imageTools) {
	const auth = new OpenAICodexWebAuth(store);
	const storedFilename = store.filename;
	const fastMode = fastModeOverride ?? new FastModeRegistry();
	const trustedOrigins = trustedOriginsOverride ?? (typeof storedFilename === "string" ? new OpenAICodexTrustedOriginsStore(join(dirname(storedFilename), ".openai-codex-trusted-origins.json")) : new OpenAICodexTrustedOriginsStore());
	ctx.effect(() => {
		const authorize = async (req, res) => {
			const decision = await trustedRequestDecision(req, trustedOrigins);
			if (decision.trusted) return true;
			json(res, 403, { error: decision.error });
			return false;
		};
		const routes = [
			ctx.webServer.register({
				kind: "exact",
				path: OPENAI_CODEX_AUTH_STATUS_PATH,
				handler: async (req, res) => {
					if (req.method !== "GET") return json(res, 405, { error: "method not allowed" });
					if (!await authorize(req, res)) return;
					json(res, 200, await auth.status());
				}
			}),
			ctx.webServer.register({
				kind: "exact",
				path: OPENAI_CODEX_AUTH_LOGIN_PATH,
				handler: async (req, res) => {
					if (req.method !== "POST") return json(res, 405, { error: "method not allowed" });
					if (!await authorize(req, res)) return;
					try {
						json(res, 200, await auth.signIn());
					} catch (error) {
						json(res, 500, { error: safeMessage(error) });
					}
				}
			}),
			ctx.webServer.register({
				kind: "exact",
				path: OPENAI_CODEX_AUTH_LOGOUT_PATH,
				handler: async (req, res) => {
					if (req.method !== "POST") return json(res, 405, { error: "method not allowed" });
					if (!await authorize(req, res)) return;
					try {
						await auth.signOut();
						json(res, 200, { ok: true });
					} catch (error) {
						json(res, 500, { error: safeMessage(error) });
					}
				}
			}),
			ctx.webServer.register({
				kind: "exact",
				path: OPENAI_CODEX_FAST_MODE_PATH,
				handler: async (req, res) => {
					if (req.method !== "GET" && req.method !== "POST") return json(res, 405, { error: "method not allowed" });
					if (!await authorize(req, res)) return;
					if (req.method === "GET") {
						const sessionId = fastModeSessionIdFromQuery(req);
						if (sessionId === void 0) return json(res, 400, { error: "invalid input" });
						return json(res, 200, { enabled: fastMode.isEnabled(sessionId) });
					}
					const type = header(req, "content-type");
					if (type === void 0 || !/^application\/json(?:\s*;|$)/iu.test(type.trim())) return json(res, 415, { error: "unsupported content type" });
					try {
						const body = fastModeBody(await readFastModeBody(req));
						if (body === void 0) return json(res, 400, { error: "invalid input" });
						fastMode.set(body.sessionId, body.enabled);
						return json(res, 200, { enabled: fastMode.isEnabled(body.sessionId) });
					} catch (error) {
						return json(res, error instanceof RangeError ? 413 : 400, { error: error instanceof RangeError ? "request body too large" : "invalid input" });
					}
				}
			}),
			...imageTools === void 0 ? [] : [
				ctx.webServer.register({
					kind: "exact",
					path: OPENAI_CODEX_IMAGE_TOOL_SETTINGS_PATH,
					handler: async (req, res) => {
						if (!await authorize(req, res)) return;
						if (req.method === "GET") return json(res, 200, imageTools.snapshot());
						if (req.method !== "POST") return json(res, 405, { error: "method not allowed" });
						try {
							return json(res, 200, await imageTools.update(imagePreferencePatch(await readSettingsBody(req))));
						} catch (error) {
							return json(res, 400, { error: safeMessage(error) });
						}
					}
				}),
				ctx.webServer.register({
					kind: "exact",
					path: OPENAI_CODEX_RESPONSE_API_SETTINGS_PATH,
					handler: async (req, res) => {
						if (!await authorize(req, res)) return;
						if (req.method === "GET") return json(res, 200, imageTools.responseApiSnapshot());
						if (req.method !== "POST") return json(res, 405, { error: "method not allowed" });
						try {
							return json(res, 200, await imageTools.updateResponseApi(responseApiPatch(await readSettingsBody(req))));
						} catch (error) {
							return json(res, 400, { error: safeMessage(error) });
						}
					}
				}),
				ctx.webServer.register({
					kind: "exact",
					path: OPENAI_CODEX_MODEL_CATALOG_SETTINGS_PATH,
					handler: async (req, res) => {
						if (!await authorize(req, res)) return;
						if (req.method === "GET") return json(res, 200, imageTools.modelCatalogSnapshot());
						if (req.method !== "POST") return json(res, 405, { error: "method not allowed" });
						try {
							return json(res, 200, await imageTools.updateModelCatalog(modelCatalogPatch(await readSettingsBody(req))));
						} catch (error) {
							return json(res, 400, { error: safeMessage(error) });
						}
					}
				})
			]
		];
		return async () => {
			for (const dispose of routes) dispose();
			await auth.dispose();
		};
	}, "dsh-openai-codex: Web OAuth routes");
}
//#endregion
//#region src/image-capability.ts
/** Require the current conversation model to accept the image block a tool returns. */
async function assertImageCapable(ctx, exec, action) {
	const configured = exec.agent?.session.requestHeader()?.config;
	const provider = configured?.provider ?? exec.agent?.options.provider;
	const model = configured?.model ?? exec.agent?.options.model;
	if (provider === void 0 || model === void 0) throw new Error(`cannot ${action}: the current model route is unavailable`);
	const info = await ctx.llm.resolveModelInfo(provider, model, exec.signal);
	if (info.inputModalities === void 0 || !info.inputModalities.includes("image")) throw new Error(`cannot ${action}: model "${model}" does not declare image input`);
}
//#endregion
//#region src/public-http.ts
/** Public-network-only HTTP(S) reader used by the optional remote image path. */
/** Maximum time one DNS-plus-HTTP hop may occupy. */
const PUBLIC_HTTP_HOP_TIMEOUT_MS = 3e4;
function blockedList(family, ranges) {
	const list = new BlockList();
	for (const [address, prefix] of ranges) list.addSubnet(address, prefix, family);
	return list;
}
const BLOCKED_IPV4 = blockedList("ipv4", [
	["0.0.0.0", 8],
	["10.0.0.0", 8],
	["100.64.0.0", 10],
	["127.0.0.0", 8],
	["169.254.0.0", 16],
	["172.16.0.0", 12],
	["192.0.0.0", 24],
	["192.0.2.0", 24],
	["192.88.99.0", 24],
	["192.168.0.0", 16],
	["198.18.0.0", 15],
	["198.51.100.0", 24],
	["203.0.113.0", 24],
	["224.0.0.0", 4],
	["240.0.0.0", 4]
]);
const GLOBAL_IPV6 = blockedList("ipv6", [["2000::", 3]]);
const BLOCKED_IPV6 = blockedList("ipv6", [
	["2001::", 32],
	["2001:2::", 48],
	["2001:10::", 28],
	["2001:20::", 28],
	["2001:db8::", 32],
	["2002::", 16]
]);
function unbracket(hostname) {
	return hostname.startsWith("[") && hostname.endsWith("]") ? hostname.slice(1, -1) : hostname;
}
/** Whether an address is ordinary public unicast rather than a local/special target. */
function isPublicNetworkAddress(rawAddress) {
	const address = unbracket(rawAddress);
	if (address.includes("%")) return false;
	const family = isIP(address);
	if (family === 4) return !BLOCKED_IPV4.check(address, "ipv4");
	if (family === 6) return GLOBAL_IPV6.check(address, "ipv6") && !BLOCKED_IPV6.check(address, "ipv6");
	return false;
}
function abortError(signal) {
	return signal.reason instanceof Error ? signal.reason : new Error(signal.reason === void 0 ? "remote image request aborted" : String(signal.reason));
}
function assertTargetUrl(url) {
	if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("remote image URL must use http or https");
	if (url.username !== "" || url.password !== "") throw new Error("remote image URL must not contain credentials");
}
function normalizeAddress(candidate) {
	if (candidate.family !== 4 && candidate.family !== 6) throw new Error("remote image hostname resolved to an unsupported address family");
	return {
		address: candidate.address,
		family: candidate.family
	};
}
async function resolveHost(hostname, signal) {
	if (signal.aborted) throw abortError(signal);
	const literal = unbracket(hostname);
	const family = isIP(literal);
	if (family === 4 || family === 6) return [{
		address: literal,
		family
	}];
	const results = await lookup(literal, {
		all: true,
		order: "verbatim"
	});
	if (signal.aborted) throw abortError(signal);
	return results.map(normalizeAddress);
}
/** Collect one response body while enforcing declared and streaming size limits. */
async function collectBoundedBytes(body, declaredLength, maxBytes, signal) {
	const declared = declaredLength === void 0 ? NaN : Number(declaredLength);
	if (Number.isFinite(declared) && declared > maxBytes) throw new Error(`remote image exceeds ${String(maxBytes)} bytes`);
	const chunks = [];
	let total = 0;
	for await (const chunk of body) {
		if (signal.aborted) throw abortError(signal);
		const bytes = typeof chunk === "string" ? Buffer.from(chunk) : new Uint8Array(chunk);
		total += bytes.byteLength;
		if (total > maxBytes) throw new Error(`remote image exceeds ${String(maxBytes)} bytes`);
		chunks.push(bytes);
	}
	const data = new Uint8Array(total);
	let offset = 0;
	for (const chunk of chunks) {
		data.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return data;
}
function pinnedLookup(address) {
	return (_hostname, options, callback) => {
		const resolved = {
			address: address.address,
			family: address.family
		};
		if (options.all === true) callback(null, [resolved]);
		else callback(null, resolved.address, resolved.family);
	};
}
function headerValue(message, name) {
	const value = message.headers[name];
	return Array.isArray(value) ? value[0] : value;
}
async function requestPinned(url, address, maxBytes, signal) {
	if (signal.aborted) throw abortError(signal);
	return new Promise((resolve, reject) => {
		let settled = false;
		let response;
		const finish = (result) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			signal.removeEventListener("abort", onAbort);
			if (result.ok) resolve(result.value);
			else reject(result.error);
		};
		const request$2 = (url.protocol === "https:" ? request$1 : request)(url, {
			method: "GET",
			agent: false,
			lookup: pinnedLookup(address),
			headers: { accept: "image/png, image/jpeg, image/webp, image/gif" }
		}, (incoming) => {
			response = incoming;
			const status = incoming.statusCode ?? 0;
			const location = headerValue(incoming, "location");
			if (status >= 300 && status < 400 || status < 200 || status >= 300) {
				finish({
					ok: true,
					value: {
						status,
						...location === void 0 ? {} : { location }
					}
				});
				incoming.destroy();
				return;
			}
			collectBoundedBytes(incoming, headerValue(incoming, "content-length"), maxBytes, signal).then((data) => {
				finish({
					ok: true,
					value: {
						status,
						data
					}
				});
			}, (error) => {
				incoming.destroy(error instanceof Error ? error : void 0);
				finish({
					ok: false,
					error
				});
			});
		});
		const onAbort = () => {
			const error = abortError(signal);
			response?.destroy(error);
			request$2.destroy(error);
		};
		const timer = setTimeout(() => {
			const error = /* @__PURE__ */ new Error(`remote image request exceeded ${String(PUBLIC_HTTP_HOP_TIMEOUT_MS)}ms`);
			response?.destroy(error);
			request$2.destroy(error);
		}, PUBLIC_HTTP_HOP_TIMEOUT_MS);
		timer.unref();
		signal.addEventListener("abort", onAbort, { once: true });
		request$2.once("error", (error) => {
			finish({
				ok: false,
				error
			});
		});
		request$2.end();
	});
}
/** Production resolver and one-shot agent which pins the validated address. */
const NODE_PUBLIC_HTTP_RUNTIME = {
	resolve: resolveHost,
	get: requestPinned
};
/** Fetch bytes from a public HTTP(S) target, revalidating and repinning each redirect. */
async function fetchPublicHttpResource(source, maxBytes, signal, runtime = NODE_PUBLIC_HTTP_RUNTIME) {
	let url = new URL(source);
	assertTargetUrl(url);
	for (let redirects = 0;; redirects += 1) {
		if (signal.aborted) throw abortError(signal);
		const addresses = await runtime.resolve(url.hostname, signal);
		if (addresses.length === 0 || addresses.some((candidate) => !isPublicNetworkAddress(candidate.address))) throw new Error(`remote image host ${JSON.stringify(url.hostname)} must resolve only to public network addresses`);
		const hop = await runtime.get(url, addresses[0], maxBytes, signal);
		if (hop.status >= 300 && hop.status < 400) {
			if (redirects >= 5) throw new Error(`remote image exceeded ${String(5)} redirects`);
			if (hop.location === void 0) throw new Error(`remote image redirect ${String(hop.status)} has no location`);
			url = new URL(hop.location, url);
			assertTargetUrl(url);
			continue;
		}
		if (hop.status < 200 || hop.status >= 300) throw new Error(`remote image request failed with HTTP ${String(hop.status)}`);
		if (hop.data === void 0) throw new Error("remote image response did not contain a body");
		const name = basename(url.pathname) || void 0;
		return {
			data: hop.data,
			display: url.href,
			...name === void 0 ? {} : { name }
		};
	}
}
//#endregion
//#region src/read-image-enhancement.ts
/** Harness's canonical image-reading tool name. */
const READ_IMAGE_TOOL_NAME = "read_image";
function refOf(image) {
	return {
		attachmentId: AttachmentId(image.attachmentId),
		mediaType: image.mediaType,
		bytes: image.bytes,
		width: image.width,
		height: image.height,
		...image.name === void 0 ? {} : { name: image.name }
	};
}
function contentOf$1(value) {
	return [{
		type: "text",
		text: `<path>${value.path}</path>\n<type>image</type>\n<content>${value.image.mediaType}, ${value.image.width}x${value.image.height} px, ${value.image.bytes} bytes</content>`
	}, {
		type: "image",
		attachment: refOf(value.image)
	}];
}
/** Detect one supported encoded raster format from its magic bytes. */
function imageMediaType(data) {
	if (data.length >= 8 && data[0] === 137 && data[1] === 80 && data[2] === 78 && data[3] === 71 && data[4] === 13 && data[5] === 10 && data[6] === 26 && data[7] === 10) return "image/png";
	if (data.length >= 3 && data[0] === 255 && data[1] === 216 && data[2] === 255) return "image/jpeg";
	if (data.length >= 6) {
		const signature = String.fromCharCode(...data.subarray(0, 6));
		if (signature === "GIF87a" || signature === "GIF89a") return "image/gif";
	}
	if (data.length >= 12 && String.fromCharCode(...data.subarray(0, 4)) === "RIFF" && String.fromCharCode(...data.subarray(8, 12)) === "WEBP") return "image/webp";
}
/** Build an agent-scoped `read_image` definition that delegates local paths to Harness. */
function enhancedReadImageTool(ctx, original, publicHttpRuntime) {
	return defineTool({
		name: READ_IMAGE_TOOL_NAME,
		description: "Read a PNG/JPEG/WebP/GIF image from a workspace file path or an HTTP(S) URL and return the image itself. Requires the current model to accept image input.",
		parameters: {
			file_path: {
				type: "string",
				description: "Local image path resolved by the active filesystem backend. Provide exactly one of file_path or url."
			},
			url: {
				type: "string",
				description: "HTTP(S) image URL. Provide exactly one of file_path or url."
			}
		},
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					path: {
						type: "string",
						required: true
					},
					image: {
						type: "object",
						required: true,
						additionalProperties: false,
						properties: {
							attachmentId: {
								type: "string",
								required: true
							},
							mediaType: {
								type: "string",
								required: true,
								enum: [
									"image/png",
									"image/jpeg",
									"image/webp",
									"image/gif"
								]
							},
							bytes: {
								type: "integer",
								required: true
							},
							width: {
								type: "integer",
								required: true
							},
							height: {
								type: "integer",
								required: true
							},
							name: { type: "string" }
						}
					}
				}
			},
			render: (_args, value) => contentOf$1(value)
		},
		isConcurrencySafe: (args) => args.url !== void 0 || original.isConcurrencySafe?.({ file_path: args.file_path }) === true,
		async execute(args, exec) {
			const filePath = args.file_path?.trim();
			const sourceUrl = args.url?.trim();
			if ((filePath === void 0 || filePath.length === 0) === (sourceUrl === void 0 || sourceUrl.length === 0)) throw new Error("read_image requires exactly one non-empty file_path or url");
			if (filePath !== void 0 && filePath.length > 0) return await original.execute({ file_path: filePath }, exec);
			const url = sourceUrl;
			await assertImageCapable(ctx, exec, `read ${JSON.stringify(url)}`);
			const attachments = ctx.attachments;
			const loaded = await fetchPublicHttpResource(url, Math.min(attachments.imageLimits.maxImageBytes, attachments.imageLimits.maxMessageImageBytes), exec.signal, publicHttpRuntime);
			const mediaType = imageMediaType(loaded.data);
			if (mediaType === void 0) throw new Error("read_image supports PNG, JPEG, WebP, and GIF image bytes");
			if (!attachments.imageLimits.mediaTypes.includes(mediaType)) throw new Error(`${mediaType} images are disabled by this deployment`);
			const ref = await attachments.saveImage({
				data: loaded.data,
				mediaType,
				...loaded.name === void 0 ? {} : { name: loaded.name }
			});
			const value = {
				path: loaded.display,
				image: {
					attachmentId: ref.attachmentId,
					mediaType: ref.mediaType,
					bytes: ref.bytes,
					width: ref.width,
					height: ref.height,
					...ref.name === void 0 ? {} : { name: ref.name }
				}
			};
			if (exec.parent !== void 0) exec.deferContext(createUserMessage({
				content: contentOf$1(value),
				source: {
					kind: "plugin",
					plugin: "dsh-openai-codex"
				}
			}));
			return value;
		},
		presentCall: (args) => {
			if (args.file_path !== void 0) return original.presentCall?.({ file_path: args.file_path });
			return {
				card: "generic",
				title: `Read image ${args.url ?? ""}`,
				kind: "read"
			};
		}
	});
}
/** Keep an enhanced `read_image` shadow on every live agent while the setting is enabled. */
function installReadImageEnhancement(ctx, policy, publicHttpRuntime) {
	const installed = /* @__PURE__ */ new Map();
	let syncing = false;
	const remove = (agent) => {
		const current = installed.get(agent);
		if (current === void 0) return;
		installed.delete(agent);
		current.dispose();
	};
	const syncAgent = (agent) => {
		const current = installed.get(agent);
		const original = ctx.tools.get(READ_IMAGE_TOOL_NAME);
		if (!policy.snapshot().modifyReadImage || original === void 0) {
			remove(agent);
			return;
		}
		if (current?.original === original) return;
		if (current !== void 0) remove(agent);
		if (ctx.tools.get("read_image", agent) !== original) return;
		const dispose = agent.ctx.tools.register(enhancedReadImageTool(ctx, original, publicHttpRuntime));
		installed.set(agent, {
			original,
			dispose
		});
	};
	const syncAll = () => {
		if (syncing) return;
		syncing = true;
		try {
			for (const agent of ctx.agents.list()) syncAgent(agent);
			for (const agent of [...installed.keys()]) if (ctx.agents.get(agent.id) !== agent) remove(agent);
		} finally {
			syncing = false;
		}
	};
	ctx.on("agent/created", ({ agent }) => {
		syncAgent(agent);
	});
	ctx.on("agent/disposed", ({ agent }) => {
		installed.delete(agent);
	});
	ctx.on("tools/change", syncAll);
	const stopPolicy = policy.watchImagePreferences(syncAll);
	syncAll();
	ctx.effect(() => () => {
		stopPolicy();
		for (const agent of [...installed.keys()]) remove(agent);
	}, "dsh-openai-codex: enhanced read_image");
}
//#endregion
//#region src/search.ts
/**
* OpenAI Codex standalone web search over the dsh web provider seam.
* @module dsh-codex/search
*/
/** Stable dsh web-provider id selected by the bundle patch. */
const OPENAI_CODEX_SEARCH_PROVIDER = OPENAI_CODEX_PROVIDER;
/** Trusted first-party Codex base; OAuth credentials never cross to a configured origin. */
const OPENAI_CODEX_BASE_URL = "https://chatgpt.com/backend-api/codex";
/** Standalone search endpoint used by the official Codex client. */
const OPENAI_CODEX_SEARCH_URL = `${OPENAI_CODEX_BASE_URL}/alpha/search`;
/** Default model used by the standalone search endpoint. */
const DEFAULT_OPENAI_CODEX_SEARCH_MODEL = "gpt-5.6-sol";
/** Default search mode, matching the official local Codex client. */
const DEFAULT_OPENAI_CODEX_SEARCH_MODE = "cached";
/** Default provider search-context size. */
const DEFAULT_OPENAI_CODEX_SEARCH_CONTEXT_SIZE = "medium";
/** Default output budget for the standalone search response. */
const DEFAULT_OPENAI_CODEX_SEARCH_MAX_OUTPUT_TOKENS = 1e4;
/** Convert the configured mode to the official endpoint field. */
function externalWebAccess(mode) {
	switch (mode) {
		case "cached": return false;
		case "indexed": return "indexed";
		case "live": return true;
	}
}
/** Extract the account id paired with one OAuth access token. */
function accountIdFromToken$1(access) {
	try {
		const parts = access.split(".");
		if (parts.length !== 3 || parts[1] === void 0) throw new Error("invalid JWT");
		const auth = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"))["https://api.openai.com/auth"];
		if (typeof auth !== "object" || auth === null || Array.isArray(auth)) throw new Error("missing auth claim");
		const accountId = auth["chatgpt_account_id"];
		if (typeof accountId !== "string" || accountId.length === 0) throw new Error("missing account id");
		return accountId;
	} catch (error) {
		throw new WebError("OpenAI Codex search credential has no usable account id; run \"dsh openai-codex login\" again", "WEB_PROVIDER_CREDENTIAL_MISSING", { cause: error });
	}
}
/** Whether an opaque value is a non-array record. */
function isRecord$1(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
/** Read an optional non-empty string field. */
function optionalString(record, key) {
	const value = record[key];
	return typeof value === "string" && value.length > 0 ? value : void 0;
}
/** Accept only citeable HTTP(S) URLs from opaque result DTOs. */
function citeableUrl(value) {
	if (typeof value !== "string") return void 0;
	try {
		const url = new URL(value);
		return url.protocol === "http:" || url.protocol === "https:" ? value : void 0;
	} catch {
		return;
	}
}
/**
* Map the standalone endpoint's forward-compatible result DTOs into the dsh
* web result. Unknown DTO types and fields are ignored; malformed envelope
* fields fail at the network boundary.
* @param value - parsed response JSON.
* @returns normalized answer and citeable sources.
*/
function mapOpenAICodexSearchResponse(value) {
	if (!isRecord$1(value) || typeof value["output"] !== "string") throw new WebError("OpenAI Codex returned a search response without string output", "WEB_PROVIDER_ERROR");
	const output = value["output"];
	const rawResults = value["results"];
	if (rawResults !== void 0 && !Array.isArray(rawResults)) throw new WebError("OpenAI Codex returned a search response with non-array results", "WEB_PROVIDER_ERROR");
	const sources = [];
	const seen = /* @__PURE__ */ new Set();
	for (const item of rawResults ?? []) {
		if (!isRecord$1(item) || item["type"] !== "text_result") continue;
		const url = citeableUrl(item["url"]);
		if (url === void 0 || seen.has(url)) continue;
		seen.add(url);
		const title = optionalString(item, "title");
		const snippet = optionalString(item, "snippet");
		sources.push({
			url,
			...title === void 0 ? {} : { title },
			...snippet === void 0 ? {} : { snippet }
		});
	}
	return {
		...output.length === 0 ? {} : { content: output },
		sources,
		truncated: false
	};
}
/** Stable cancellation error for every provider phase. */
function searchAborted(signal, fallback) {
	return new WebError("OpenAI Codex search aborted", "WEB_ABORTED", { cause: signal?.aborted === true ? signal.reason : fallback });
}
/** Throw the provider's stable cancellation error when the caller already aborted. */
function throwIfSearchAborted(signal) {
	if (signal?.aborted === true) throw searchAborted(signal);
}
/** True for native fetch cancellation. */
function isAbortError(error) {
	return error instanceof DOMException && error.name === "AbortError";
}
/** Race an asynchronous auth refresh against caller cancellation. */
function abortable$1(operation, signal) {
	if (signal === void 0) return operation;
	if (signal.aborted) return Promise.reject(searchAborted(signal));
	return new Promise((resolve, reject) => {
		const onAbort = () => {
			reject(searchAborted(signal));
		};
		signal.addEventListener("abort", onAbort, { once: true });
		operation.then((value) => {
			signal.removeEventListener("abort", onAbort);
			resolve(value);
		}, (error) => {
			signal.removeEventListener("abort", onAbort);
			reject(error);
		});
	});
}
/** Keep provider diagnostics bounded and remove JWT-like material. */
function providerMessage$1(value) {
	if (!isRecord$1(value)) return void 0;
	const error = value["error"];
	return (typeof error === "string" ? error : isRecord$1(error) && typeof error["message"] === "string" ? error["message"] : typeof value["message"] === "string" ? value["message"] : void 0)?.replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/gu, "[REDACTED]").slice(0, 1e3);
}
/** OpenAI Codex standalone-search provider using the same refreshable OAuth store as the LLM route. */
var OpenAICodexSearchProvider = class {
	options;
	id = OPENAI_CODEX_SEARCH_PROVIDER;
	models;
	/**
	* @param options - fixed trusted endpoint policy and deployment tunables.
	*/
	constructor(options) {
		this.options = options;
		const models = createModels({ credentials: options.credentials });
		models.setProvider(openaiCodexProvider());
		this.models = models;
	}
	/** The local configuration is usable; credential presence is resolved per request. */
	available() {
		return this.options.model.length > 0 && Number.isInteger(this.options.maxOutputTokens) && this.options.maxOutputTokens > 0;
	}
	/** @inheritdoc */
	async search(request, signal) {
		throwIfSearchAborted(signal);
		let auth;
		try {
			auth = await abortable$1(this.models.getAuth(OPENAI_CODEX_PROVIDER), signal);
		} catch (error) {
			throwIfSearchAborted(signal);
			if (isAbortError(error)) throw searchAborted(signal, error);
			throw new WebError("OpenAI Codex search credential resolution failed", "WEB_PROVIDER_ERROR", { cause: error });
		}
		const access = auth?.auth.apiKey;
		if (access === void 0 || access.length === 0) throw new WebError("OpenAI Codex search is signed out; run \"dsh openai-codex login\"", "WEB_PROVIDER_CREDENTIAL_MISSING");
		const accountId = accountIdFromToken$1(access);
		throwIfSearchAborted(signal);
		const body = {
			id: this.options.resolveRequestId(),
			model: this.options.model,
			input: [{
				type: "message",
				role: "user",
				content: [{
					type: "input_text",
					text: request.query
				}]
			}],
			commands: { search_query: [{ q: request.query }] },
			settings: {
				search_context_size: this.options.contextSize,
				allowed_callers: ["direct"],
				external_web_access: externalWebAccess(this.options.mode)
			},
			max_output_tokens: this.options.maxOutputTokens
		};
		this.options.recordRequest?.({
			endpoint: OPENAI_CODEX_SEARCH_URL,
			body
		});
		throwIfSearchAborted(signal);
		let response;
		try {
			response = await fetch(OPENAI_CODEX_SEARCH_URL, {
				method: "POST",
				redirect: "error",
				headers: {
					authorization: `Bearer ${access}`,
					"chatgpt-account-id": accountId,
					"content-type": "application/json",
					accept: "application/json",
					originator: "deepseek-harness"
				},
				body: JSON.stringify(body),
				...signal === void 0 ? {} : { signal }
			});
		} catch (error) {
			throwIfSearchAborted(signal);
			if (isAbortError(error)) throw searchAborted(signal, error);
			throw new WebError("OpenAI Codex search request failed", "WEB_PROVIDER_ERROR", { cause: error });
		}
		let payload;
		try {
			payload = await response.json();
		} catch (error) {
			throwIfSearchAborted(signal);
			if (isAbortError(error)) throw searchAborted(signal, error);
			throw new WebError(`OpenAI Codex returned an unprocessable search response (HTTP ${response.status})`, "WEB_PROVIDER_ERROR", { cause: error });
		}
		if (!response.ok) {
			const detail = providerMessage$1(payload);
			const message = detail === void 0 ? `OpenAI Codex search failed (HTTP ${response.status})` : `OpenAI Codex search failed (HTTP ${response.status}): ${detail}`;
			throw new WebError(response.status === 401 || response.status === 403 ? `${message}; run "dsh openai-codex login" again` : message, response.status === 401 || response.status === 403 ? "WEB_PROVIDER_CREDENTIAL_MISSING" : "WEB_PROVIDER_ERROR");
		}
		return mapOpenAICodexSearchResponse(payload);
	}
};
//#endregion
//#region src/binary-fs.ts
const localLocks = /* @__PURE__ */ new Map();
function throwIfAborted$1(signal) {
	if (signal?.aborted === true) throw signal.reason;
}
async function withLocalLock(path, operation) {
	const prior = localLocks.get(path) ?? Promise.resolve();
	let release;
	const current = new Promise((resolve) => {
		release = resolve;
	});
	const tail = prior.then(() => current);
	localLocks.set(path, tail);
	await prior;
	try {
		return await operation();
	} finally {
		release();
		if (localLocks.get(path) === tail) localLocks.delete(path);
	}
}
async function checkedLocalTarget(ctx, target, policy, signal) {
	if (ctx.fs.sandboxMode === void 0) return target;
	if (policy === void 0) throw new Error("the active filesystem confines writes but its sandbox policy is unavailable");
	if (policy.mode === "read-only") throw new FsError(`cannot write "${target.displayPath}": file access denied under read-only mode`, "FS_SANDBOX_DENIED");
	if (policy.mode === "danger-full-access") return target;
	const options = signal === void 0 ? void 0 : { signal };
	const fresh = await ctx.fs.resolve(target.displayPath, options);
	const root = await ctx.fs.resolve(policy.workspaceRoot, options);
	if (!ctx.fs.contains(root, fresh)) throw new FsError(`cannot write "${target.displayPath}": file access denied under workspace-write mode`, "FS_SANDBOX_DENIED");
	return fresh;
}
function resolveSandboxPolicy(ctx, exec) {
	return ctx.get("sandboxPolicy")?.resolve(exec.agent === void 0 ? {} : { session: exec.agent.session });
}
function isCode(error, code) {
	return error instanceof Error && "code" in error && error.code === code;
}
async function publishLocal(path, displayPath, content, createIfAbsent, mode, signal) {
	throwIfAborted$1(signal);
	const parent = dirname(path);
	await mkdir(parent, { recursive: true });
	const temporary = join(parent, `.${basename(path)}.${process.pid}.${randomUUID()}.tmp`);
	let handle;
	try {
		handle = await open(temporary, "wx", mode ?? 384);
		await handle.writeFile(content, signal === void 0 ? {} : { signal });
		await handle.sync();
		if (mode !== void 0 && process.platform !== "win32") await handle.chmod(mode);
		await handle.close();
		handle = void 0;
		throwIfAborted$1(signal);
		if (createIfAbsent) try {
			await link(temporary, path);
		} catch (error) {
			if (isCode(error, "EEXIST")) throw new FsError(`cannot overwrite existing "${displayPath}" without reading it first`, "FS_NOT_OBSERVED", { cause: error });
			throw error;
		}
		else await rename(temporary, path);
	} finally {
		await handle?.close().catch(() => void 0);
		await rm(temporary, { force: true }).catch(() => void 0);
	}
}
async function writeLocalBytes(ctx, exec, original, content, expected, policy) {
	const target = await checkedLocalTarget(ctx, original, policy, exec.signal);
	const urlPath = fileURLToPath(ctx.fs.fileUrl(target));
	const processPath = ctx.fs.processPath(target);
	if (urlPath !== processPath) throw new Error("local filesystem path and file URL disagree");
	return withLocalLock(processPath, async () => {
		throwIfAborted$1(exec.signal);
		const info = await ctx.fs.stat(target, exec.signal);
		if (info !== void 0 && info.type !== "file") throw new FsError(`cannot write "${target.displayPath}": not a regular file`, "FS_NOT_REGULAR_FILE");
		if (expected?.kind === "replaceIfVersion" && (info === void 0 || info.version !== expected.version)) throw new FsError(`cannot write "${target.displayPath}": file changed since it was read`, "FS_STALE_VERSION");
		if (expected?.kind === "createIfAbsent" && info !== void 0) throw new FsError(`cannot overwrite existing "${target.displayPath}" without reading it first`, "FS_NOT_OBSERVED");
		const native = info === void 0 ? void 0 : await lstat(processPath);
		await publishLocal(processPath, target.displayPath, content, expected?.kind === "createIfAbsent", native?.mode, exec.signal);
		const written = await ctx.fs.stat(target, exec.signal);
		if (written === void 0) throw new FsError(`cannot stat written "${target.displayPath}"`, "FS_IO_ERROR");
		return {
			operation: info === void 0 ? "create" : "update",
			version: written.version,
			bytes: content.byteLength
		};
	});
}
/** Publish bytes in the active world, with a self-contained local fallback for released DSH versions. */
async function writeWorkspaceBytes(ctx, exec, target, content, expected) {
	const policy = resolveSandboxPolicy(ctx, exec);
	const protocol = new URL(ctx.fs.fileUrl(target)).protocol;
	if (protocol === "file:") return writeLocalBytes(ctx, exec, target, content, expected, policy);
	const writer = ctx.fs;
	if (typeof writer.writeBytes !== "function") throw new Error(`the active ${protocol} filesystem cannot save binary output; update its provider or omit output_path`);
	return writer.writeBytes(target, content, expected, exec.signal, policy);
}
//#endregion
//#region src/imagegen.ts
/** ChatGPT Codex image generation and reference-image editing. */
/** Stable Codex-compatible tool name. */
const IMAGEGEN_TOOL_NAME = "imagegen";
/** Image model selected by the official Codex image extension. */
const OPENAI_CODEX_IMAGE_MODEL = "gpt-image-2";
/** Standalone generation endpoint used by the official Codex client. */
const OPENAI_CODEX_IMAGE_GENERATIONS_URL = `${OPENAI_CODEX_BASE_URL}/images/generations`;
/** Reference-image edit endpoint used by the official Codex client. */
const OPENAI_CODEX_IMAGE_EDITS_URL = `${OPENAI_CODEX_BASE_URL}/images/edits`;
const MAX_REFERENCE_IMAGES = 5;
function defaultOutputPath(now = /* @__PURE__ */ new Date(), id = randomUUID()) {
	return `generated-${now.toISOString().replace(/\.\d{3}Z$/u, "Z").replaceAll(":", "-")}-${id.slice(0, 8)}.png`;
}
function isRecord(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
function accountIdFromToken(access) {
	try {
		const parts = access.split(".");
		if (parts.length !== 3 || parts[1] === void 0) throw new Error("invalid JWT");
		const auth = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"))["https://api.openai.com/auth"];
		if (!isRecord(auth)) throw new Error("missing auth claim");
		const accountId = auth["chatgpt_account_id"];
		if (typeof accountId !== "string" || accountId.length === 0) throw new Error("missing account id");
		return accountId;
	} catch (error) {
		throw new Error("OpenAI Codex image credential has no usable account id; run \"dsh openai-codex login\" again", { cause: error });
	}
}
function providerMessage(value) {
	if (!isRecord(value)) return void 0;
	const error = value["error"];
	return (typeof error === "string" ? error : isRecord(error) && typeof error["message"] === "string" ? error["message"] : typeof value["message"] === "string" ? value["message"] : void 0)?.replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/gu, "[REDACTED]").slice(0, 1e3);
}
function throwIfAborted(signal) {
	if (signal.aborted) throw signal.reason;
}
function abortable(operation, signal) {
	if (signal.aborted) return Promise.reject(signal.reason);
	return new Promise((resolve, reject) => {
		const onAbort = () => {
			reject(signal.reason);
		};
		signal.addEventListener("abort", onAbort, { once: true });
		operation.then((value) => {
			signal.removeEventListener("abort", onAbort);
			resolve(value);
		}, (error) => {
			signal.removeEventListener("abort", onAbort);
			reject(error);
		});
	});
}
/** OAuth-backed client for the two fixed ChatGPT Codex image endpoints. */
var OpenAICodexImageClient = class {
	models;
	/** @param credentials - shared refreshable OAuth store. */
	constructor(credentials) {
		const models = createModels({ credentials });
		models.setProvider(openaiCodexProvider());
		this.models = models;
	}
	/** Send one generation or edit request and return the first PNG payload. */
	async generate(prompt, images, signal) {
		throwIfAborted(signal);
		const access = (await abortable(this.models.getAuth(OPENAI_CODEX_PROVIDER), signal))?.auth.apiKey;
		if (access === void 0 || access.length === 0) throw new Error("OpenAI Codex image generation is signed out; run \"dsh openai-codex login\"");
		const endpoint = images.length === 0 ? OPENAI_CODEX_IMAGE_GENERATIONS_URL : OPENAI_CODEX_IMAGE_EDITS_URL;
		const body = {
			...images.length === 0 ? {} : { images: images.map((image_url) => ({ image_url })) },
			prompt,
			background: "auto",
			model: OPENAI_CODEX_IMAGE_MODEL,
			quality: "auto",
			size: "auto"
		};
		let response;
		try {
			response = await fetch(endpoint, {
				method: "POST",
				redirect: "error",
				headers: {
					authorization: `Bearer ${access}`,
					"chatgpt-account-id": accountIdFromToken(access),
					"content-type": "application/json",
					accept: "application/json",
					originator: "deepseek-harness"
				},
				body: JSON.stringify(body),
				signal
			});
		} catch (error) {
			throwIfAborted(signal);
			throw new Error("OpenAI Codex image request failed", { cause: error });
		}
		let payload;
		try {
			payload = await response.json();
		} catch (error) {
			throw new Error(`OpenAI Codex returned an unprocessable image response (HTTP ${response.status})`, { cause: error });
		}
		if (!response.ok) {
			const detail = providerMessage(payload);
			const message = detail === void 0 ? `OpenAI Codex image request failed (HTTP ${response.status})` : `OpenAI Codex image request failed (HTTP ${response.status}): ${detail}`;
			throw new Error(response.status === 401 || response.status === 403 ? `${message}; run "dsh openai-codex login" again` : message);
		}
		if (!isRecord(payload) || !Array.isArray(payload["data"])) throw new Error("OpenAI Codex returned an image response without data");
		const first = payload["data"][0];
		if (!isRecord(first) || typeof first["b64_json"] !== "string" || first["b64_json"].length === 0) throw new Error("OpenAI Codex returned an image response without base64 image data");
		const encoded = first["b64_json"].trim();
		if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(encoded)) throw new Error("OpenAI Codex returned malformed base64 image data");
		return Buffer.from(encoded, "base64");
	}
};
function attachmentRef(value) {
	return {
		attachmentId: AttachmentId(value.attachmentId),
		mediaType: value.mediaType,
		bytes: value.bytes,
		width: value.width,
		height: value.height,
		...value.name === void 0 ? {} : { name: value.name }
	};
}
function contentOf(value) {
	const file = value.file === void 0 ? value.writeError === void 0 ? "" : `\n<output_error>${value.writeError}</output_error>` : `\n<output_path operation="${value.file.operation}">${value.file.path}</output_path>`;
	return [{
		type: "text",
		text: `<image>${value.image.mediaType}, ${value.image.width}x${value.image.height} px, ${value.image.bytes} bytes</image>${file}`
	}, {
		type: "image",
		attachment: attachmentRef(value.image)
	}];
}
function collectImageRefs(content, output) {
	for (const block of content) if (block.type === "image") output.push(block.attachment);
	else if (block.type === "tool-result") collectImageRefs(block.content, output);
}
function recentImageRefs(messages, count) {
	const refs = [];
	for (const message of messages) collectImageRefs(message.content, refs);
	return refs.slice(-count);
}
async function conversationImages(ctx, exec, count) {
	const session = exec.agent?.session;
	if (session === void 0) throw new Error("conversation image references are unavailable outside an agent session");
	const refs = recentImageRefs(session.deriveMessages(), count);
	if (refs.length !== count) throw new Error(`requested the last ${count} conversation images, but only ${refs.length} were available`);
	return Promise.all(refs.map(async (ref) => {
		const stored = await ctx.attachments.readImage(ref, exec.signal);
		return `data:${stored.ref.mediaType};base64,${Buffer.from(stored.data).toString("base64")}`;
	}));
}
async function workspaceImages(ctx, exec, paths) {
	const cwd = exec.agent?.session.header.cwd;
	const maxBytes = Math.min(ctx.attachments.imageLimits.maxImageBytes, ctx.attachments.imageLimits.maxMessageImageBytes);
	const images = [];
	for (const path of paths) {
		if (path.trim().length === 0) throw new Error("referenced_image_paths must not contain an empty path");
		const target = await ctx.fs.resolve(path, {
			...cwd === void 0 ? {} : { cwd },
			signal: exec.signal
		});
		const info = await ctx.fs.stat(target, exec.signal);
		if (info === void 0) throw new Error(`referenced image does not exist: ${path}`);
		if (info.type !== "file") throw new Error(`referenced image is not a regular file: ${path}`);
		const data = await ctx.fs.readBytes(target, exec.signal, maxBytes);
		const mediaType = imageMediaType(data);
		if (mediaType === void 0) throw new Error(`referenced image is not PNG, JPEG, WebP, or GIF: ${path}`);
		await ctx.attachments.validateImage({
			data,
			mediaType,
			name: basename(target.displayPath)
		});
		ctx.emit("fs/observed", target, {
			kind: "present",
			version: info.version
		}, exec);
		images.push(`data:${mediaType};base64,${Buffer.from(data).toString("base64")}`);
	}
	return images;
}
function parseArgs(args) {
	const prompt = args.prompt.trim();
	if (prompt.length === 0) throw new Error("imagegen prompt must not be empty");
	const paths = args.referenced_image_paths ?? [];
	if (paths.length > MAX_REFERENCE_IMAGES) throw new Error(`referenced_image_paths must contain at most ${MAX_REFERENCE_IMAGES} paths`);
	const count = args.num_last_images_to_include;
	if (count !== void 0 && (!Number.isInteger(count) || count < 1 || count > MAX_REFERENCE_IMAGES)) throw new Error(`num_last_images_to_include must be an integer between 1 and ${MAX_REFERENCE_IMAGES}`);
	if (paths.length > 0 && count !== void 0) throw new Error("provide only one of referenced_image_paths or num_last_images_to_include");
	if (args.output_path !== void 0 && args.output_path.trim().length === 0) throw new Error("output_path must not be empty");
	return {
		prompt,
		...paths.length === 0 ? {} : { referenced_image_paths: paths },
		...count === void 0 ? {} : { num_last_images_to_include: count },
		...args.output_path === void 0 ? {} : { output_path: args.output_path }
	};
}
/** Build the plugin-owned Codex image generation and editing tool. */
function imagegenTool(ctx, credentials, policy) {
	const client = new OpenAICodexImageClient(credentials);
	return defineTool({
		name: IMAGEGEN_TOOL_NAME,
		description: "Generate or edit an image with gpt-image-2. Omit both reference fields for a new image. Use referenced_image_paths for workspace files, or num_last_images_to_include for attached, viewed, or previously generated conversation images. Never provide both. Multiple images keep chronological/path-array order; identify them as Image 1, Image 2, and so on in the prompt. The generated PNG is always saved in the active local or Remote SSH workspace; output_path chooses its location, otherwise a unique generated-<timestamp>-<id>.png name is used.",
		parameters: {
			prompt: {
				type: "string",
				required: true,
				description: "Complete generation or edit instruction. For multiple references, name each input by its Image N order."
			},
			referenced_image_paths: {
				type: "array",
				items: { type: "string" },
				description: "Up to five local or active-workspace image paths, in Image 1..N order."
			},
			num_last_images_to_include: {
				type: "integer",
				description: "Use the most recent 1–5 conversation images, preserving chronological order."
			},
			output_path: {
				type: "string",
				description: "Optional active-workspace path for the generated PNG. Omit it to save under a unique generated-<timestamp>-<id>.png name. Existing files remain subject to filesystem write-intent policy."
			}
		},
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					prompt: {
						type: "string",
						required: true
					},
					image: {
						type: "object",
						required: true,
						additionalProperties: false,
						properties: {
							attachmentId: {
								type: "string",
								required: true
							},
							mediaType: {
								type: "string",
								required: true,
								enum: ["image/png"]
							},
							bytes: {
								type: "integer",
								required: true
							},
							width: {
								type: "integer",
								required: true
							},
							height: {
								type: "integer",
								required: true
							},
							name: { type: "string" }
						}
					},
					file: {
						type: "object",
						additionalProperties: false,
						properties: {
							path: {
								type: "string",
								required: true
							},
							operation: {
								type: "string",
								required: true,
								enum: ["create", "update"]
							}
						}
					},
					writeError: { type: "string" }
				}
			},
			render: (_args, value) => contentOf(value)
		},
		isConcurrencySafe: (args) => args.output_path === void 0,
		async execute(rawArgs, exec) {
			const args = parseArgs(rawArgs);
			policy.assertAllowed(exec, "imagegen");
			await assertImageCapable(ctx, exec, "generate an image");
			const images = args.referenced_image_paths !== void 0 ? await workspaceImages(ctx, exec, args.referenced_image_paths) : args.num_last_images_to_include !== void 0 ? await conversationImages(ctx, exec, args.num_last_images_to_include) : [];
			const data = await client.generate(args.prompt, images, exec.signal);
			const mediaType = imageMediaType(data);
			if (mediaType !== "image/png") throw new Error("OpenAI Codex image response was not a PNG");
			const ref = await ctx.attachments.saveImage({
				data,
				mediaType,
				name: "generated.png"
			});
			const value = {
				prompt: args.prompt,
				image: {
					attachmentId: ref.attachmentId,
					mediaType,
					bytes: ref.bytes,
					width: ref.width,
					height: ref.height,
					...ref.name === void 0 ? {} : { name: ref.name }
				}
			};
			const outputPath = args.output_path ?? defaultOutputPath();
			try {
				const cwd = exec.agent?.session.header.cwd;
				const target = await ctx.fs.resolve(outputPath, {
					...cwd === void 0 ? {} : { cwd },
					signal: exec.signal
				});
				const outcome = await writeWorkspaceBytes(ctx, exec, target, data, await ctx.waterfall("fs/write-intent", target, exec, () => void 0));
				ctx.emit("fs/observed", target, {
					kind: "present",
					version: outcome.version
				}, exec);
				value.file = {
					path: target.displayPath,
					operation: outcome.operation
				};
			} catch (error) {
				throwIfAborted(exec.signal);
				const detail = (error instanceof Error ? error.message : String(error)).slice(0, 1e3);
				value.writeError = `generated image was not written to ${JSON.stringify(outputPath)}: ${detail}`;
			}
			if (exec.parent !== void 0) exec.deferContext(createUserMessage({
				content: contentOf(value),
				source: {
					kind: "plugin",
					plugin: "dsh-openai-codex"
				}
			}));
			return value;
		},
		presentCall: (args) => ({
			card: "generic",
			title: args.output_path === void 0 ? "Generate image" : `Generate image ${args.output_path}`,
			kind: args.output_path === void 0 ? "execute" : "edit",
			...args.output_path === void 0 ? {} : { locations: [{ path: args.output_path }] }
		}),
		presentResult: (args, result) => ({
			card: "generic",
			title: args.output_path === void 0 ? "Generated image" : `Generated image ${args.output_path}`,
			content: result.content
		})
	});
}
const SUPPORTED_NODE_RANGE = "^22.19.0 || >=24.0.0";
const SUPPORTED_DSH_PLUGIN_API_VERSION = "0.1.2-alpha.1";
const SUPPORTED_PI_AI_VERSION = "0.84.3";
const PI_AI_PACKAGE = "@earendil-works/pi-ai";
const COMPATIBILITY_PACKAGES = [
	"@deepseek-ai/dsh-llm",
	"@deepseek-ai/dsh-llm-pi-ai",
	PI_AI_PACKAGE
];
const PACKAGE_JSON_SEARCH_DEPTH = 8;
function compareVersion(left, right) {
	return left === right ? "compatible" : "incompatible";
}
function parseNodeVersion(value) {
	const match = /^v?(\d+)\.(\d+)\.(\d+)(?:[-+][0-9A-Za-z.-]+)?$/u.exec(value.trim());
	if (match === null) return void 0;
	const major = Number(match[1]);
	const minor = Number(match[2]);
	const patch = Number(match[3]);
	if (![
		major,
		minor,
		patch
	].every(Number.isSafeInteger)) return void 0;
	return [
		major,
		minor,
		patch
	];
}
function nodeStatus(value) {
	if (value === void 0 || value === null || value.trim() === "") return "unknown";
	const parsed = parseNodeVersion(value);
	if (parsed === void 0) return "unknown";
	const [major, minor, patch] = parsed;
	if (major === 22) return minor > 19 || minor === 19 && patch >= 0 ? "compatible" : "incompatible";
	return major >= 24 ? "compatible" : "incompatible";
}
function packageEntry(supported, installed) {
	return {
		supported,
		installed: installed ?? null,
		status: installed === void 0 || installed === null || installed === "" ? "unknown" : compareVersion(installed, supported)
	};
}
function nodeEntry(installed) {
	return {
		supported: SUPPORTED_NODE_RANGE,
		installed: installed ?? null,
		status: nodeStatus(installed)
	};
}
function aggregateStatus(entries) {
	if (entries.some((entry) => entry.status === "incompatible")) return "incompatible";
	if (entries.some((entry) => entry.status === "unknown")) return "unknown";
	return "compatible";
}
/** Evaluate a captured set of versions without touching the filesystem. */
function evaluateCompatibility(input = {}) {
	const installedNode = input.nodeVersion ?? input.node ?? input.installed?.node;
	const suppliedPackages = input.packageVersions ?? input.packages ?? input.installed?.packages ?? {};
	const packages = {
		"@deepseek-ai/dsh-llm": packageEntry(SUPPORTED_DSH_PLUGIN_API_VERSION, suppliedPackages["@deepseek-ai/dsh-llm"]),
		"@deepseek-ai/dsh-llm-pi-ai": packageEntry(SUPPORTED_DSH_PLUGIN_API_VERSION, suppliedPackages["@deepseek-ai/dsh-llm-pi-ai"]),
		[PI_AI_PACKAGE]: packageEntry(SUPPORTED_PI_AI_VERSION, suppliedPackages[PI_AI_PACKAGE])
	};
	const node = nodeEntry(installedNode);
	return {
		schemaVersion: 1,
		status: aggregateStatus([node, ...Object.values(packages)]),
		node,
		packages
	};
}
async function readPackageVersionFromEntry(name) {
	let entry;
	try {
		const resolved = import.meta.resolve(name);
		if (!resolved.startsWith("file:")) return void 0;
		entry = fileURLToPath(resolved);
	} catch {
		return;
	}
	let directory = dirname(entry);
	for (let depth = 0; depth < PACKAGE_JSON_SEARCH_DEPTH; depth += 1) {
		const candidate = join(directory, "package.json");
		try {
			const parsed = JSON.parse(await readFile(candidate, "utf8"));
			if (parsed.name === name && typeof parsed.version === "string") return parsed.version;
		} catch {}
		const parent = parse(directory).root === directory ? directory : dirname(directory);
		if (parent === directory) break;
		directory = parent;
	}
}
/** Read installed package metadata and return only versions and statuses. */
async function detectCompatibility(options = {}) {
	const readVersion = options.readPackageVersion ?? readPackageVersionFromEntry;
	const packageVersions = options.packageVersions ?? options.packages ?? options.installed?.packages;
	const resolvedPackages = packageVersions === void 0 ? Object.fromEntries(await Promise.all(COMPATIBILITY_PACKAGES.map(async (name) => [name, await readVersion(name)]))) : packageVersions;
	return evaluateCompatibility({
		nodeVersion: options.nodeVersion ?? options.node ?? options.installed?.node ?? process.version,
		packageVersions: resolvedPackages
	});
}
//#endregion
//#region src/version.ts
const CODEX_CONNECT_VERSION = "0.3.0-dsh2.0";
//#endregion
//#region src/doctor.ts
/** Secret-free diagnostics and duplicate-provider guidance. */
/** Actionable message for legacy/manual `openai-codex` adapter collisions. */
function openAICodexConflictMessage() {
	return "dsh-codex cannot register provider \"openai-codex\" because another adapter already owns it. Remove or disable the duplicate bundle or manual openai-codex provider row, then restart Harness.";
}
/** Fail before the generic registry error so the collision has a migration hint. */
function assertNoOpenAICodexProviderConflict(providerIds) {
	if (providerIds.includes("openai-codex")) throw new Error(openAICodexConflictMessage());
}
/**
* Inspect only process and filesystem metadata. This function never opens the
* OAuth document, refreshes a token, or starts an authorization flow.
*/
async function diagnoseOpenAICodex(options = {}) {
	const path = options.credentialPath ?? openAICodexAuthPath();
	let state = "missing";
	let mode;
	try {
		const info = await lstat(path);
		if (!info.isFile()) state = "not-a-regular-file";
		else if (process.platform === "win32") state = "owner-only";
		else {
			mode = (info.mode & 511).toString(8).padStart(3, "0");
			state = (info.mode & 63) === 0 ? "owner-only" : "permissions-too-broad";
		}
	} catch (error) {
		state = error?.code === "ENOENT" ? "missing" : "unreadable-metadata";
	}
	const providerConflict = options.providerIds?.includes("openai-codex") ?? false;
	const compatibility = await detectCompatibility(options.compatibilityOptions);
	const hints = [];
	if (state === "missing") hints.push("Sign in only when you are ready; installation does not start OAuth.");
	if (state === "permissions-too-broad") hints.push(`Restrict the OAuth file to its owner before use (current mode ${mode}).`);
	if (state === "not-a-regular-file") hints.push("Replace the OAuth path with an owner-only regular file created by dsh-codex login.");
	if (state === "unreadable-metadata") hints.push("Harness could not inspect the OAuth file metadata; check the parent directory and file ownership.");
	if (providerConflict) hints.push(openAICodexConflictMessage());
	if (!providerConflict) hints.push("If Harness reports a duplicate openai-codex adapter, remove the legacy bundle or manual provider row.");
	if (compatibility.status === "incompatible") hints.push("Compatibility mismatch: use DSH Desktop 2.0.4 with plugin API 0.1.2-alpha.1 and @earendil-works/pi-ai 0.84.3, then run doctor again; no files are changed automatically.");
	else if (compatibility.status === "unknown") hints.push("Compatibility is unknown: verify the declared DSH plugin API and @earendil-works/pi-ai versions, then run doctor again.");
	return {
		package: "dsh-codex",
		version: CODEX_CONNECT_VERSION,
		node: process.version,
		credentialFile: {
			path,
			state,
			...mode === void 0 ? {} : { mode }
		},
		capabilities: {
			modelProvider: true,
			search: options.enableSearch ?? true,
			imageTool: options.enableImageTool ?? true,
			changesHarnessDefaultModel: true,
			changesHarnessSearchRoute: true
		},
		providerConflict,
		compatibility,
		hints
	};
}
//#endregion
//#region src/search-event.ts
/** Dedicated log event written before an OpenAI Codex search dispatch. */
const OPENAI_CODEX_SEARCH_MODEL_REQUEST_EVENT = "web/openai-codex-search-llm-request";
/**
* Register the plugin-owned event in the running Harness vocabulary. The
* public DSH build exports its known-event collection as read-only because
* core code must not mutate it accidentally; the runtime value is the Set
* deliberately consulted on every persistence read. Registration remains for
* the process lifetime so sessions written before an HMR cycle stay readable.
*/
function installOpenAICodexSearchEvent() {
	if (!(KNOWN_SESSION_EVENT_TYPES instanceof Set)) throw new Error("dsh-openai-codex: this Harness build does not expose an extensible session event vocabulary");
	KNOWN_SESSION_EVENT_TYPES.add(OPENAI_CODEX_SEARCH_MODEL_REQUEST_EVENT);
}
/**
* Append one resolved request to the initiating agent's session. Searches
* outside an agent turn have no owning session and therefore produce no log.
* @param ctx - plugin context carrying the optional active-agent service.
* @param request - exact request after defaults, excluding credentials.
*/
function recordOpenAICodexSearchRequest(ctx, request) {
	ctx.get("agents")?.currentInitiator()?.session.append(OPENAI_CODEX_SEARCH_MODEL_REQUEST_EVENT, request);
}
//#endregion
//#region src/tool-policy.ts
/** Defaults keep generic vision-model interoperability enabled. */
const DEFAULT_IMAGE_TOOL_PREFERENCES = {
	modifyReadImage: true,
	shareImagegenWithOtherModels: true
};
/** Conservative defaults preserve the established stateless Harness behavior. */
const DEFAULT_RESPONSE_API_PREFERENCES = {
	useWebSocketContextReuse: false,
	useNativeCompaction: false
};
const NAMESPACE = settingsNamespace("openai-codex");
function preferenceSchema(defaultModels) {
	return z.object({
		modifyReadImage: z.boolean().default(true),
		shareImagegenWithOtherModels: z.boolean().default(true),
		useWebSocketContextReuse: z.boolean().default(false),
		useStatefulResponses: z.boolean().default(false),
		useNativeCompaction: z.boolean().default(false),
		models: z.array(z.string()).default([...defaultModels])
	});
}
/** Live policy shared by the host tools, Codex adapter, and settings HTTP surface. */
var ImageToolPolicy = class {
	current;
	scope;
	imageWatchers = /* @__PURE__ */ new Set();
	modelCatalog;
	constructor(base = {}, modelCatalog = []) {
		this.modelCatalog = modelCatalog.map((model) => ({ ...model }));
		this.current = {
			...DEFAULT_IMAGE_TOOL_PREFERENCES,
			...DEFAULT_RESPONSE_API_PREFERENCES,
			useStatefulResponses: false,
			...base,
			models: this.normalizeModels(base.models ?? this.modelCatalog.map((model) => model.id))
		};
		if (this.current.useStatefulResponses && base.useWebSocketContextReuse === void 0) this.current = {
			...this.current,
			useWebSocketContextReuse: true
		};
	}
	/** Register durable live settings when the active profile supplies ctx.settings. */
	attach(ctx) {
		const scope = ctx.settings.register(NAMESPACE, preferenceSchema(this.current.models), {
			base: this.current,
			applies: "live"
		});
		this.scope = scope;
		this.replace(scope.get());
		const unwatch = scope.watch((next) => {
			this.replace(next);
		});
		ctx.effect(() => () => {
			unwatch();
			if (this.scope === scope) this.scope = void 0;
		}, "dsh-openai-codex: preferences");
	}
	/** Return a detached settings projection for the browser. */
	snapshot() {
		return {
			modifyReadImage: this.current.modifyReadImage,
			shareImagegenWithOtherModels: this.current.shareImagegenWithOtherModels
		};
	}
	/** Observe live changes that add or remove the scoped `read_image` enhancement. */
	watchImagePreferences(listener) {
		this.imageWatchers.add(listener);
		return () => {
			this.imageWatchers.delete(listener);
		};
	}
	/** Persist a partial browser update through the settings service. */
	async update(patch) {
		if (this.scope === void 0) throw new Error("OpenAI Codex settings service is unavailable");
		await this.scope.update(patch);
		this.replace(this.scope.get());
		return this.snapshot();
	}
	/** Return the current Codex-only Responses API experiments. */
	responseApiSnapshot() {
		return {
			useWebSocketContextReuse: this.current.useWebSocketContextReuse,
			useNativeCompaction: this.current.useNativeCompaction
		};
	}
	/** Persist a partial Responses API experiment update. */
	async updateResponseApi(patch) {
		if (this.scope === void 0) throw new Error("OpenAI Codex settings service is unavailable");
		await this.scope.update({
			...patch,
			...patch.useWebSocketContextReuse === void 0 ? {} : { useStatefulResponses: false }
		});
		this.replace(this.scope.get());
		return this.responseApiSnapshot();
	}
	/** Return available models and the live discovery subset for the browser. */
	modelCatalogSnapshot() {
		return {
			availableModels: this.modelCatalog.map((model) => ({ ...model })),
			models: [...this.current.models]
		};
	}
	/** Persist the model subset advertised by this provider. */
	async updateModelCatalog(patch) {
		if (this.scope === void 0) throw new Error("OpenAI Codex settings service is unavailable");
		if (patch.models === void 0) return this.modelCatalogSnapshot();
		await this.scope.update({ models: this.normalizeModels(patch.models) });
		this.replace(this.scope.get());
		return this.modelCatalogSnapshot();
	}
	/** Enforce imagegen's cross-provider toggle at execution time. */
	assertAllowed(exec, tool) {
		if (((exec.agent?.session.requestHeader()?.config)?.provider ?? exec.agent?.options.provider) === "openai-codex") return;
		if (!this.current.shareImagegenWithOtherModels) throw new Error(`${tool} is disabled for models outside the openai-codex provider in Settings`);
	}
	replace(next) {
		next = next.useStatefulResponses && !next.useWebSocketContextReuse ? {
			...next,
			useWebSocketContextReuse: true
		} : next;
		next = {
			...next,
			models: this.normalizeModels(next.models)
		};
		const imageChanged = next.modifyReadImage !== this.current.modifyReadImage || next.shareImagegenWithOtherModels !== this.current.shareImagegenWithOtherModels;
		this.current = next;
		if (imageChanged) for (const listener of this.imageWatchers) listener();
	}
	normalizeModels(models) {
		const selected = new Set(models);
		return this.modelCatalog.filter((model) => selected.has(model.id)).map((model) => model.id);
	}
};
//#endregion
//#region src/service.ts
/**
* One provider-owned host service shared by Web routes and terminal adapters.
* Credentials and live policy stay singletons even when several front doors are mounted.
*/
var OpenAICodexService = class {
	credentials = new OpenAICodexCredentialStore();
	policy;
	constructor(options) {
		this.policy = new ImageToolPolicy(options, options.modelCatalog);
	}
	/** Attach the durable settings document when the active profile provides it. */
	attachSettings(ctx) {
		this.policy.attach(ctx);
	}
	/** Start the provider-native OAuth lifecycle. */
	login(interaction) {
		return loginOpenAICodex(interaction, this.credentials);
	}
	/** Remove this plugin's credential without touching Codex CLI/Desktop. */
	logout() {
		return logoutOpenAICodex(this.credentials);
	}
	/** Read non-secret authentication metadata. */
	authStatus() {
		return openAICodexAuthStatus(this.credentials);
	}
	/** Read current subscription limits without issuing a model request. */
	usage() {
		return readOpenAICodexRateLimits(this.credentials);
	}
	imagePreferences() {
		return this.policy.snapshot();
	}
	updateImagePreferences(patch) {
		return this.policy.update(patch);
	}
	responsePreferences() {
		return this.policy.responseApiSnapshot();
	}
	updateResponsePreferences(patch) {
		return this.policy.updateResponseApi(patch);
	}
};
//#endregion
//#region src/index.ts
/** Stable Cordis plugin name. */
const name = "llm-openai-codex";
/** LLM and web registries required before the composite provider can register. */
const inject = ["llm", "web"];
const Config = z.object({
	models: z.union([z.const(void 0), z.array(z.string())]),
	searchModel: z.string().default(DEFAULT_OPENAI_CODEX_SEARCH_MODEL),
	searchMode: z.union([
		"cached",
		"indexed",
		"live"
	]).default(DEFAULT_OPENAI_CODEX_SEARCH_MODE),
	searchContextSize: z.union([
		"low",
		"medium",
		"high"
	]).default(DEFAULT_OPENAI_CODEX_SEARCH_CONTEXT_SIZE),
	searchMaxOutputTokens: z.number().step(1).min(1).default(DEFAULT_OPENAI_CODEX_SEARCH_MAX_OUTPUT_TOKENS),
	modifyReadImage: z.boolean().default(true),
	shareImagegenWithOtherModels: z.boolean().default(true),
	useWebSocketContextReuse: z.boolean().default(false),
	useNativeCompaction: z.boolean().default(false)
});
/**
* Register the `openai-codex` LLM route and standalone web-search provider
* with one provider-native OAuth credential store.
* @param ctx - plugin context carrying the LLM and web registries plus optional agent and attachment services.
* @param config - standalone-search model, access mode, context size, and output budget.
*/
function apply(ctx, config) {
	installOpenAICodexSearchEvent();
	const service = new OpenAICodexService({
		...config.models === void 0 ? {} : { models: config.models },
		modelCatalog: openAICodexModelCatalog(),
		modifyReadImage: config.modifyReadImage ?? true,
		shareImagegenWithOtherModels: config.shareImagegenWithOtherModels ?? true,
		useWebSocketContextReuse: config.useWebSocketContextReuse ?? false,
		useNativeCompaction: config.useNativeCompaction ?? false
	});
	const credentials = service.credentials;
	const imageTools = service.policy;
	const fastMode = new FastModeRegistry();
	assertNoOpenAICodexProviderConflict(ctx.llm.listProviders().map((provider) => provider.id));
	ctx.provide("openAICodex", service);
	ctx.inject(["settings"], (settingsCtx) => {
		service.attachSettings(settingsCtx);
	});
	ctx.llm.registerAdapter([OPENAI_CODEX_PROVIDER], createOpenAICodexAdapter(credentials, () => ctx.get("attachments"), () => imageTools.responseApiSnapshot(), fastMode, () => imageTools.modelCatalogSnapshot().models));
	ctx.web.registerSearchProvider(new OpenAICodexSearchProvider({
		credentials,
		model: config.searchModel ?? "gpt-5.6-sol",
		mode: config.searchMode ?? "cached",
		contextSize: config.searchContextSize ?? "medium",
		maxOutputTokens: config.searchMaxOutputTokens ?? 1e4,
		resolveRequestId: () => String(ctx.get("agents")?.currentInitiator()?.session.id ?? randomUUID()),
		recordRequest: (request) => {
			recordOpenAICodexSearchRequest(ctx, request);
		}
	}));
	ctx.inject(["webServer"], (webCtx) => registerOpenAICodexAuthRoutes(webCtx, credentials, void 0, fastMode, imageTools));
	ctx.inject([
		"tools",
		"fs",
		"attachments"
	], (toolCtx) => {
		toolCtx.tools.register(imagegenTool(toolCtx, credentials, imageTools));
	});
	ctx.inject([
		"tools",
		"fs",
		"attachments",
		"agents"
	], (toolCtx) => {
		installReadImageEnhancement(toolCtx, imageTools);
	});
}
//#endregion
export { READ_IMAGE_TOOL_NAME as A, OPENAI_CODEX_USAGE_URL as B, DEFAULT_OPENAI_CODEX_SEARCH_MODE as C, OPENAI_CODEX_SEARCH_URL as D, OPENAI_CODEX_SEARCH_PROVIDER as E, isFastModeSessionId as F, loginOpenAICodex as G, isOpenAICodexReauthRequiredError as H, OpenAICodexTrustedOriginsStore as I, OPENAI_CODEX_AUTH_FILENAME as J, logoutOpenAICodex as K, normalizeTrustedOrigin as L, FastModeRegistry as M, OPENAI_CODEX_FAST_MODE_MAX_SESSIONS as N, OpenAICodexSearchProvider as O, OPENAI_CODEX_FAST_MODE_MAX_SESSION_ID_LENGTH as P, OPENAI_CODEX_REAUTH_REQUIRED_CODE as R, DEFAULT_OPENAI_CODEX_SEARCH_MAX_OUTPUT_TOKENS as S, OPENAI_CODEX_BASE_URL as T, parseOpenAICodexUsage as U, OpenAICodexReauthRequiredError as V, readOpenAICodexRateLimits as W, OpenAICodexCredentialStore as X, OPENAI_CODEX_PROVIDER as Y, openAICodexAuthPath as Z, OPENAI_CODEX_IMAGE_EDITS_URL as _, OpenAICodexService as a, OpenAICodexImageClient as b, ImageToolPolicy as c, recordOpenAICodexSearchRequest as d, assertNoOpenAICodexProviderConflict as f, IMAGEGEN_TOOL_NAME as g, CODEX_CONNECT_VERSION as h, name as i, OPENAI_CODEX_FAST_MODE_PATH as j, mapOpenAICodexSearchResponse as k, OPENAI_CODEX_SEARCH_MODEL_REQUEST_EVENT as l, openAICodexConflictMessage as m, apply as n, DEFAULT_IMAGE_TOOL_PREFERENCES as o, diagnoseOpenAICodex as p, openAICodexAuthStatus as q, inject as r, DEFAULT_RESPONSE_API_PREFERENCES as s, Config as t, installOpenAICodexSearchEvent as u, OPENAI_CODEX_IMAGE_GENERATIONS_URL as v, DEFAULT_OPENAI_CODEX_SEARCH_MODEL as w, DEFAULT_OPENAI_CODEX_SEARCH_CONTEXT_SIZE as x, OPENAI_CODEX_IMAGE_MODEL as y, OPENAI_CODEX_REAUTH_REQUIRED_MESSAGE as z };
