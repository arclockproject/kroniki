// Editor support for .vn dialogue scripts: suggestions, error underlines, "show generated TS".
// The rules come from the game's own code (vite/vn), bundled in. The ids (characters, poses, flags,
// items…) are read from the open project and re-read whenever src/content changes, so new content
// works right away without rebuilding or reinstalling this extension.
import { existsSync } from 'node:fs'
import path from 'node:path'
import * as vscode from 'vscode'
import { checkVn } from '../../../vite/vn/check.ts'
import { compileVn } from '../../../vite/vn/compile.ts'
import { completeVn, type SuggestionKind } from '../../../vite/vn/complete.ts'
import { collectVnIds, type VnIds } from '../../../vite/vn/ids.ts'
import { checkRouteVn, compileRouteVn, completeRouteVn } from '../../../vite/vn/route.ts'

/** src/content/routes/<name>/index.vn is a route script (story order), not an event. */
const isRoute = (document: vscode.TextDocument) =>
  /[/]src[/]content[/]routes[/]/.test(document.uri.fsPath)

/** Project root (the folder with src/content) -> its ids, read on demand. */
const idsCache = new Map<string, VnIds>()

function projectRoot(file: string): string | undefined {
  let dir = path.dirname(file)
  for (;;) {
    if (existsSync(path.join(dir, 'src', 'content'))) return dir
    const parent = path.dirname(dir)
    if (parent === dir) return undefined
    dir = parent
  }
}

function idsFor(document: vscode.TextDocument): VnIds | undefined {
  const root = projectRoot(document.uri.fsPath)
  if (!root) return undefined
  let ids = idsCache.get(root)
  if (!ids) {
    try {
      ids = collectVnIds(root)
      idsCache.set(root, ids)
    } catch (error) {
      console.error('[vn] reading project ids failed', error)
      return undefined
    }
  }
  return ids
}

const KIND: Record<SuggestionKind, vscode.CompletionItemKind> = {
  command: vscode.CompletionItemKind.Keyword,
  character: vscode.CompletionItemKind.Class,
  keyword: vscode.CompletionItemKind.Keyword,
  value: vscode.CompletionItemKind.Value,
  tag: vscode.CompletionItemKind.Property,
  snippet: vscode.CompletionItemKind.Snippet,
}

export function activate(context: vscode.ExtensionContext) {
  const diagnostics = vscode.languages.createDiagnosticCollection('vn')
  context.subscriptions.push(diagnostics)

  const validate = (document: vscode.TextDocument) => {
    if (document.languageId !== 'vn') return
    const text = document.getText()
    const found: vscode.Diagnostic[] = []
    const route = isRoute(document)
    for (const e of (route ? compileRouteVn(text) : compileVn(text)).errors) {
      const line = document.lineAt(Math.min(e.line - 1, document.lineCount - 1))
      found.push(new vscode.Diagnostic(line.range, e.message, vscode.DiagnosticSeverity.Error))
    }
    const ids = idsFor(document)
    if (ids) {
      for (const p of route ? checkRouteVn(text, ids) : checkVn(text, ids)) {
        const range = new vscode.Range(p.line - 1, p.column, p.line - 1, p.column + p.length)
        found.push(new vscode.Diagnostic(range, p.message, vscode.DiagnosticSeverity.Error))
      }
    }
    for (const d of found) d.source = 'vn'
    diagnostics.set(document.uri, found)
  }
  const validateAll = () => {
    for (const document of vscode.workspace.textDocuments) validate(document)
  }

  // Re-check while typing (slightly delayed).
  const timers = new Map<string, ReturnType<typeof setTimeout>>()
  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument(validate),
    vscode.workspace.onDidChangeTextDocument(({ document }) => {
      if (document.languageId !== 'vn') return
      const key = document.uri.toString()
      clearTimeout(timers.get(key))
      timers.set(
        key,
        setTimeout(() => validate(document), 200),
      )
    }),
    vscode.workspace.onDidCloseTextDocument((document) => diagnostics.delete(document.uri)),
  )

  // New characters, poses, flags, items…: forget the cached ids and re-check open scripts.
  let refresh: ReturnType<typeof setTimeout> | undefined
  const onContentChange = () => {
    clearTimeout(refresh)
    refresh = setTimeout(() => {
      idsCache.clear()
      validateAll()
    }, 300)
  }
  for (const pattern of ['**/src/content/**', '**/src/core/scene/{types,filters}.ts']) {
    const watcher = vscode.workspace.createFileSystemWatcher(pattern)
    watcher.onDidCreate(onContentChange)
    watcher.onDidChange(onContentChange)
    watcher.onDidDelete(onContentChange)
    context.subscriptions.push(watcher)
  }
  // Unsaved edits to content files count too (e.g. while typing a new pose).
  context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument((document) => {
      if (document.languageId !== 'vn') onContentChange()
    }),
  )

  context.subscriptions.push(
    vscode.languages.registerCompletionItemProvider(
      { language: 'vn' },
      {
        provideCompletionItems(document, position) {
          const ids = idsFor(document)
          if (!ids) return []
          const line = document.lineAt(position.line).text
          const { start, items } = isRoute(document)
            ? completeRouteVn(line, position.character, ids)
            : completeVn(line, position.character, ids, document.getText())
          const range = new vscode.Range(position.line, start, position.line, position.character)
          return items.map((s, i) => {
            const item = new vscode.CompletionItem(s.label, KIND[s.kind])
            item.detail = s.detail
            item.range = range
            item.sortText = String(i).padStart(4, '0') // keep our order
            if (s.insert)
              item.insertText = s.snippet ? new vscode.SnippetString(s.insert) : s.insert
            // Snippets with a $0 cursor: offer the next suggestion straight away.
            if (s.insert?.endsWith(' $1') || s.insert?.endsWith(': $0'))
              item.command = { command: 'editor.action.triggerSuggest', title: 'suggest' }
            return item
          })
        },
      },
      ' ',
      ':',
      '(',
      "'",
      '"',
      '{',
      ',',
      '/',
    ),
  )

  context.subscriptions.push(
    vscode.commands.registerCommand('kroniki-vn.showGenerated', async () => {
      const document = vscode.window.activeTextEditor?.document
      if (document?.languageId !== 'vn') return
      const generated = document.uri.fsPath.replace(/\.vn$/i, '.gen.ts')
      if (!existsSync(generated)) {
        void vscode.window.showInformationMessage(
          'No generated file yet: it is written by the dev server or `pnpm gen`.',
        )
        return
      }
      await vscode.window.showTextDocument(vscode.Uri.file(generated), {
        viewColumn: vscode.ViewColumn.Beside,
        preview: true,
      })
    }),
  )

  validateAll()
}

export function deactivate() {}
