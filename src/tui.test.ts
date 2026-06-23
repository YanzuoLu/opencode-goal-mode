import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import plugin, {
  currentSessionID,
  goalStartPromptText,
  registerGoalTuiCommand,
} from "./tui";
import { GoalRuntimeHooks } from "./runtime";
import { GoalStore } from "./store";

const SESSION_ID = "session-1";

let tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
  tempDirs = [];
});

async function statePath(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "opencode-goal-tui-"));
  tempDirs.push(dir);
  return join(dir, "state.json");
}

function session(overrides: Record<string, unknown> = {}) {
  return {
    id: SESSION_ID,
    agent: "build",
    model: { id: "gpt-5.5", providerID: "openai" },
    ...overrides,
  };
}

function createFakeApi(options: {
  sessionID?: string;
  session?: unknown;
  status?: unknown;
  keymap?: boolean;
  legacyCommand?: boolean;
  dialogComponent?: boolean;
  solidView?: boolean;
} = {}) {
  const promptCalls: any[] = [];
  const toasts: any[] = [];
  const dialogs: any[] = [];
  const layers: any[] = [];
  const legacyRegistrations: Array<() => any[]> = [];
  let unregisterCount = 0;
  const apiSession = "session" in options ? options.session : session();
  const apiStatus = "status" in options ? options.status : { type: "idle" };
  const sessionID = options.sessionID ?? SESSION_ID;
  const clientSession = {
    async promptAsync(this: unknown, args: any) {
      if (this !== clientSession) throw new Error("promptAsync called with wrong this binding");
      promptCalls.push(args);
    },
  };

  const api: any = {
    route: { current: { params: { sessionID } } },
    state: {
      session: {
        get: (id: string) => (id === sessionID ? apiSession : undefined),
        status: (id: string) => (id === sessionID ? apiStatus : undefined),
      },
    },
    client: {
      session: clientSession,
    },
    ui: {
      toast: (input: any) => toasts.push(input),
      dialog: {
        replace: (render: () => unknown, onClose?: () => void) => {
          dialogs.push({ rendered: render(), onClose });
        },
        clear: () => dialogs.push({ cleared: true }),
      },
      DialogSelect: (props: any) => ({ type: "select", props }),
      DialogPrompt: (props: any) => ({ type: "prompt", props }),
      DialogAlert: (props: any) => ({ type: "alert", props }),
    },
    lifecycle: {
      onDispose: (dispose: () => void) => dispose,
    },
    promptCalls,
    toasts,
    dialogs,
    layers,
    legacyRegistrations,
    get unregisterCount() {
      return unregisterCount;
    },
  };

  if (options.solidView !== false) {
    api.solidView = {
      createElement: (type: string) => ({ type, props: {}, children: [] as any[] }),
      setProp: (element: any, key: string, value: unknown) => {
        element.props[key] = value;
      },
      insert: (element: any, child: unknown) => {
        element.children.push(child);
      },
    };
  }

  if (options.dialogComponent) {
    api.ui.Dialog = (props: any) => ({ type: "dialog", props });
  }

  if (options.keymap !== false) {
    api.keymap = {
      registerLayer: (layer: any) => {
        layers.push(layer);
        return () => {
          unregisterCount += 1;
        };
      },
    };
  }

  if (options.legacyCommand) {
    api.command = {
      register: (callback: () => any[]) => {
        legacyRegistrations.push(callback);
        return () => {
          unregisterCount += 1;
        };
      },
    };
  }

  return api;
}

async function setup(options?: Parameters<typeof createFakeApi>[0]) {
  const path = await statePath();
  const api = createFakeApi(options);
  const dispose = registerGoalTuiCommand(api, { statePath: path });
  const store = new GoalStore(path);
  return { api, dispose, store };
}

function registeredCommand(api: any) {
  return api.layers[0].commands[0];
}

function latestDialog(api: any) {
  return api.dialogs.at(-1)?.rendered;
}

function adapterOption(option: any) {
  return {
    title: option.title,
    value: option.value,
    description: option.description,
    footer: option.footer,
    category: option.category,
    disabled: option.disabled,
  };
}

async function openGoalMenu(api: any) {
  const result = await registeredCommand(api).run();
  expect(result).toBe(true);
  return latestDialog(api);
}

async function selectGoalAction(api: any, value: string) {
  const menu = await openGoalMenu(api);
  expect(menu.type).toBe("select");
  const option = menu.props.options.find((item: any) => item.value === value);
  expect(option).toBeDefined();
  expect(option.onSelect).toBeUndefined();
  expect(typeof menu.props.onSelect).toBe("function");
  await menu.props.onSelect(adapterOption(option));
  return latestDialog(api);
}

function promptPart(api: any) {
  return api.promptCalls[0].parts[0];
}

function promptText(api: any): string {
  return promptPart(api).text;
}

function expectKickoffPromptCall(api: any) {
  const call = api.promptCalls[0];
  expect(call.sessionID).toBe(SESSION_ID);
  expect(call.path).toBeUndefined();
  expect(call.body).toBeUndefined();
  expect(call.parts).toHaveLength(1);
  // Kickoff is synthetic: it drives the model turn but textFromParts filters it so
  // it is never captured as a supplement.
  expect(promptPart(api)).toEqual({ type: "text", text: promptText(api), synthetic: true });
  expect("ignored" in promptPart(api)).toBe(false);
  expect(promptText(api)).not.toContain("<active_goal_context>");
  return call;
}

describe("goal TUI command", () => {
  test("exports TUI plugin metadata", () => {
    expect(plugin.id).toBe("opencode-goal-mode:tui");
    expect(typeof plugin.tui).toBe("function");
  });

  test("reads the current session ID from route params", () => {
    expect(currentSessionID({ route: { current: { params: { sessionID: SESSION_ID } } } })).toBe(
      SESSION_ID,
    );
    expect(currentSessionID({ route: { current: { params: { sessionID: 1 } } } })).toBeUndefined();
    expect(currentSessionID({})).toBeUndefined();
  });

  test("builds an XML-free goal start prompt text", () => {
    const text = goalStartPromptText("replace");

    expect(text).not.toContain("<active_goal_context>");
    expect(text).toContain("Begin working toward the replacement active goal.");
    expect(text).toContain('goal({ op: "complete" })');
  });

  test("registers /goal-menu as an action-only slash command through keymap layers", async () => {
    const { api, dispose } = await setup({ legacyCommand: true });

    expect(api.layers).toHaveLength(1);
    expect(api.legacyRegistrations).toHaveLength(0);
    expect(api.layers[0].priority).toBe(900);
    expect(registeredCommand(api)).toMatchObject({
      namespace: "palette",
      name: "goal.menu",
      slashName: "goal-menu",
      title: "Goal",
      value: "goal-menu",
      slash: { name: "goal-menu" },
    });
    expect(typeof registeredCommand(api).run).toBe("function");
    expect(registeredCommand(api).input).toBeUndefined();

    dispose();

    expect(api.unregisterCount).toBe(1);
  });

  test("falls back to legacy command registration when keymap layers are unavailable", async () => {
    const path = await statePath();
    const api = createFakeApi({ keymap: false, legacyCommand: true });

    registerGoalTuiCommand(api, { statePath: path });

    expect(api.legacyRegistrations).toHaveLength(1);
    const command = api.legacyRegistrations[0]()[0];
    expect(command).toMatchObject({ title: "Goal", value: "goal-menu", slash: { name: "goal-menu" } });
    expect(typeof command.onSelect).toBe("function");
  });

  test("show echoes the snapshot into the transcript as an ignored, no-reply message", async () => {
    const { api, store } = await setup();
    await store.createGoal(SESSION_ID, "Ship the TUI command");

    await selectGoalAction(api, "show");

    // Instead of a dialog, the snapshot is echoed into the transcript: an ignored
    // part (shown in the transcript but excluded from the model context) sent with
    // noReply (no model turn).
    expect(api.promptCalls).toHaveLength(1);
    const call = api.promptCalls[0];
    expect(call.sessionID).toBe(SESSION_ID);
    expect(call.noReply).toBe(true);
    expect(call.parts).toHaveLength(1);
    const part = call.parts[0];
    expect(part).toMatchObject({ type: "text", ignored: true });
    expect(part.synthetic).toBeUndefined();
    expect(part.text).toContain("Read-only snapshot");
    expect(part.text).toContain("<active_goal_context>");
    expect(part.text).toContain("Ship the TUI command");
    // The menu is closed when the snapshot is echoed.
    expect(api.dialogs).toContainEqual({ cleared: true });
  });

  test("show with no active goal echoes a UI-only no-goal notice", async () => {
    const { api } = await setup();

    await selectGoalAction(api, "show");

    expect(api.promptCalls).toHaveLength(1);
    const call = api.promptCalls[0];
    expect(call.noReply).toBe(true);
    expect(call.parts[0]).toMatchObject({ type: "text", ignored: true });
    expect(call.parts[0].text).toContain("No active goal");
    expect(api.toasts).toHaveLength(0);
  });

  test("DialogSelect top-level onSelect dispatches selected goal action", async () => {
    const { api, store } = await setup();
    await store.createGoal(SESSION_ID, "Pause through DialogSelect onSelect");

    const menu = await openGoalMenu(api);
    expect(menu.type).toBe("select");
    const option = menu.props.options.find((item: any) => item.value === "pause");
    expect(option).toBeDefined();
    expect(typeof menu.props.onSelect).toBe("function");

    await menu.props.onSelect(adapterOption(option));

    expect((await store.getSession(SESSION_ID)).goal?.status).toBe("paused");
    expect(api.toasts).toHaveLength(1);
    expect(api.toasts[0]).toMatchObject({ message: "Goal paused" });
    expect(api.promptCalls).toHaveLength(0);
  });

  test("DialogSelect selection clears the menu before dispatching", async () => {
    const { api, store } = await setup();
    await store.createGoal(SESSION_ID, "Close the menu on select");

    const menu = await openGoalMenu(api);
    const option = menu.props.options.find((item: any) => item.value === "pause");
    expect(option).toBeDefined();

    await menu.props.onSelect(adapterOption(option));

    expect(api.dialogs).toContainEqual({ cleared: true });
    expect((await store.getSession(SESSION_ID)).goal?.status).toBe("paused");
  });

  test("fallback select view dispatches selected goal action", async () => {
    const { api, store } = await setup();
    await store.createGoal(SESSION_ID, "Fallback select path");
    delete api.ui.DialogSelect;

    const menu = await openGoalMenu(api);
    const option = menu.options.find((item: any) => item.value === "pause");
    expect(option).toBeDefined();
    expect(typeof menu.onSelect).toBe("function");

    await menu.onSelect(adapterOption(option));

    expect((await store.getSession(SESSION_ID)).goal?.status).toBe("paused");
    expect(api.toasts[0]).toMatchObject({ message: "Goal paused" });
  });

  test("pause changes status to paused, emits a toast, and does not prompt", async () => {
    const { api, store } = await setup();
    await store.createGoal(SESSION_ID, "Pause this goal");

    await selectGoalAction(api, "pause");

    expect((await store.getSession(SESSION_ID)).goal?.status).toBe("paused");
    expect(api.toasts).toHaveLength(1);
    expect(api.toasts[0]).toMatchObject({ message: "Goal paused" });
    expect(api.promptCalls).toHaveLength(0);
  });

  test("drop changes status to dropped, suppresses continuation, emits a toast, and does not prompt", async () => {
    const { api, store } = await setup();
    await store.createGoal(SESSION_ID, "Drop this goal");
    await store.setFlags(SESSION_ID, {
      continuationInFlight: true,
      autoContinuationSuppressed: false,
    });

    await selectGoalAction(api, "drop");

    const state = await store.getSession(SESSION_ID);
    expect(state.goal?.status).toBe("dropped");
    expect(state.flags.continuationInFlight).toBe(false);
    expect(state.flags.autoContinuationSuppressed).toBe(true);
    expect(api.toasts).toHaveLength(1);
    expect(api.toasts[0]).toMatchObject({ message: "Goal dropped" });
    expect(api.promptCalls).toHaveLength(0);
  });

  test("drop changes a paused goal to dropped without prompting", async () => {
    const { api, store } = await setup();
    await store.createGoal(SESSION_ID, "Drop this paused goal");
    await store.updateGoal(SESSION_ID, (goal) => ({ ...goal, status: "paused" }));
    await store.setFlags(SESSION_ID, {
      continuationInFlight: true,
      autoContinuationSuppressed: false,
    });

    await selectGoalAction(api, "drop");

    const state = await store.getSession(SESSION_ID);
    expect(state.goal?.status).toBe("dropped");
    expect(state.flags.continuationInFlight).toBe(false);
    expect(state.flags.autoContinuationSuppressed).toBe(true);
    expect(api.toasts).toHaveLength(1);
    expect(api.toasts[0]).toMatchObject({ message: "Goal dropped" });
    expect(api.promptCalls).toHaveLength(0);
  });

  test("set writes active goal state, emits a toast, and prompts with active goal context", async () => {
    const { api, store } = await setup({
      session: session({ model: { id: "gpt-5.5", providerID: "openai", variant: "reasoning" } }),
    });

    const dialog = await selectGoalAction(api, "set");
    expect(dialog.type).toBe("prompt");
    await dialog.props.onConfirm("Ship the set command");

    const state = await store.getSession(SESSION_ID);
    expect(state.goal).toMatchObject({ objective: "Ship the set command", status: "active" });
    expect(api.toasts.at(-1)).toMatchObject({ message: "Goal set" });
    expect(api.promptCalls).toHaveLength(1);
    const call = expectKickoffPromptCall(api);
    expect(call.model).toEqual({ modelID: "gpt-5.5", providerID: "openai" });
    expect(call.agent).toBe("build");
    expect(call.variant).toBe("reasoning");
    expect(promptText(api)).toContain("Begin working toward the active goal");
  });

  test("set kickoff drives the model turn but is not captured as a supplement", async () => {
    const { api, store } = await setup();
    const runtime = new GoalRuntimeHooks(store, { session: { promptAsync: async () => undefined } } as any);

    const dialog = await selectGoalAction(api, "set");
    await dialog.props.onConfirm("Do not self-capture");

    expectKickoffPromptCall(api);
    await runtime.onChatMessage(
      { sessionID: SESSION_ID, messageID: "kickoff-message" },
      { parts: api.promptCalls[0].parts } as any,
    );

    const state = await store.getSession(SESSION_ID);
    expect(state.goal?.supplements).toHaveLength(0);
  });

  test("replace writes active goal state, emits a toast, and prompts with active goal context", async () => {
    const { api, store } = await setup();
    await store.createGoal(SESSION_ID, "Old objective");

    const dialog = await selectGoalAction(api, "replace");
    await dialog.props.onConfirm("Ship the replacement command");

    const state = await store.getSession(SESSION_ID);
    expect(state.goal).toMatchObject({
      objective: "Ship the replacement command",
      status: "active",
    });
    expect(api.toasts.at(-1)).toMatchObject({ message: "Goal replaced" });
    expect(api.promptCalls).toHaveLength(1);
    expectKickoffPromptCall(api);
    expect(promptText(api)).toContain("Begin working toward the replacement active goal");
  });

  test("resume changes paused suppressed goal to active, clears suppression, and prompts", async () => {
    const { api, store } = await setup();
    await store.createGoal(SESSION_ID, "Resume this goal");
    await store.updateGoal(SESSION_ID, (goal) => ({ ...goal, status: "paused" }));
    await store.setFlags(SESSION_ID, { autoContinuationSuppressed: true });

    await selectGoalAction(api, "resume");

    const state = await store.getSession(SESSION_ID);
    expect(state.goal).toMatchObject({ objective: "Resume this goal", status: "active" });
    expect(state.flags.autoContinuationSuppressed).toBe(false);
    expect(api.toasts).toHaveLength(1);
    expect(api.toasts[0]).toMatchObject({ message: "Goal resumed" });
    expect(api.promptCalls).toHaveLength(1);
    expectKickoffPromptCall(api);
    expect(promptText(api)).toContain("Resume working toward the active goal");
  });

  test("resume clears suppression and prompts for an already active goal", async () => {
    const { api, store } = await setup();
    await store.createGoal(SESSION_ID, "Continue this active goal");
    await store.setFlags(SESSION_ID, { autoContinuationSuppressed: true });

    await selectGoalAction(api, "resume");

    const state = await store.getSession(SESSION_ID);
    expect(state.goal).toMatchObject({ objective: "Continue this active goal", status: "active" });
    expect(state.flags.autoContinuationSuppressed).toBe(false);
    expect(api.toasts).toHaveLength(1);
    expect(api.toasts[0]).toMatchObject({ message: "Goal resumed" });
    expect(api.promptCalls).toHaveLength(1);
    expectKickoffPromptCall(api);
    expect(promptText(api)).toContain("Resume working toward the active goal");
  });

  test("set refuses missing model data before mutating state", async () => {
    const { api, store } = await setup({ session: session({ model: undefined }) });

    const dialog = await selectGoalAction(api, "set");
    await dialog.props.onConfirm("Do not store this");

    expect((await store.getSession(SESSION_ID)).goal).toBeUndefined();
    expect(api.toasts.at(-1)).toMatchObject({ variant: "error" });
    expect(api.promptCalls).toHaveLength(0);
  });

  test("set refuses busy sessions before mutating state", async () => {
    const { api, store } = await setup({ status: { type: "busy" } });

    const dialog = await selectGoalAction(api, "set");
    await dialog.props.onConfirm("Do not store this");

    expect((await store.getSession(SESSION_ID)).goal).toBeUndefined();
    expect(api.toasts.at(-1)).toMatchObject({ variant: "info" });
    expect(api.promptCalls).toHaveLength(0);
  });
});
