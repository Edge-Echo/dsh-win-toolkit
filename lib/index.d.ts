import type { Context } from '@deepseek-ai/cordis';
/** Plugin config: per-call PowerShell timeout. */
export interface WinToolkitConfig {
    psTimeoutMs?: number;
}
declare const _default: ((ctx: Context, config?: WinToolkitConfig) => void) & {
    inject: string[];
};
export default _default;
