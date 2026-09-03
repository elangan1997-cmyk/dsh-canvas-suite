import { spawn } from "node:child_process";
//#region src/tui.ts
/** Optional dsh-tui front-door adapter for account and live preference commands. */
const name = "dsh-codex-tui";
const inject = ["openAICodex"];
const HELP = [
	"Usage: /codex <status|login|logout|usage|config|set>",
	"  /codex status",
	"  /codex login",
	"  /codex logout",
	"  /codex usage",
	"  /codex config",
	"  /codex set <read-image|imagegen-other-models|websocket-context|native-compaction> <on|off>"
].join("\n");
function translatedNode(name, en, zh) {
	return {
		name,
		description: en,
		descriptions: {
			en,
			zh
		}
	};
}
const CODEX_ACTIONS = [
	translatedNode("status", "Show the ChatGPT sign-in state", "查看 ChatGPT 登录状态"),
	translatedNode("login", "Sign in with ChatGPT in the system browser", "在系统浏览器中登录 ChatGPT"),
	translatedNode("logout", "Remove the dsh Codex credential", "移除 dsh Codex 登录凭据"),
	translatedNode("usage", "Show current Codex usage limits", "查看当前 Codex 用量限制"),
	translatedNode("config", "Show live Codex settings", "查看 Codex 实时配置"),
	translatedNode("set", "Change one live Codex setting", "修改一项 Codex 实时配置")
];
const CODEX_SETTINGS = [
	translatedNode("read-image", "Enhance read_image with HTTP(S) input", "为 read_image 增加 HTTP(S) 图片输入"),
	translatedNode("imagegen-other-models", "Allow other vision models to call imagegen", "允许其他视觉模型调用 imagegen"),
	translatedNode("websocket-context", "Reuse Codex WebSocket response context", "复用 Codex WebSocket 响应上下文"),
	translatedNode("native-compaction", "Use Codex V2 Responses compaction", "使用 Codex V2 Responses 压缩")
];
const BOOLEAN_VALUES = [translatedNode("on", "Enable this setting", "启用此设置"), translatedNode("off", "Disable this setting", "关闭此设置")];
function codexSubcommands(path) {
	if (path.length === 1 && path[0] === "codex") return CODEX_ACTIONS;
	if (path.length === 2 && path[0] === "codex" && path[1] === "set") return CODEX_SETTINGS;
	if (path.length === 3 && path[0] === "codex" && path[1] === "set" && CODEX_SETTINGS.some((setting) => setting.name === path[2])) return BOOLEAN_VALUES;
	return [];
}
function success(text) {
	return {
		kind: "success",
		text
	};
}
function failure(text) {
	return {
		kind: "error",
		text
	};
}
function safeMessage(error) {
	return (error instanceof Error ? error.message : String(error)).replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/gu, "[redacted token]").replace(/(\b(?:code|token|refresh_token|access_token)=)[^&\s]+/giu, "$1[redacted]").slice(0, 1e3);
}
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
/** Open one provider-issued HTTPS challenge without passing it through shell parsing. */
function openBrowser(rawUrl) {
	const url = new URL(rawUrl);
	if (url.protocol !== "https:") throw new Error(`refusing to open non-HTTPS authorization URL from ${url.host}`);
	if (process.platform === "linux" && process.env.DISPLAY === void 0 && process.env.WAYLAND_DISPLAY === void 0) return false;
	const command = process.platform === "win32" ? {
		file: "rundll32.exe",
		args: ["url.dll,FileProtocolHandler", url.href]
	} : process.platform === "darwin" ? {
		file: "open",
		args: [url.href]
	} : {
		file: "xdg-open",
		args: [url.href]
	};
	const child = spawn(command.file, command.args, {
		detached: true,
		stdio: "ignore",
		windowsHide: true
	});
	child.on("error", () => {});
	child.unref();
	return true;
}
/** Own the browser challenge while the command returns control to the TUI immediately. */
var TuiLoginController = class {
	service;
	state = { status: "idle" };
	operation;
	cancellation;
	challenge;
	resolveChallenge;
	rejectChallenge;
	constructor(service) {
		this.service = service;
	}
	async start() {
		if ((await this.service.authStatus()).authenticated) return "OpenAI Codex is already signed in.";
		if (this.operation === void 0) this.begin();
		const challenge = this.challenge;
		if (challenge === void 0) throw new Error("OpenAI Codex sign-in did not create an authorization challenge");
		return await challenge;
	}
	status() {
		return this.state;
	}
	async logout() {
		this.cancellation?.abort(/* @__PURE__ */ new Error("OpenAI Codex sign-in cancelled"));
		await this.operation?.catch(() => void 0);
		await this.service.logout();
		this.state = { status: "idle" };
	}
	async dispose() {
		this.cancellation?.abort(/* @__PURE__ */ new Error("OpenAI Codex TUI adapter disposed"));
		await this.operation?.catch(() => void 0);
	}
	begin() {
		const cancellation = new AbortController();
		this.cancellation = cancellation;
		this.state = { status: "signing-in" };
		this.challenge = new Promise((resolve, reject) => {
			this.resolveChallenge = resolve;
			this.rejectChallenge = reject;
		});
		this.operation = this.service.login({
			signal: cancellation.signal,
			prompt: (prompt) => prompt.type === "select" ? Promise.resolve("browser") : waitForPromptAbort(prompt),
			notify: (event) => {
				this.onEvent(event);
			}
		}).then(() => {
			this.state = { status: "idle" };
		}, (error) => {
			const message = safeMessage(error);
			this.state = {
				status: "error",
				message
			};
			this.rejectChallenge?.(error);
		}).finally(() => {
			this.operation = void 0;
			this.cancellation = void 0;
			this.resolveChallenge = void 0;
			this.rejectChallenge = void 0;
		});
	}
	onEvent(event) {
		if (event.type !== "auth_url") return;
		try {
			const opened = openBrowser(event.url);
			this.resolveChallenge?.(opened ? "Opened the ChatGPT authorization page. Use /codex status after approval." : `Open this ChatGPT authorization page: ${event.url}\nUse /codex status after approval.`);
		} catch (error) {
			this.cancellation?.abort(error);
			this.rejectChallenge?.(error);
		}
	}
};
function formatExpiry(expiresAt) {
	return expiresAt === void 0 || Number.isNaN(expiresAt.valueOf()) ? "" : ` Access token expires ${expiresAt.toISOString()}; refresh is automatic.`;
}
function formatUsage(usage) {
	const lines = [];
	for (const limit of usage.rateLimits) {
		const name = limit.name ?? limit.id;
		for (const window of limit.windows) lines.push(`${name} (${window.windowSeconds}s): ${window.remainingPercent.toFixed(1)}% remaining`);
	}
	if (usage.individualLimit !== void 0) lines.push(`Individual limit: ${usage.individualLimit.remainingPercent.toFixed(1)}% remaining (${usage.individualLimit.remaining}/${usage.individualLimit.limit})`);
	if (usage.credits !== void 0) lines.push(`Credits: ${usage.credits.unlimited ? "unlimited" : usage.credits.balance ?? "available"}`);
	return lines.length === 0 ? "OpenAI Codex usage is currently unavailable." : lines.join("\n");
}
function formatConfig(service) {
	const image = service.imagePreferences();
	const responses = service.responsePreferences();
	return [
		`read-image: ${image.modifyReadImage ? "on" : "off"}`,
		`imagegen-other-models: ${image.shareImagegenWithOtherModels ? "on" : "off"}`,
		`websocket-context: ${responses.useWebSocketContextReuse ? "on" : "off"}`,
		`native-compaction: ${responses.useNativeCompaction ? "on" : "off"}`
	].join("\n");
}
async function updateSetting(service, key, enabled) {
	switch (key) {
		case "read-image":
			await service.updateImagePreferences({ modifyReadImage: enabled });
			return;
		case "imagegen-other-models":
			await service.updateImagePreferences({ shareImagegenWithOtherModels: enabled });
			return;
		case "websocket-context":
			await service.updateResponsePreferences({ useWebSocketContextReuse: enabled });
			return;
		case "native-compaction":
			await service.updateResponsePreferences({ useNativeCompaction: enabled });
			return;
		default: throw new Error(`unknown setting ${JSON.stringify(key)}`);
	}
}
/** Register executable commands independently from any concrete UI frontend. */
function apply(ctx) {
	ctx.inject(["commands"], registerCodexCommand);
	ctx.inject(["tuiCommandTrees"], registerTuiCommandTree);
}
function registerCodexCommand(ctx) {
	const commandCtx = ctx;
	const service = commandCtx.openAICodex;
	const login = new TuiLoginController(service);
	const disposeCommand = commandCtx.commands.register({
		name: "codex",
		description: "Manage the OpenAI Codex account and provider settings",
		input: { hint: "subcommand" },
		async handler({ rawInput }) {
			const parts = rawInput.trim().split(/\s+/u).filter(Boolean);
			const action = parts[0] ?? "status";
			try {
				switch (action) {
					case "status": {
						const state = login.status();
						if (state.status === "signing-in") return success("OpenAI Codex sign-in is waiting for browser approval.");
						if (state.status === "error") return failure(`OpenAI Codex sign-in failed: ${state.message}`);
						const status = await service.authStatus();
						return status.authenticated ? success(`OpenAI Codex is signed in.${formatExpiry(status.expiresAt)}`) : failure("OpenAI Codex is signed out. Run /codex login.");
					}
					case "login":
						if (parts.length !== 1) return failure(HELP);
						return success(await login.start());
					case "logout":
						if (parts.length !== 1) return failure(HELP);
						await login.logout();
						return success("OpenAI Codex is signed out.");
					case "usage":
						if (parts.length !== 1) return failure(HELP);
						return success(formatUsage(await service.usage()));
					case "config":
						if (parts.length !== 1) return failure(HELP);
						return success(formatConfig(service));
					case "set":
						if (parts.length !== 3 || parts[2] !== "on" && parts[2] !== "off") return failure(HELP);
						await updateSetting(service, parts[1], parts[2] === "on");
						return success(formatConfig(service));
					default: return failure(HELP);
				}
			} catch (error) {
				return failure(safeMessage(error));
			}
		}
	});
	ctx.effect(() => async () => {
		disposeCommand();
		await login.dispose();
	}, "OpenAI Codex command adapter");
}
function registerTuiCommandTree(ctx) {
	const disposeTree = ctx.tuiCommandTrees.register({
		root: "codex",
		descriptions: {
			en: "Manage the OpenAI Codex account and provider settings",
			zh: "管理 OpenAI Codex 账号与提供方设置"
		},
		children: codexSubcommands
	});
	ctx.provide("openAICodexTui", {});
	ctx.effect(() => disposeTree, "OpenAI Codex TUI completion adapter");
}
//#endregion
export { apply, apply as default, inject, name };
