export declare const DEFAULT_TIMEOUT_MS = 15000;
/** Run one PowerShell script; returns trimmed stdout. */
export declare function ps(script: string, timeoutMs?: number): Promise<string>;
export type FindingLevel = 'ok' | 'warn' | 'error';
export interface Finding {
    level: FindingLevel;
    title: string;
    detail?: string;
}
export interface EnvReport {
    ok: boolean;
    findings: Finding[];
    suggestions: string[];
    /** Raw values the findings were derived from. */
    raw: {
        platform: string;
        powershell?: string;
        executionPolicy?: string;
        clipboard?: string;
        comObject?: string;
        hostsReadable?: boolean;
    };
}
/**
 * Check everything the toolkit's tools depend on: the platform, PowerShell,
 * the execution policy, clipboard access, WScript.Shell COM (notifications)
 * and hosts-file readability.
 */
export declare function runEnvDoctor(timeoutMs?: number): Promise<EnvReport>;
/** Render the environment report for a terminal. */
export declare function renderEnvReport(report: EnvReport): string;
