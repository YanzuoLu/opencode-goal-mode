import type { OpencodeClient } from "@opencode-ai/sdk";

import {
  GOAL_START_SUFFIX,
  renderActiveGoalContext,
  renderCompactionContext,
  renderContinuationPrompt,
  stripGoalContextBlocks,
} from "./context";
import type { GoalRuntimeFlagPatch, GoalStore } from "./store";

function textFromParts(
  parts: Array<{ type?: string; text?: string; synthetic?: boolean; ignored?: boolean }>,
): string | undefined {
  const texts = parts
    .filter(
      (part) =>
        part.type === "text" &&
        !part.synthetic &&
        !part.ignored &&
        typeof part.text === "string",
    )
    .map((part) => part.text?.trim())
    .filter((text): text is string => Boolean(text));

  return texts.length ? texts.join("\n\n") : undefined;
}

export class GoalRuntimeHooks {
  constructor(
    private readonly store: GoalStore,
    private readonly client: { session: Pick<OpencodeClient["session"], "promptAsync"> },
    private readonly options: {
      maxContextBytes: number;
      autoContinue: boolean;
      suppressQuestions?: boolean;
    } = {
      maxContextBytes: 60000,
      autoContinue: true,
    },
  ) {}

  // Goal mode runs unattended, so the interactive "question" tool (which halts the
  // turn until the user answers) defeats the purpose — the goal stalls waiting for
  // input. While a goal is active we abort the question tool before it executes;
  // opencode surfaces the thrown message as the tool result, so the model reads it
  // and proceeds autonomously instead of blocking. Disable with suppressQuestions:false.
  async onToolExecuteBefore(
    input: { tool: string; sessionID: string; callID: string },
    _output: { args: unknown },
  ): Promise<void> {
    if (this.options.suppressQuestions === false) return;
    if (input.tool !== "question") return;

    const state = await this.store.getSession(input.sessionID);
    if (!state.goal || state.goal.status !== "active") return;

    throw new Error(
      "Autonomous goal mode is active: the question tool is disabled. Do not ask the " +
        "user. Make a reasonable assumption, state it briefly, and keep working toward " +
        "the goal using the available tools.",
    );
  }

  async onEvent(input: { event: { type: string; properties?: Record<string, any> } }): Promise<void> {
    const event = input.event;
    const sessionID = event.properties?.sessionID;
    if (!sessionID) return;

    if (event.type === "session.next.interrupt.requested") {
      await this.setFlagsIfSessionExists(sessionID, {
        autoContinuationSuppressed: true,
        continuationInFlight: false,
      });
      return;
    }

    if (event.type === "session.next.step.started") {
      await this.setFlagsIfSessionExists(sessionID, { turnHadToolCalls: false });
      return;
    }

    if (event.type === "session.next.tool.called") {
      await this.setFlagsIfSessionExists(sessionID, { turnHadToolCalls: true });
      return;
    }

    if (event.type === "question.asked" || event.type === "question.v2.asked") {
      const state = await this.store.getSession(sessionID);
      await this.setFlagsIfSessionExists(sessionID, {
        pendingQuestionCount: state.flags.pendingQuestionCount + 1,
      });
      return;
    }

    if (
      event.type === "question.replied" ||
      event.type === "question.rejected" ||
      event.type === "question.v2.replied" ||
      event.type === "question.v2.rejected"
    ) {
      const state = await this.store.getSession(sessionID);
      await this.setFlagsIfSessionExists(sessionID, {
        pendingQuestionCount: Math.max(0, state.flags.pendingQuestionCount - 1),
      });
      return;
    }

    if (event.type === "permission.asked" || event.type === "permission.v2.asked") {
      const state = await this.store.getSession(sessionID);
      await this.setFlagsIfSessionExists(sessionID, {
        pendingPermissionCount: state.flags.pendingPermissionCount + 1,
      });
      return;
    }

    if (event.type === "permission.replied" || event.type === "permission.v2.replied") {
      const state = await this.store.getSession(sessionID);
      await this.setFlagsIfSessionExists(sessionID, {
        pendingPermissionCount: Math.max(0, state.flags.pendingPermissionCount - 1),
      });
      return;
    }

    if (event.type === "session.next.compaction.ended") {
      await this.markCompactionNoticePending(sessionID);
      return;
    }

    if (event.type === "session.next.step.ended") {
      await this.settleInFlightContinuation(sessionID);
      return;
    }

    if (event.type === "session.idle") {
      await this.settleInFlightContinuation(sessionID);
      await this.maybeAutoContinue(sessionID);
    }
  }

  private async settleInFlightContinuation(sessionID: string): Promise<void> {
    const state = await this.store.getSession(sessionID);
    if (!state.flags.continuationInFlight) return;

    await this.setFlagsIfSessionExists(sessionID, {
      continuationInFlight: false,
      autoContinuationSuppressed: !state.flags.turnHadToolCalls,
    });
  }

  async maybeAutoContinue(sessionID: string): Promise<void> {
    const state = await this.store.getSession(sessionID);
    if (!this.options.autoContinue) return;
    if (!state.goal || state.goal.status !== "active") return;
    if (state.flags.autoContinuationSuppressed) return;
    if (state.flags.continuationInFlight) return;
    if (state.flags.pendingQuestionCount > 0 || state.flags.pendingPermissionCount > 0) return;

    const context = renderActiveGoalContext(state);
    if (context && Buffer.byteLength(context, "utf8") > this.options.maxContextBytes) {
      await this.store.setFlags(sessionID, { autoContinuationSuppressed: true });
      return;
    }

    const text = renderContinuationPrompt(state);
    if (!text) return;

    await this.setFlagsIfSessionExists(sessionID, {
      continuationInFlight: true,
      turnHadToolCalls: false,
    });
    await this.client.session.promptAsync({
      path: { id: sessionID },
      body: { parts: [{ type: "text", text, synthetic: true }] },
    });
  }

  async onChatMessage(
    input: { sessionID: string; messageID?: string },
    output: { parts: any[] },
  ): Promise<void> {
    const raw = textFromParts(output.parts);
    if (!raw) return;

    const state = await this.store.getSession(input.sessionID);
    if (!state.goal || state.goal.status !== "active") return;

    // Goal kickoffs (set/replace/resume) always carry this suffix. opencode may
    // merge them with the command template + raw arguments before chat.message
    // sees them, so match by a stable sentinel substring rather than the brittle
    // full-string equality the old ignoredInputTexts used. Never capture a kickoff
    // as a supplement — that mismatch is what produced the nesting bug.
    if (raw.includes(GOAL_START_SUFFIX)) return;

    // Defense-in-depth: strip any rendered context block before storing.
    const text = stripGoalContextBlocks(raw);
    if (!text) return;

    await this.store.appendSupplement(input.sessionID, {
      messageID: input.messageID,
      source: "user",
      text,
    });
  }

  async onSystemTransform(
    input: { sessionID?: string },
    output: { system: string[] },
  ): Promise<void> {
    if (!input.sessionID) return;

    const state = await this.store.getSession(input.sessionID);
    const rendered = renderActiveGoalContext(state, {
      includeCompactionNotice: state.flags.compactionNoticePending,
    });
    if (!rendered) return;

    output.system.push(rendered);

    if (state.flags.compactionNoticePending) {
      await this.store.setFlags(input.sessionID, state.flags.compactionNoticeSkipNextClear
        ? { compactionNoticeSkipNextClear: false }
        : { compactionNoticePending: false, compactionNoticeSkipNextClear: false });
    }
  }

  async onCompacting(input: { sessionID: string }, output: { context: string[] }): Promise<void> {
    const state = await this.store.getSession(input.sessionID);
    const rendered = renderCompactionContext(state);
    if (rendered) {
      output.context.push(rendered);
      await this.markCompactionNoticePending(input.sessionID, { skipNextClear: true });
    }
  }

  async onCompactionAutocontinue(input: { sessionID: string }, output: { enabled: boolean }): Promise<void> {
    await this.markCompactionNoticePending(input.sessionID);
  }

  private async markCompactionNoticePending(
    sessionID: string,
    options: { skipNextClear?: boolean } = {},
  ): Promise<void> {
    const state = await this.store.getSession(sessionID);
    if (state.goal?.status === "active") {
      await this.setFlagsIfSessionExists(sessionID, {
        compactionNoticePending: true,
        compactionNoticeSkipNextClear: options.skipNextClear ?? false,
      });
    }
  }

  private async setFlagsIfSessionExists(
    sessionID: string,
    patch: GoalRuntimeFlagPatch,
  ): Promise<void> {
    try {
      await this.store.setFlags(sessionID, patch);
    } catch (error) {
      if (!(error instanceof Error) || error.message !== `No goal for session ${sessionID}`) {
        throw error;
      }
    }
  }
}
