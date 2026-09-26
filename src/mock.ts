import type { RootModel } from "./harness.js";
import type { Transport } from "./jev.js";

/** Intentionally trivial and deterministic. Only exercises the plumbing. */
export const mockJev: Transport = async body => {
  const questions = body.questions as Record<string, { type?: string; instructions?: { source_block?: { text?: string }; question_text?: string } }>;
  if (questions.relevant || questions.cache_before_revoke) {
    const material = JSON.stringify(body.state);
    const answers: Record<string, unknown> = {};
    for (const [id, question] of Object.entries(questions)) {
      if (question.type === "choice") {
        const options = Object.keys((question as { criteria?: Record<string, unknown> }).criteria ?? {});
        const hit = options.find(option => option !== "none") ?? options[0];
        answers[id] = { type: "choice", choice: hit, probabilities: Object.fromEntries(options.map(option => [option, option === hit ? 0.8 : 0.2 / Math.max(1, options.length - 1)])), confidence: 0.7 };
      } else if (question.type === "score") {
        answers[id] = { type: "score", score: 1, probabilities: { "0": 0.1, "1": 0.8, "2": 0.1 }, confidence: 0.7 };
      } else {
        answers[id] = { type: "noul", noul: /logout|session|cache|allow/i.test(material) ? 0.9 : 0.05 };
      }
    }
    return { model: "MOCK-keyword-rule", answers };
  }
  if (questions.where?.type === "choice") {
    const text = String((body.state as { numbered_lines?: string }).numbered_lines ?? "");
    const ids = [...text.matchAll(/^(L\d+)\|/gm)].map(match => match[1]!);
    const hit = ids.find(id => /logout|allowCache|revoked|session/i.test(text.slice(text.indexOf(id)))) ?? ids[0];
    return {
      model: "MOCK-keyword-rule",
      answers: {
        where: { type: "choice", choice: hit, probabilities: Object.fromEntries(ids.map(id => [id, id === hit ? 0.9 : 0.1 / Math.max(1, ids.length - 1)])), confidence: 0.8 },
        present: { type: "noul", noul: /logout|session|cache/i.test(text) ? 0.9 : 0.05 },
      },
    };
  }
  return {
    model: "MOCK-keyword-rule",
    answers: Object.fromEntries(Object.entries(questions).map(([id, question]) => {
      const source = question.instructions?.source_block?.text ?? "";
      return [id, { type: "noul", noul: /session|cache|revoke/i.test(source) ? 0.9 : 0.05 }];
    })),
  };
};

export function scriptedRoot(): RootModel {
  const actions = [
    { action: "code", code: 'state.decls = await repo.symbols("."); state.screen = await jev.ask(state.decls.map(d => ({ path: d.path, line: d.start, name: d.label })), { relevant: { type: "noul", instructions: "Does any declaration help explain a session remaining valid after logout?" } }); print(state.screen.answers);' },
    { action: "code", code: 'state.view = await repo.window("auth.ts", 1, 20); state.judge = await jev.ask(state.view.lines, { start: { type: "choice", instructions: "Which line is the best start?", criteria: { ...Object.fromEntries(state.view.lines.map(l => [l.id, null])), none: "No line helps." } }, cache_before_revoke: { type: "noul", instructions: "Does a cache check return before revocation?" } }); print(state.judge.answers);' },
    { action: "code", code: 'print(await repo.lines(state.view.lines.filter(l => l.id === state.judge.answers.start.choice), 1));' },
    { action: "final", answer: "MOCK DEMO: scripted actions completed. Selected originals were read. This is a plumbing demonstration, not a model-generated diagnosis or evidence of retrieval quality." },
  ];
  let step = 0;
  return { complete: async () => ({ text: JSON.stringify(actions[step++] ?? actions.at(-1)), usage: { mock: true } }) };
}
