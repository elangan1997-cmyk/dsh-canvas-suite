import { Context } from "@deepseek-ai/cordis";
//#region src/tui.d.ts
declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Empty marker published while the Codex terminal adapter is active. */
    openAICodexTui: object;
  }
}
declare const name = "dsh-codex-tui";
declare const inject: string[];
/** Register executable commands independently from any concrete UI frontend. */
declare function apply(ctx: Context): void;
//#endregion
export { apply, apply as default, inject, name };