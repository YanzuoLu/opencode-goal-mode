import { renderActiveGoalContext } from "./context";
import { parseOptions } from "./plugin-options";
import { GoalStore } from "./store";
import type { GoalSessionState } from "./types";

type GoalStartAction = "set" | "replace" | "resume";
type GoalMenuAction = GoalStartAction | "show" | "pause" | "drop";

type GoalTuiApi = {
  route?: { current?: { params?: Record<string, unknown> } };
  state?: {
    session?: {
      get?: (sessionID: string) => any;
      status?: (sessionID: string) => any;
    };
  };
  client?: { session?: { promptAsync?: (input: any) => Promise<unknown> | unknown } };
  ui?: {
    toast?: (input: { variant?: "info" | "success" | "warning" | "error"; title?: string; message: string }) => void;
    dialog?: {
      replace?: (render: () => unknown, onClose?: () => void) => void;
      clear?: () => void;
    };
    DialogSelect?: (props: any) => unknown;
    DialogPrompt?: (props: any) => unknown;
    DialogAlert?: (props: any) => unknown;
  };
  keymap?: { registerLayer?: (layer: any) => () => void };
  command?: { register?: (callback: () => any[]) => () => void };
  lifecycle?: { onDispose?: (dispose: () => void) => unknown };
};

type SessionInfo = {
  sessionID: string;
  agent?: string;
  variant?: unknown;
  model: { modelID: string; providerID: string };
};

export function currentSessionID(api: { route?: { current?: { params?: Record<string, unknown> } } }): string | undefined {
  const value = api.route?.current?.params?.sessionID;
  return typeof value === "string" ? value : undefined;
}

export function goalStartPromptText(context: string, action: GoalStartAction): string {
  const instruction = action === "resume"
    ? "Resume working toward the active goal."
    : action === "replace"
      ? "Begin working toward the replacement active goal."
      : "Begin working toward the active goal.";
  return `${context}\n\n${instruction}\nIf the goal is now complete, call goal({ op: "complete" }).`;
}

function toast(
  api: GoalTuiApi,
  variant: "info" | "success" | "warning" | "error",
  message: string,
): void {
  api.ui?.toast?.({ variant, title: "Goal", message });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Goal command failed";
}

function sessionAgent(session: any): string | undefined {
  if (typeof session?.agent === "string") return session.agent;
  if (typeof session?.agent?.name === "string") return session.agent.name;
  if (typeof session?.agent?.id === "string") return session.agent.id;
  return undefined;
}

function sessionModel(session: any): SessionInfo["model"] | undefined {
  const modelID = session?.model?.id;
  const providerID = session?.model?.providerID;
  if (typeof modelID !== "string" || typeof providerID !== "string") return undefined;
  return { modelID, providerID };
}

function requireSessionInfo(api: GoalTuiApi): SessionInfo | undefined {
  const sessionID = currentSessionID(api);
  if (!sessionID) {
    toast(api, "error", "No active session");
    return undefined;
  }

  const status = api.state?.session?.status?.(sessionID);
  if (status?.type === "busy" || status?.type === "retry") {
    toast(api, "info", "Session is busy; try again when idle");
    return undefined;
  }

  const session = api.state?.session?.get?.(sessionID);
  if (!session) {
    toast(api, "error", "No active session");
    return undefined;
  }

  const model = sessionModel(session);
  if (!model) {
    toast(api, "error", "No session model");
    return undefined;
  }

  const variant = session?.model?.variant;
  return {
    sessionID,
    model,
    agent: sessionAgent(session),
    ...(variant !== undefined ? { variant } : {}),
  };
}

function hasPromptAsync(api: GoalTuiApi): boolean {
  if (typeof api.client?.session?.promptAsync !== "function") {
    toast(api, "error", "Session prompt API is unavailable");
    return false;
  }
  return true;
}

async function promptWithActiveGoal(
  api: GoalTuiApi,
  store: GoalStore,
  info: SessionInfo,
  state: GoalSessionState,
  action: GoalStartAction,
): Promise<void> {
  const context = renderActiveGoalContext(state);
  if (!context) {
    toast(api, "error", "No active goal");
    return;
  }

  const text = goalStartPromptText(context, action);
  await store.setFlags(info.sessionID, {
    ignoredInputTexts: [...state.flags.ignoredInputTexts, text],
  });

  const input: any = {
    sessionID: info.sessionID,
    model: info.model,
    parts: [{ type: "text", text }],
  };
  if (info.agent) input.agent = info.agent;
  if (info.variant !== undefined) input.variant = info.variant;

  await api.client?.session?.promptAsync?.(input);
}

async function setGoal(api: GoalTuiApi, store: GoalStore, objective: string): Promise<void> {
  const trimmed = objective.trim();
  if (!trimmed) {
    toast(api, "error", "Goal objective cannot be blank");
    return;
  }

  const info = requireSessionInfo(api);
  if (!info || !hasPromptAsync(api)) return;

  try {
    const state = await store.createGoal(info.sessionID, trimmed);
    toast(api, "success", "Goal set");
    await promptWithActiveGoal(api, store, info, state, "set");
  } catch (error) {
    toast(api, "error", errorMessage(error));
  }
}

async function replaceGoal(api: GoalTuiApi, store: GoalStore, objective: string): Promise<void> {
  const trimmed = objective.trim();
  if (!trimmed) {
    toast(api, "error", "Goal objective cannot be blank");
    return;
  }

  const info = requireSessionInfo(api);
  if (!info || !hasPromptAsync(api)) return;

  try {
    const state = await store.replaceGoal(info.sessionID, trimmed);
    toast(api, "success", "Goal replaced");
    await promptWithActiveGoal(api, store, info, state, "replace");
  } catch (error) {
    toast(api, "error", errorMessage(error));
  }
}

async function showGoal(api: GoalTuiApi, store: GoalStore): Promise<void> {
  const sessionID = currentSessionID(api);
  if (!sessionID) {
    toast(api, "error", "No active session");
    return;
  }

  const context = renderActiveGoalContext(await store.getSession(sessionID));
  if (!context) {
    toast(api, "info", "No active goal");
    return;
  }

  api.ui?.dialog?.replace?.(() =>
    api.ui?.DialogAlert?.({
      title: "Active goal",
      message: context,
      onConfirm: () => api.ui?.dialog?.clear?.(),
    }) ?? { title: "Active goal", message: context }
  );
}

async function pauseGoal(api: GoalTuiApi, store: GoalStore): Promise<void> {
  const info = requireSessionInfo(api);
  if (!info) return;

  const state = await store.getSession(info.sessionID);
  if (state.goal?.status !== "active") {
    toast(api, "info", "No active goal");
    return;
  }

  state.goal = { ...state.goal, status: "paused", updatedAt: Date.now() };
  await store.saveSession(state);
  toast(api, "success", "Goal paused");
}

async function dropGoal(api: GoalTuiApi, store: GoalStore): Promise<void> {
  const info = requireSessionInfo(api);
  if (!info) return;

  const state = await store.getSession(info.sessionID);
  if (state.goal?.status !== "active" && state.goal?.status !== "paused") {
    toast(api, "info", "No active goal");
    return;
  }

  state.goal = {
    ...state.goal,
    status: "dropped",
    droppedAt: Date.now(),
    updatedAt: Date.now(),
  };
  state.flags = {
    ...state.flags,
    continuationInFlight: false,
    autoContinuationSuppressed: true,
  };
  await store.saveSession(state);
  toast(api, "success", "Goal dropped");
}

async function resumeGoal(api: GoalTuiApi, store: GoalStore): Promise<void> {
  const info = requireSessionInfo(api);
  if (!info) return;

  const state = await store.getSession(info.sessionID);
  if (state.goal?.status !== "paused" && state.goal?.status !== "active") {
    toast(api, "info", "No active goal");
    return;
  }
  if (!hasPromptAsync(api)) return;

  state.goal = { ...state.goal, status: "active", updatedAt: Date.now() };
  state.flags = { ...state.flags, autoContinuationSuppressed: false };
  const saved = await store.saveSession(state);
  toast(api, "success", "Goal resumed");
  await promptWithActiveGoal(api, store, info, saved, "resume");
}

function showGoalPrompt(api: GoalTuiApi, store: GoalStore, action: "set" | "replace"): void {
  api.ui?.dialog?.replace?.(() =>
    api.ui?.DialogPrompt?.({
      title: action === "set" ? "Set goal" : "Replace goal",
      placeholder: "Describe the goal",
      onConfirm: async (value: string) => {
        api.ui?.dialog?.clear?.();
        if (action === "set") await setGoal(api, store, value);
        else await replaceGoal(api, store, value);
      },
      onCancel: () => api.ui?.dialog?.clear?.(),
    }) ?? { title: action === "set" ? "Set goal" : "Replace goal" }
  );
}

async function runAction(api: GoalTuiApi, store: GoalStore, action: GoalMenuAction): Promise<void> {
  if (action === "set" || action === "replace") {
    showGoalPrompt(api, store, action);
    return;
  }
  if (action === "show") return showGoal(api, store);
  if (action === "pause") return pauseGoal(api, store);
  if (action === "resume") return resumeGoal(api, store);
  return dropGoal(api, store);
}

function menuOptions(api: GoalTuiApi, store: GoalStore) {
  const option = (title: string, value: GoalMenuAction, description: string) => ({
    title,
    value,
    description,
    onSelect: () => runAction(api, store, value),
  });

  return [
    option("Show active goal", "show", "Display the current active goal context"),
    option("Set goal", "set", "Start a goal if none is active"),
    option("Replace goal", "replace", "Replace the current goal"),
    option("Pause goal", "pause", "Pause the active goal"),
    option("Resume goal", "resume", "Resume a paused goal"),
    option("Drop goal", "drop", "Drop the active goal"),
  ];
}

function showGoalMenu(api: GoalTuiApi, store: GoalStore): void {
  api.ui?.dialog?.replace?.(() =>
    api.ui?.DialogSelect?.({
      title: "Goal",
      placeholder: "Choose a goal action",
      options: menuOptions(api, store),
    }) ?? { title: "Goal", options: menuOptions(api, store) }
  );
}

function commandFields() {
  return {
    title: "Goal",
    value: "goal",
    description: "Manage the active goal",
    slash: { name: "goal" },
  };
}

export function registerGoalTuiCommand(api: GoalTuiApi, rawOptions?: unknown): () => void {
  const options = parseOptions(rawOptions);
  const store = new GoalStore(options.statePath);
  let unregisterCommand: (() => void) | undefined;

  if (typeof api.keymap?.registerLayer === "function") {
    unregisterCommand = api.keymap.registerLayer({
      priority: 900,
      commands: [
        {
          namespace: "palette",
          name: "goal.menu",
          desc: "Manage the active goal",
          slashName: "goal",
          ...commandFields(),
          async run() {
            showGoalMenu(api, store);
            return true;
          },
        },
      ],
    });
  } else if (typeof api.command?.register === "function") {
    unregisterCommand = api.command.register(() => [
      {
        ...commandFields(),
        async onSelect() {
          showGoalMenu(api, store);
        },
      },
    ]);
  }

  const dispose = () => {
    unregisterCommand?.();
    unregisterCommand = undefined;
  };
  api.lifecycle?.onDispose?.(dispose);
  return dispose;
}

export async function tui(api: GoalTuiApi, rawOptions?: unknown): Promise<void> {
  registerGoalTuiCommand(api, rawOptions);
}

export default {
  id: "opencode-goal-mode:tui",
  tui,
};
