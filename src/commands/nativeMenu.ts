/**
 * The native application menu (electron/main.ts buildAppMenu) emits an app:*
 * event per item, when it is clicked and when its accelerator is pressed in a
 * place the page does not handle that key (Cmd+F outside the editor...). An
 * event nobody subscribes to is a menu item and a shortcut that do nothing.
 * Each one runs the same command as the palette and the title bar.
 */
import type { ElectronAPI } from '@/types/electron'
import { runCommand } from './registry'
import './appCommands'

/** app:toggle-sidebar's optional argument: the view to show. */
const SIDEBAR_VIEW_COMMANDS: Record<string, string> = {
  explorer: 'view.explorer',
  search: 'view.search',
  git: 'view.sourceControl',
}

export function subscribeNativeMenu(api: ElectronAPI): () => void {
  const run = (id: string) => () => runCommand(id)
  const unsubscribers = [
    api.onAppOpenAbout(run('help.about')),
    api.onAppNewFile(run('file.newFile')),
    api.onAppSave(run('file.save')),
    api.onAppSaveAs(run('file.saveAs')),
    api.onAppSaveAll(run('file.saveAll')),
    api.onAppCloseEditor(run('file.closeEditor')),
    api.onAppOpenSettings(run('preferences.settings')),
    api.onAppFind(run('edit.find')),
    api.onAppReplace(run('edit.replace')),
    api.onAppFindInFiles(run('view.search')),
    api.onAppCommandPalette(run('view.commandPalette')),
    api.onAppToggleSidebar((view) => {
      runCommand((typeof view === 'string' && SIDEBAR_VIEW_COMMANDS[view]) || 'view.toggleSidebar')
    }),
    api.onAppTogglePanel(run('view.togglePanel')),
    api.onAppQuickOpen(run('go.file')),
    api.onAppGoToSymbol(run('go.symbol')),
    api.onAppGoToLine(run('go.line')),
    api.onAppGoToDefinition(run('go.definition')),
    api.onAppPeekDefinition(run('go.peekDefinition')),
    api.onAppRunTask(run('terminal.runTask')),
    api.onAppRunBuildTask(run('terminal.runBuildTask')),
    api.onAppNewTerminal(run('terminal.new')),
    api.onAppSplitTerminal(run('terminal.split')),
    api.onAppShowKeybindings(run('preferences.keyboardShortcuts')),
  ]
  return () => unsubscribers.forEach((unsubscribe) => unsubscribe())
}
