import ts from "typescript";
import { createHash } from "node:crypto";
import { lstat, readdir, readFile, realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep, extname } from "node:path";
import { integer, text, type Ref, type SourceBlock, type Span } from "./types.js";

const excluded = new Set(["node_modules", ".git", "dist", "build", "coverage", "runs", ".venv", "vendor"]);
const extensions = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".py", ".go", ".rs", ".java", ".c", ".h", ".cpp", ".md", ".txt", ".json", ".jsonl", ".yaml", ".yml", ".toml", ".sql", ".sh"]);
const hash = (value: Buffer | string) => createHash("sha256").update(value).digest("hex");
const symbolPattern = /^(?:export\s+)?(?:async\s+)?(?:function\s+(\w+)|class\s+(\w+)|(?:const|let|var)\s+(\w+)\s*=)|^(?:export\s+)?(?:interface|type|enum)\s+(\w+)/;
export function symbolLabel(line: string): string | null {
  const match = line.trim().match(symbolPattern);
  return match?.slice(1).find(Boolean) ?? null;
}
const linesOf = (value: string): string[] => value.match(/[^\n]*\n|[^\n]+$/g) ?? [];
interface Snapshot { path: string; sha256: string; lines: string[]; refs: Ref[] }

/** Source stays here; the code environment initially receives metadata only. */
export class Corpus {
  private snapshots = new Map<string, Snapshot>();
  private refs = new Map<string, { ref: Ref; snapshot: Snapshot }>();
  private snapshotBytes = 0;
  readonly metrics = { readCalls: 0, searchCalls: 0, sourceCharsReturned: 0, windowCalls: 0, symbolCalls: 0 };
  private constructor(readonly root: string) {}
  static async open(root: string): Promise<Corpus> {
    const path = await realpath(root);
    if (!(await lstat(path)).isDirectory()) throw new Error("Repository root must be a directory");
    return new Corpus(path);
  }
  private async safePath(path: string): Promise<string> {
    text(path, "path");
    if (isAbsolute(path)) throw new Error("Use a path relative to the repository root");
    const target = resolve(this.root, path);
    const rel = relative(this.root, target);
    if (rel.startsWith(`..${sep}`) || rel === ".." || isAbsolute(rel)) throw new Error("Path is outside the repository");
    const parts = rel.split(sep).filter(Boolean);
    if (parts.some(p => p.startsWith(".") || excluded.has(p)) || /(?:secret|credential|private[-_]?key)/i.test(parts.at(-1) ?? ""))
      throw new Error("Path is excluded from the source corpus");
    let current = this.root;
    for (const part of parts) {
      current = resolve(current, part);
      if ((await lstat(current)).isSymbolicLink()) throw new Error("Symlinks are excluded");
    }
    if (await realpath(target) !== target) throw new Error("Resolved path changed");
    return target;
  }
  async files(path = "."): Promise<string[]> {
    const target = await this.safePath(path);
    const result: string[] = [];
    let visited = 0;
    const walk = async (dir: string): Promise<void> => {
      const entries = (await readdir(dir, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name));
      for (const entry of entries) {
        if (++visited > 20000) throw new Error("Directory scan limit reached; narrow the path");
        if (entry.name.startsWith(".") || excluded.has(entry.name) || entry.isSymbolicLink() || /(?:secret|credential|private[-_]?key)/i.test(entry.name)) continue;
        const full = resolve(dir, entry.name);
        if (entry.isDirectory()) await walk(full);
        else if (entry.isFile() && extensions.has(extname(entry.name))) result.push(relative(this.root, full));
        if (result.length > 1000) throw new Error("More than 1000 source files; narrow the path");
      }
    };
    if ((await lstat(target)).isDirectory()) await walk(target);
    else if (extensions.has(extname(target))) result.push(relative(this.root, target));
    else throw new Error("Unsupported source file extension");
    return result;
  }
  private async snapshot(path: string): Promise<Snapshot> {
    const full = await this.safePath(path);
    const stat = await lstat(full);
    if (!stat.isFile() || stat.size > 1_000_000) throw new Error("Source must be a regular file of at most 1 MB");
    const raw = await readFile(full);
    const digest = hash(raw);
    const cached = this.snapshots.get(path);
    if (cached?.sha256 === digest) return cached;
    if (this.snapshotBytes + raw.length > 5_000_000) throw new Error("Session snapshot limit: 5 MB; narrow the corpus or start a new session");
    const value = new TextDecoder("utf-8", { fatal: true }).decode(raw);
    if (value.includes("\0")) throw new Error("Binary files are unsupported");
    const lines = linesOf(value);
    const snapshot: Snapshot = { path, sha256: digest, lines, refs: [] };
    let start = 0, chars = 0;
    const add = (end: number) => {
      const ref: Ref = { id: hash(`${path}:${digest}:${start}:${end}`).slice(0, 24), path, sha256: digest, start: start + 1, end, chars };
      snapshot.refs.push(ref);
      this.refs.set(ref.id, { ref, snapshot });
    };
    for (let i = 0; i < lines.length; i++) {
      const length = lines[i]!.length;
      if (length > 6000) throw new Error(`Line ${i + 1} exceeds the 6000 character chunk limit`);
      if (i > start && (i - start >= 60 || chars + length > 6000)) { add(i); start = i; chars = 0; }
      chars += length;
    }
    if (start < lines.length) add(lines.length);
    this.snapshotBytes += raw.length;
    this.snapshots.set(path, snapshot);
    return snapshot;
  }
  async blocks(path = "."): Promise<Ref[]> {
    const refs: Ref[] = [];
    for (const file of await this.files(path)) {
      refs.push(...(await this.snapshot(file)).refs);
      if (refs.length > 512) throw new Error("More than 512 blocks; narrow the path");
    }
    return structuredClone(refs);
  }
  async source(id: string): Promise<SourceBlock> {
    text(id, "block id");
    const entry = this.refs.get(id);
    if (!entry) throw new Error("Unknown block id; call repo.blocks first");
    const current = await this.snapshot(entry.ref.path);
    if (current.sha256 !== entry.ref.sha256) throw new Error("Source changed; obtain new block references");
    return { ...entry.ref, text: entry.snapshot.lines.slice(entry.ref.start - 1, entry.ref.end).join("") };
  }
  /** Read original text for spans the caller already holds. Does not trust span text. */
  /** Numbered lines for a window. Stays in the code environment until printed. */
  async window(path: string, start: number, end: number): Promise<{ path: string; start: number; lines: Span[] }> {
    text(path, "path", 500);
    integer(start, "window start", 1, 1_000_000);
    integer(end, "window end", start, start + 399);
    const snapshot = await this.snapshot(path);
    const from = start;
    const to = Math.min(snapshot.lines.length, end);
    const lines = snapshot.lines.slice(from - 1, to).map((line, index) => ({
      id: `${path}:${from + index}`, path, sha256: snapshot.sha256, start: from + index, end: from + index, text: line.replace(/\r?\n$/, ""),
    }));
    if (from > snapshot.lines.length) throw new Error("Window starts beyond end of file");
    this.metrics.windowCalls++;
    this.metrics.sourceCharsReturned += lines.reduce((n, l) => n + l.text.length, 0);
    return { path, start: from, lines };
  }
  async lines(spans: Span[], padding = 0): Promise<SourceBlock[]> {
    integer(padding, "padding", 0, 8);
    if (!Array.isArray(spans) || spans.length < 1 || spans.length > 12) throw new Error("lines accepts 1 to 12 spans");
    const result: SourceBlock[] = [];
    for (const span of spans) {
      const path = text(span?.path, "span path", 500);
      const start = integer(span?.start, "span start", 1, 1_000_000);
      const end = integer(span?.end, "span end", start, 1_000_000);
      const snapshot = await this.snapshot(path);
      if (!span.sha256 || span.sha256 !== snapshot.sha256) throw new Error("Span is missing its version or source changed; obtain new references");
      if (end > snapshot.lines.length) throw new Error("Span ends beyond end of file");
      const from = Math.max(1, start - padding);
      const to = Math.min(snapshot.lines.length, end + padding);
      const value = snapshot.lines.slice(from - 1, to).join("");
      if (value.length > 4000) throw new Error("Span read exceeds 4000 characters; reduce padding");
      this.metrics.readCalls++;
      this.metrics.sourceCharsReturned += value.length;
      result.push({ id: text(span.id ?? `${path}:${start}`, "span id", 80), path, sha256: snapshot.sha256, start: from, end: to, chars: value.length, text: value });
    }
    return result;
  }
  async read(id: string, padding = 0): Promise<SourceBlock> {
    integer(padding, "padding", 0, 40);
    const ref = await this.source(id);
    const snapshot = this.refs.get(id)!.snapshot;
    const start = Math.max(1, ref.start - padding), end = Math.min(snapshot.lines.length, ref.end + padding);
    const value = snapshot.lines.slice(start - 1, end).join("");
    if (value.length > 16000) throw new Error("Read exceeds 16000 characters; reduce padding");
    this.metrics.readCalls++;
    this.metrics.sourceCharsReturned += value.length;
    return { ...ref, start, end, chars: value.length, text: value };
  }
  /** TS/JS AST ranges; other languages use a declaration-line fallback. No body is returned. */
  async symbols(path = "."): Promise<Span[]> {
    const spans: Span[] = [];
    this.metrics.symbolCalls++;
    for (const file of await this.files(path)) {
      const snapshot = await this.snapshot(file);
      const add = (start: number, end: number, label: string, kind: string) => {
        const declaration = snapshot.lines[start - 1]!.replace(/\r?\n$/, "");
        spans.push({ id: `${file}:${start}`, path: file, start, end, label, kind, sha256: snapshot.sha256, text: declaration });
        this.metrics.sourceCharsReturned += declaration.length;
      };
      if (/\.[cm]?[jt]sx?$/.test(file)) {
        const tree = ts.createSourceFile(file, snapshot.lines.join(""), ts.ScriptTarget.Latest, true);
        const walk = (node: ts.Node) => {
          if (ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node) || ts.isMethodDeclaration(node)
            || ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node) || ts.isEnumDeclaration(node)
            || (ts.isVariableStatement(node) && node.parent === tree)) {
            const start = tree.getLineAndCharacterOfPosition(node.getStart(tree)).line + 1;
            const end = tree.getLineAndCharacterOfPosition(Math.max(node.getStart(tree), node.getEnd() - 1)).line + 1;
            const name = ts.isVariableStatement(node) ? node.declarationList.declarations.map(d => d.name.getText(tree)).join(",")
              : node.name?.getText(tree) ?? "default";
            add(start, end, name, ts.SyntaxKind[node.kind]);
          }
          // Include methods but not implementation-local variable declarations.
          ts.forEachChild(node, walk);
        };
        walk(tree);
      } else {
        snapshot.lines.forEach((line, index) => {
          const label = symbolLabel(line) ?? line.match(/^\s*(?:async\s+)?(?:def|class)\s+(\w+)/)?.[1];
          if (label) add(index + 1, index + 1, label, "declaration-line");
        });
      }
      if (spans.length > 1000) throw new Error("More than 1000 symbols; narrow the path");
    }
    return spans;
  }
  async search(term: string, path = "."): Promise<{ hits: Ref[]; truncated: boolean }> {
    text(term, "literal search term", 500);
    const refs = await this.blocks(path);
    const hits: Ref[] = [];
    for (const ref of refs) if ((await this.source(ref.id)).text.toLowerCase().includes(term.toLowerCase())) hits.push(ref);
    this.metrics.searchCalls++;
    return { hits: hits.slice(0, 100), truncated: hits.length > 100 };
  }
}
