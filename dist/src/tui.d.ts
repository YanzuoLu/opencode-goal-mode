export { goalStartPromptText } from "./context";
type GoalTuiApi = {
    route?: {
        current?: {
            params?: Record<string, unknown>;
        };
    };
    state?: {
        session?: {
            get?: (sessionID: string) => any;
            status?: (sessionID: string) => any;
        };
    };
    client?: {
        session?: {
            promptAsync?: (input: any) => Promise<unknown> | unknown;
        };
    };
    ui?: {
        toast?: (input: {
            variant?: "info" | "success" | "warning" | "error";
            title?: string;
            message: string;
        }) => void;
        dialog?: {
            replace?: (render: () => unknown, onClose?: () => void) => void;
            clear?: () => void;
        };
        DialogSelect?: (props: any) => unknown;
        DialogPrompt?: (props: any) => unknown;
    };
    keymap?: {
        registerLayer?: (layer: any) => () => void;
    };
    command?: {
        register?: (callback: () => any[]) => () => void;
    };
    lifecycle?: {
        onDispose?: (dispose: () => void) => unknown;
    };
};
export declare function currentSessionID(api: {
    route?: {
        current?: {
            params?: Record<string, unknown>;
        };
    };
}): string | undefined;
export declare function registerGoalTuiCommand(api: GoalTuiApi, rawOptions?: unknown): () => void;
export declare function tui(api: GoalTuiApi, rawOptions?: unknown): Promise<void>;
declare const _default: {
    id: string;
    tui: typeof tui;
};
export default _default;
