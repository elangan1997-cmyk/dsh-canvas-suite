import { Context } from "@deepseek-ai/cordis";
//#region src/invariant.d.ts
/** Cordis companion plugin name. */
declare const name = "openai-codex-invariant";
/** Service required before the companion can register. */
declare const inject: string[];
/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
declare const apply: (ctx: Context) => Promise<() => void>;
//#endregion
export { apply, inject, name };