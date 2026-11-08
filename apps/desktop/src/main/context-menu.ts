import { BrowserWindow, clipboard, Menu, type ContextMenuParams, type MenuItemConstructorOptions, type WebContents } from 'electron';

/** Itens do menu de botão direito (em português), conforme o que está sob o cursor. Função pura, testável. */
export function contextMenuTemplate(p: Pick<ContextMenuParams, 'isEditable' | 'selectionText' | 'linkURL' | 'editFlags'>): MenuItemConstructorOptions[] {
  const items: MenuItemConstructorOptions[] = [];
  const hasSelection = p.selectionText.trim().length > 0;
  if (p.isEditable) {
    items.push(
      { role: 'undo', label: 'Desfazer', enabled: p.editFlags.canUndo },
      { role: 'redo', label: 'Refazer', enabled: p.editFlags.canRedo },
      { type: 'separator' },
      { role: 'cut', label: 'Recortar', enabled: p.editFlags.canCut },
      { role: 'copy', label: 'Copiar', enabled: p.editFlags.canCopy },
      { role: 'paste', label: 'Colar', enabled: p.editFlags.canPaste },
      { role: 'pasteAndMatchStyle', label: 'Colar sem formatação', enabled: p.editFlags.canPaste },
      { type: 'separator' },
      { role: 'selectAll', label: 'Selecionar tudo', enabled: p.editFlags.canSelectAll },
    );
  } else if (hasSelection) {
    items.push({ role: 'copy', label: 'Copiar' });
  }
  if (p.linkURL) {
    if (items.length) items.push({ type: 'separator' });
    items.push({ label: 'Copiar endereço do link', click: () => clipboard.writeText(p.linkURL) });
  }
  if (!p.isEditable) {
    if (items.length) items.push({ type: 'separator' });
    items.push({ role: 'selectAll', label: 'Selecionar tudo' });
  }
  return items;
}

/** Liga o menu de botão direito numa janela (launcher ou janela do LinkedIn de uma conta). */
export function attachContextMenu(wc: WebContents): void {
  wc.on('context-menu', (_event, params) => {
    const template = contextMenuTemplate(params);
    if (!template.length) return;
    const win = BrowserWindow.fromWebContents(wc) ?? undefined;
    Menu.buildFromTemplate(template).popup(win ? { window: win } : {});
  });
}
