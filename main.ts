import { App, Editor, MarkdownView, Plugin, Notice, PluginSettingTab, Setting, Modal } from 'obsidian';

interface WikiLinkInfo {
    startIndex: number;
    endIndex: number;
    text: string;
    fullMatch: string;
    line: number;
}

interface PluginSettings {
    processingDelay: number;
    enableAutoConversion: boolean;
    showNotifications: boolean;
    autoConvertEmptyLinks: boolean;
    quickConfirmTimeout: number;
}

const DEFAULT_SETTINGS: PluginSettings = {
    processingDelay: 150,
    enableAutoConversion: true,
    showNotifications: true,
    autoConvertEmptyLinks: true,
    quickConfirmTimeout: 3000
};

// Pre-compiled regular expressions
const EMPTY_WIKI_LINK_REGEX = /\[\[\]\]/g;
const WIKI_LINK_REGEX = /\[\[([^\]]+)\]\]/g;

class QuickConfirmModal extends Modal {
    private timeoutId?: NodeJS.Timeout;

    constructor(
        private plugin: WikiLinkFinalHelper,
        private linkText: string,
        private onConfirm: (addPipe: boolean) => void
    ) {
        super(plugin.app);
    }

    onOpen() {
        const { contentEl } = this;
        
        contentEl.createEl('h3', { text: 'Add separator | ?' });
        contentEl.createEl('p', { text: `Link: ${this.linkText}` });
        contentEl.createEl('p', { 
            text: '• YES - will create [[|text]] and place cursor between [[ and |', 
            cls: 'setting-item-description' 
        });
        contentEl.createEl('p', { 
            text: '• NO - will keep [[text]] and place cursor after ]]', 
            cls: 'setting-item-description' 
        });

        this.setupButtons(contentEl);
        this.setupAutoClose();
        this.setupKeyboardShortcuts();
    }

    private setupButtons(container: HTMLElement) {
        const buttonContainer = container.createDiv({ cls: 'modal-button-container' });
        
        const yesButton = buttonContainer.createEl('button', { 
            text: 'YES (Enter)', 
            cls: 'mod-cta' 
        });
        yesButton.addEventListener('click', () => this.handleConfirm(true));

        const noButton = buttonContainer.createEl('button', { 
            text: 'NO (Escape)' 
        });
        noButton.addEventListener('click', () => this.handleConfirm(false));

        yesButton.focus();
    }

    private setupAutoClose() {
        const { quickConfirmTimeout } = this.plugin.settings;
        if (quickConfirmTimeout > 0) {
            this.timeoutId = setTimeout(() => {
                this.handleConfirm(false);
            }, quickConfirmTimeout);
        }
    }

    private setupKeyboardShortcuts() {
        this.scope.register([], 'Enter', () => {
            this.handleConfirm(true);
            return false;
        });

        this.scope.register([], 'Escape', () => {
            this.handleConfirm(false);
            return false;
        });
    }

    private handleConfirm(addPipe: boolean) {
        this.cleanup();
        this.onConfirm(addPipe);
        this.close();
    }

    private cleanup() {
        if (this.timeoutId) {
            clearTimeout(this.timeoutId);
        }
    }

    onClose() {
        this.cleanup();
        this.contentEl.empty();
    }
}

export default class WikiLinkFinalHelper extends Plugin {
    private isProcessing = false;
    private processedLinks = new Set<string>();
    settings: PluginSettings = DEFAULT_SETTINGS;

    async onload() {
        await this.loadSettings();
        
        console.log('🎉 Wiki Link Final Helper loaded!');

        this.setupEventHandlers();
        this.registerCommands();

        this.addSettingTab(new WikiLinkSettingsTab(this.app, this));
    }

    private setupEventHandlers() {
        if (this.settings.enableAutoConversion) {
            this.registerEvent(
                this.app.workspace.on('editor-change', this.debounce((editor: Editor) => {
                    this.handleAutoCompletion(editor);
                }, this.settings.processingDelay))
            );
        }
    }

    private registerCommands() {
        const commands = [
            {
                id: 'convert-current-link',
                name: 'Convert Current Wiki Link',
                callback: (editor: Editor) => this.convertCurrentLink(editor)
            },
            {
                id: 'convert-all-links',
                name: 'Convert All Wiki Links in Document',
                callback: (editor: Editor) => this.convertAllLinksInDocument(editor)
            },
            {
                id: 'convert-selected-text',
                name: 'Wrap selected text in wiki link',
                callback: (editor: Editor) => this.wrapSelectionInWikiLink(editor)
            }
        ];

        commands.forEach(cmd => {
            this.addCommand({ id: cmd.id, name: cmd.name, editorCallback: cmd.callback });
        });
    }

    private debounce<T extends (...args: any[]) => void>(
        func: T,
        delay: number
    ): (...args: Parameters<T>) => void {
        let timeoutId: NodeJS.Timeout;
        return (...args: Parameters<T>) => {
            clearTimeout(timeoutId);
            timeoutId = setTimeout(() => func.apply(this, args), delay);
        };
    }

    async loadSettings() {
        this.settings = { ...DEFAULT_SETTINGS, ...await this.loadData() };
    }

    async saveSettings() {
        await this.saveData(this.settings);
    }

    private handleAutoCompletion(editor: Editor): void {
        if (this.isProcessing) return;

        try {
            const cursor = editor.getCursor();
            const lineContent = editor.getLine(cursor.line);

            // Check for empty links first
            const emptyLink = this.findEmptyWikiLink(lineContent, cursor);
            if (emptyLink) {
                this.processEmptyLink(editor, cursor.line, emptyLink);
                return;
            }

            // Then check for regular links
            const newLink = this.findNewWikiLink(lineContent, cursor, cursor.line);
            if (newLink) {
                this.processNewLink(editor, newLink);
            }

        } catch (error) {
            console.error('Final helper error:', error);
        }
    }

    private findEmptyWikiLink(content: string, cursor: { line: number, ch: number }): WikiLinkInfo | null {
        const matches = content.matchAll(EMPTY_WIKI_LINK_REGEX);
        
        for (const match of matches) {
            const startIndex = match.index!;
            const endIndex = startIndex + 4;
            
            if (this.isCursorInLink(cursor, startIndex, endIndex)) {
                return {
                    startIndex,
                    endIndex,
                    text: '',
                    fullMatch: '[[]]',
                    line: cursor.line
                };
            }
        }
        
        return null;
    }

    private findNewWikiLink(content: string, cursor: { line: number, ch: number }, line: number): WikiLinkInfo | null {
        const matches = content.matchAll(WIKI_LINK_REGEX);
        
        for (const match of matches) {
            const startIndex = match.index!;
            const endIndex = startIndex + match[0].length;
            const linkText = match[1] || '';
            
            if (linkText.includes('|')) continue;
            
            const linkKey = `${line}:${startIndex}:${linkText}`;
            if (this.processedLinks.has(linkKey)) continue;
            
            if (this.isCursorNearLink(cursor, startIndex, endIndex)) {
                this.processedLinks.add(linkKey);
                
                return {
                    startIndex,
                    endIndex,
                    text: linkText,
                    fullMatch: match[0],
                    line
                };
            }
        }
        
        return null;
    }

    private isCursorInLink(cursor: { line: number, ch: number }, startIndex: number, endIndex: number): boolean {
        return cursor.ch >= startIndex + 2 && cursor.ch <= endIndex - 2;
    }

    private isCursorNearLink(cursor: { line: number, ch: number }, startIndex: number, endIndex: number): boolean {
        return cursor.ch >= startIndex - 1 && cursor.ch <= endIndex + 1;
    }

    private processEmptyLink(editor: Editor, line: number, link: WikiLinkInfo): void {
        this.isProcessing = true;
        
        setTimeout(() => {
            try {
                const currentContent = editor.getLine(line);
                
                if (currentContent.substring(link.startIndex, link.endIndex) !== '[[]]') {
                    return;
                }

                editor.replaceRange('[[|]]', 
                    { line, ch: link.startIndex }, 
                    { line, ch: link.endIndex }
                );
                
                editor.setCursor({ line, ch: link.startIndex + 2 });
                this.showNotification('✓ Ready for link text input');
                
            } catch (error) {
                console.error('Empty link processing error:', error);
            } finally {
                this.isProcessing = false;
            }
        }, this.settings.processingDelay);
    }

    private processNewLink(editor: Editor, link: WikiLinkInfo): void {
        this.showQuickConfirm(editor, link);
    }

    private showQuickConfirm(editor: Editor, link: WikiLinkInfo): void {
        new QuickConfirmModal(this, link.text, (addPipe: boolean) => {
            if (addPipe) {
                this.convertLinkWithPipe(editor, link);
            } else {
                editor.setCursor({ line: link.line, ch: link.endIndex });
                this.showNotification(`✓ Link saved: ${link.text}`);
            }
        }).open();
    }

    private convertLinkWithPipe(editor: Editor, link: WikiLinkInfo): void {
        this.isProcessing = true;
        
        setTimeout(() => {
            try {
                const currentContent = editor.getLine(link.line);
                
                if (currentContent.substring(link.startIndex, link.endIndex) !== link.fullMatch) {
                    return;
                }

                const newLink = `[[|${link.text}]]`;
                editor.replaceRange(newLink, 
                    { line: link.line, ch: link.startIndex }, 
                    { line: link.line, ch: link.endIndex }
                );
                
                editor.setCursor({ line: link.line, ch: link.startIndex + 2 });
                this.showNotification(`✓ Converted: ${link.text}`);
                
            } catch (error) {
                console.error('New link processing error:', error);
            } finally {
                this.isProcessing = false;
            }
        }, this.settings.processingDelay);
    }

    private convertCurrentLink(editor: Editor): void {
        try {
            const cursor = editor.getCursor();
            const lineContent = editor.getLine(cursor.line);
            
            const linkUnderCursor = this.findAllWikiLinks(lineContent, cursor.line)
                .find(link => cursor.ch >= link.startIndex && cursor.ch <= link.endIndex);
            
            if (!linkUnderCursor) {
                this.showNotification('No wiki link under cursor');
                return;
            }

            if (linkUnderCursor.text.includes('|')) {
                this.showNotification('Link is already in target format');
                return;
            }

            this.showQuickConfirm(editor, linkUnderCursor);
            
        } catch (error) {
            console.error('Convert current link error:', error);
        }
    }

    private convertAllLinksInDocument(editor: Editor): void {
        try {
            let convertedCount = 0;
            
            for (let line = 0; line < editor.lineCount(); line++) {
                const content = editor.getLine(line);
                const links = this.findAllWikiLinks(content, line);
                
                let offset = 0;
                
                for (const link of links) {
                    if (!link.text.includes('|')) {
                        const newLink = `[[|${link.text}]]`;
                        const adjustedStart = link.startIndex + offset;
                        const adjustedEnd = link.endIndex + offset;
                        
                        editor.replaceRange(newLink, 
                            { line, ch: adjustedStart }, 
                            { line, ch: adjustedEnd }
                        );
                        
                        offset += newLink.length - link.fullMatch.length;
                        convertedCount++;
                    }
                }
            }
            
            this.showNotification(
                convertedCount > 0 
                    ? `✓ Converted ${convertedCount} links`
                    : 'No links to convert'
            );
            
        } catch (error) {
            console.error('Convert all links error:', error);
        }
    }

    private wrapSelectionInWikiLink(editor: Editor): void {
        try {
            const selection = editor.getSelection().trim();
            if (!selection) {
                this.showNotification('Please select some text first');
                return;
            }

            this.showQuickConfirmForSelection(editor, selection);
            
        } catch (error) {
            console.error('Wrap selection error:', error);
        }
    }

    private showQuickConfirmForSelection(editor: Editor, selection: string): void {
        new QuickConfirmModal(this, selection, (addPipe: boolean) => {
            const from = editor.getCursor('from');
            const newText = addPipe ? `[[|${selection}]]` : `[[${selection}]]`;
            
            editor.replaceSelection(newText);
            
            const cursorPos = addPipe 
                ? from.ch + 2 
                : from.ch + selection.length + 4;
                
            editor.setCursor({ line: from.line, ch: cursorPos });
            
            this.showNotification(
                addPipe 
                    ? '✓ Text wrapped with pipe' 
                    : '✓ Text wrapped without pipe'
            );
        }).open();
    }

    private findAllWikiLinks(content: string, line: number): WikiLinkInfo[] {
        const links: WikiLinkInfo[] = [];
        const matches = content.matchAll(WIKI_LINK_REGEX);
        
        for (const match of matches) {
            links.push({
                startIndex: match.index!,
                endIndex: match.index! + match[0].length,
                text: match[1] || '',
                fullMatch: match[0],
                line
            });
        }
        
        return links;
    }

    private showNotification(message: string): void {
        if (this.settings.showNotifications) {
            new Notice(message, 2000);
        }
    }

    onunload(): void {
        console.log('Wiki Link Final Helper unloaded');
        this.processedLinks.clear();
    }
}

class WikiLinkSettingsTab extends PluginSettingTab {
    constructor(app: App, private plugin: WikiLinkFinalHelper) {
        super(app, plugin);
    }

    display(): void {
        const { containerEl } = this;
        containerEl.empty();

        containerEl.createEl('h2', { text: 'Wiki Link Helper Settings' });

        const settings: Array<{
            name: string;
            desc: string;
            key: keyof PluginSettings;
            type: 'text' | 'toggle';
            placeholder?: string;
        }> = [
            {
                name: 'Processing delay',
                desc: 'Delay in milliseconds before processing links (recommended: 100-200)',
                key: 'processingDelay',
                type: 'text',
                placeholder: '150'
            },
            {
                name: 'Quick confirm timeout',
                desc: 'Time in milliseconds before auto-confirming (0 to disable)',
                key: 'quickConfirmTimeout',
                type: 'text',
                placeholder: '3000'
            },
            {
                name: 'Enable auto-conversion',
                desc: 'Automatically convert wiki links as you type',
                key: 'enableAutoConversion',
                type: 'toggle'
            },
            {
                name: 'Show notifications',
                desc: 'Show success and info notifications',
                key: 'showNotifications',
                type: 'toggle'
            },
            {
                name: 'Auto-convert empty links',
                desc: 'Automatically convert [[ ]] to [[|]] when cursor is inside',
                key: 'autoConvertEmptyLinks',
                type: 'toggle'
            }
        ];

        settings.forEach(setting => {
            const settingItem = new Setting(containerEl)
                .setName(setting.name)
                .setDesc(setting.desc);

            if (setting.type === 'text') {
                settingItem.addText(text => text
                    .setPlaceholder(setting.placeholder!)
                    .setValue(this.plugin.settings[setting.key].toString())
                    .onChange(this.handleNumberSettingChange(setting.key))
                );
            } else {
                settingItem.addToggle(toggle => toggle
                    .setValue(this.plugin.settings[setting.key] as boolean)
                    .onChange(this.handleToggleSettingChange(setting.key))
                );
            }
        });
    }

    private handleNumberSettingChange = (key: keyof PluginSettings) => {
        return async (value: string) => {
            const numValue = parseInt(value);
            if (!isNaN(numValue) && numValue >= 0) {
                (this.plugin.settings[key] as number) = numValue;
                await this.plugin.saveSettings();
            }
        };
    };

    private handleToggleSettingChange = (key: keyof PluginSettings) => {
        return async (value: boolean) => {
            (this.plugin.settings[key] as boolean) = value;
            await this.plugin.saveSettings();
        };
    };
}