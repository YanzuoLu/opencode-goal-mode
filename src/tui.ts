import { goalStartPromptText, renderActiveGoalContext } from "./context";
import type { GoalStartAction } from "./context";
import { parseOptions } from "./plugin-options";
import { GoalStore } from "./store";
import type { GoalSessionState } from "./types";
export { goalStartPromptText } from "./context";

const GOAL_MENU_SLASH = "goal-menu";

type GoalMenuAction = GoalStartAction | "show" | "pause" | "drop";

type SolidView = {
  createElement: (type: string) => any;
  insert: (element: any, child: unknown) => void;
  setProp: (element: any, key: string, value: unknown) => void;
};

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
    Dialog?: (props: any) => unknown;
    DialogSelect?: (props: any) => unknown;
    DialogPrompt?: (props: any) => unknown;
    DialogAlert?: (props: any) => unknown;
  };
  solidView?: SolidView;
  theme?: { current?: Record<string, unknown> } | Record<string, unknown>;
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

async function importModule(specifier: string): Promise<any> {
  return import(specifier);
}

let defaultSolidView: SolidView | undefined;

async function loadSolidView(): Promise<SolidView> {
  if (defaultSolidView) return defaultSolidView;
  let solid: any;
  if (typeof Bun !== "undefined") {
    await importModule("@opentui/solid/runtime-plugin-support");
    solid = await importModule("opentui:runtime-module:%40opentui%2Fsolid");
  } else {
    solid = await importModule("@opentui/solid");
  }
  const { createElement, insert, setProp } = solid;
  defaultSolidView = { createElement, insert, setProp };
  return defaultSolidView;
}

function elementNode(type: string, props: Record<string, unknown>, children: unknown[], view: SolidView): unknown {
  const element = view.createElement(type);
  for (const [key, value] of Object.entries(props)) {
    if (value !== undefined) view.setProp(element, key, value);
  }
  for (const child of children) {
    if (child !== null && child !== undefined && child !== false) view.insert(element, child);
  }
  return element;
}

function textNode(value: string, props: Record<string, unknown>, view: SolidView): unknown {
  return elementNode("text", props, [value], view);
}

function themeFor(api: GoalTuiApi): Record<string, unknown> {
  const theme = (api.theme && "current" in api.theme ? api.theme.current : api.theme) as
    | Record<string, unknown>
    | undefined;
  return theme ?? {};
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

function goalDetailView(api: GoalTuiApi, context: string, view?: SolidView): unknown {
  if (api.ui?.Dialog && view) {
    const theme = themeFor(api);
    const content = elementNode(
      "box",
      { flexDirection: "column", paddingX: 1, paddingY: 1 },
      [
        textNode("Active goal", { fg: theme.text, bold: true }, view),
        textNode(context, { fg: theme.textMuted ?? theme.text, wrap: "wrap" }, view),
      ],
      view,
    );
    return api.ui.Dialog({
      size: "xlarge",
      onClose: () => api.ui?.dialog?.clear?.(),
      children: content,
    });
  }

  return {
    type: "goal-detail",
    props: {
      title: "Active goal",
      context,
      onClose: () => api.ui?.dialog?.clear?.(),
    },
  };
}

async function showGoal(api: GoalTuiApi, store: GoalStore): Promise<void> {
  const sessionID = currentSessionID(api);
  if (!sessionID) {
    toast(api, "error", "No active session");
    return;
  }

  const context = renderActiveGoalContext(await store.getSession(sessionID)) ?? "No active goal";

  const view = api.solidView ?? (api.ui?.Dialog ? await loadSolidView() : undefined);
  api.ui?.dialog?.replace?.(() => goalDetailView(api, context, view));
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
    value: GOAL_MENU_SLASH,
    description: "Manage the active goal",
    slash: { name: GOAL_MENU_SLASH },
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
          slashName: GOAL_MENU_SLASH,
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
