import type { OpencodeClient } from "@opencode-ai/sdk";
import type { GoalStore } from "./store";
export declare class GoalRuntimeHooks {
    private readonly store;
    private readonly client;
    private readonly options;
    private childrenByParent;
    private commandOriginSkip;
    constructor(store: GoalStore, client: {
        session: Pick<OpencodeClient["session"], "promptAsync">;
    }, options?: {
        maxContextBytes: number;
        autoContinue: boolean;
        suppressQuestions?: boolean;
        deferWhileSubagentsActive?: boolean;
        subagentGraceMs?: number;
        skipCommandOriginatedSupplements?: boolean;
        commandOriginSkipTtlMs?: number;
        ignoreSupplementMarkers?: string[];
        now?: () => number;
    });
    noteCommandOrigin(sessionID: string): void;
    onToolExecuteBefore(input: {
        tool: string;
        sessionID: string;
        callID: string;
    }, _output: {
        args: unknown;
    }): Promise<void>;
    onEvent(input: {
        event: {
            type: string;
            properties?: Record<string, any>;
        };
    }): Promise<void>;
    private trackChildCreated;
    private updateTrackedChildStatus;
    private markTrackedChildIdle;
    private removeTrackedChild;
    private findTrackedChild;
    private hasActiveSubagents;
    private now;
    private debugLog;
    private settleInFlightContinuation;
    maybeAutoContinue(sessionID: string): Promise<void>;
    onChatMessage(input: {
        sessionID: string;
        messageID?: string;
    }, output: {
        parts: any[];
    }): Promise<void>;
    onSystemTransform(input: {
        sessionID?: string;
    }, output: {
        system: string[];
    }): Promise<void>;
    onCompacting(input: {
        sessionID: string;
    }, output: {
        context: string[];
    }): Promise<void>;
    onCompactionAutocontinue(input: {
        sessionID: string;
    }, output: {
        enabled: boolean;
    }): Promise<void>;
    private markCompactionNoticePending;
    private setFlagsIfSessionExists;
}
