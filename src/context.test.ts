import { describe, expect, test } from "bun:test";

import {
  renderActiveGoalContext,
  renderCompactionContext,
  renderContinuationPrompt,
} from "./context";
import type { GoalSessionState } from "./types";

const state: GoalSessionState = {
  sessionID: "s1",
  seenUserMessageIDs: [],
  flags: {
    continuationInFlight: false,
    turnHadToolCalls: false,
    autoContinuationSuppressed: false,
    pendingQuestionCount: 0,
    pendingPermissionCount: 0,
    compactionNoticePending: true,
    compactionNoticeSkipNextClear: false,
    ignoredInputTexts: [],
  },
  goal: {
    id: "g1",
    objective: "Build the plugin",
    status: "active",
    createdAt: 1,
    updatedAt: 2,
    supplements: [
      { id: "i1", source: "user", text: "Server-only.", createdAt: 3 },
      { id: "i2", source: "queued-user", text: "Esc must not pause.", createdAt: 4 },
    ],
  },
};

describe("goal context rendering", () => {
  test("renders active goal context with objective, supplements, rules, and compaction notice", () => {
    const rendered = renderActiveGoalContext(state, { includeCompactionNotice: true });

    expect(rendered).toContain("<active_goal_context>");
    expect(rendered).toContain("Build the plugin");
    expect(rendered).toContain("Server-only.");
    expect(rendered).toContain("Esc must not pause.");
    expect(rendered).toContain(
      "Later supplemental instructions override earlier conflicting instructions.",
    );
    expect(rendered).toContain("The previous conversation context may have been compacted.");
  });

  test("renders continuation prompt for unfinished active goals", () => {
    const rendered = renderContinuationPrompt(state);

    expect(rendered).toContain("The active goal has not been completed");
    expect(rendered).toContain('goal({ op: "complete" })');
  });

  test("renders compaction context with preservation instruction and objective", () => {
    const rendered = renderCompactionContext(state);

    expect(rendered).toContain("Preserve this active goal context");
    expect(rendered).toContain("Build the plugin");
  });

  test("returns undefined when the goal is missing or inactive", () => {
    const missingGoalState: GoalSessionState = { ...state, goal: undefined };
    const inactiveGoalState: GoalSessionState = {
      ...state,
      goal: state.goal ? { ...state.goal, status: "paused" } : undefined,
    };

    for (const item of [missingGoalState, inactiveGoalState]) {
      expect(renderActiveGoalContext(item)).toBeUndefined();
      expect(renderContinuationPrompt(item)).toBeUndefined();
      expect(renderCompactionContext(item)).toBeUndefined();
    }
  });

  test("escapes XML special characters in rendered goal fields", () => {
    const xmlState: GoalSessionState = {
      ...state,
      goal: state.goal
        ? {
            ...state.goal,
            objective: "Build <plugin> & \"ship\" 'fast'",
            supplements: [
              {
                id: "i<1>&\"'",
                source: "queued-user<&\"'" as "queued-user",
                text: "Use <server> & \"never\" 'client'",
                createdAt: 3,
              },
            ],
          }
        : undefined,
    };

    const rendered = renderActiveGoalContext(xmlState);

    expect(rendered).toContain("Build &lt;plugin&gt; &amp; &quot;ship&quot; &apos;fast&apos;");
    expect(rendered).toContain('id="i&lt;1&gt;&amp;&quot;&apos;"');
    expect(rendered).toContain('source="queued-user&lt;&amp;&quot;&apos;"');
    expect(rendered).toContain(
      "Use &lt;server&gt; &amp; &quot;never&quot; &apos;client&apos;",
    );
  });
});
