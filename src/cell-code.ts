import ts from "typescript";

/** Notebook semantics: top-level let/const may be rerun; nested lexical scopes are untouched. */
export function prepareCell(code: string): string {
  const tree = ts.createSourceFile("cell.js", code, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const edits: Array<{ start: number; length: number }> = [];
  for (const statement of tree.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    const declarations = statement.declarationList;
    const start = declarations.getStart(tree);
    const keyword = code.slice(start).match(/^(?:const|let)\b/)?.[0];
    if (keyword) edits.push({ start, length: keyword.length });
  }
  for (const { start, length } of edits.reverse()) code = code.slice(0, start) + "var" + code.slice(start + length);
  return code;
}
