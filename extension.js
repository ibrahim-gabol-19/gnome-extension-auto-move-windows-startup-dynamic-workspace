import St from 'gi://St';
import GLib from 'gi://GLib';
import Clutter from 'gi://Clutter';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';

// Define the workspaces for your apps (0-based index: 0 is Workspace 1)
const APP_WORKSPACES = {
    'org.gnome.calendar': 0,
    'gnome-calendar': 0,
    'obsidian': 1,
    'google-chrome': 2,
    'google-chrome-stable': 2,
    'chrome': 2
};

export default class AutoSetupWindowsExtension extends Extension {
    enable() {
        console.log("[Auto-Setup-Windows] Extension enabled.");
        this._windowCreatedId = global.display.connect('window-created', this._onWindowCreated.bind(this));
        this._signals = [];

        // Add a button to the top panel for debugging
        this._indicator = new PanelMenu.Button(0.0, this.metadata.name, false);
        const icon = new St.Icon({
            icon_name: 'view-app-grid-symbolic',
            style_class: 'system-status-icon',
        });
        this._indicator.add_child(icon);

        this._indicator.connect('button-press-event', () => {
            this._runDebugProcess();
            return Clutter.EVENT_PROPAGATE;
        });

        Main.panel.addToStatusArea(this.uuid, this._indicator);
        
        // Run once on load just in case apps are already open
        this._runDebugProcess();

        // WAYLAND FIX: Apps at login compete to spawn, causing GNOME's dynamic 
        // workspaces to collapse empty ones. We wait 4 seconds for Calendar, Obsidian, 
        // and Chrome to fully spawn, then force a synchronization to place them correctly.
        this._startupTimeoutId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 4, () => {
            console.log("[Auto-Setup-Windows] Running delayed startup sync...");
            this._runDebugProcess();
            this._startupTimeoutId = null;
            return GLib.SOURCE_REMOVE;
        });
    }

    disable() {
        console.log("[Auto-Setup-Windows] Extension disabled.");
        if (this._startupTimeoutId) {
            GLib.Source.remove(this._startupTimeoutId);
            this._startupTimeoutId = null;
        }

        if (this._windowCreatedId) {
            global.display.disconnect(this._windowCreatedId);
            this._windowCreatedId = null;
        }

        // Clean up window signals
        for (let sig of this._signals) {
            if (sig.window && sig.id) {
                sig.window.disconnect(sig.id);
            }
        }
        this._signals = [];

        if (this._indicator) {
            this._indicator.destroy();
            this._indicator = null;
        }
    }

    _onWindowCreated(display, window) {
        let signalId = window.connect('notify::wm-class', () => {
            this._checkAndMoveWindow(window);
        });

        this._signals.push({ window: window, id: signalId });
        this._checkAndMoveWindow(window);
    }

    _checkAndMoveWindow(window) {
        let wmClass = window.get_wm_class();
        if (!wmClass) return;
        
        wmClass = wmClass.toLowerCase();
        
        if (wmClass in APP_WORKSPACES) {
            let targetWorkspaceIndex = APP_WORKSPACES[wmClass];
            // Give Mutter (Wayland) 500ms to map the window securely 
            // before transferring it to another workspace.
            GLib.timeout_add(GLib.PRIORITY_DEFAULT, 500, () => {
                this._moveToWorkspace(window, targetWorkspaceIndex);
                return GLib.SOURCE_REMOVE;
            });
        }
    }

    _moveToWorkspace(window, index) {
        const workspaceManager = global.workspace_manager;
        
        // Ensure we have enough workspaces
        while (workspaceManager.n_workspaces <= index) {
            workspaceManager.append_new_workspace(false, global.get_current_time());
        }

        let targetWorkspace = workspaceManager.get_workspace_by_index(index);
        if (targetWorkspace && window.get_workspace() !== targetWorkspace) {
            window.change_workspace(targetWorkspace);
            console.log(`[Auto-Setup-Windows] DEBUG: Moved '${window.get_wm_class()}' to Workspace ${index + 1}`);
        }
    }

    // The debug button triggers this to parse all open windows
    _runDebugProcess() {
        console.log("[Auto-Setup-Windows] DEBUG: Scanning all open windows...");
        const workspaceManager = global.workspace_manager;
        const numWorkspaces = workspaceManager.n_workspaces;

        for (let i = 0; i < numWorkspaces; i++) {
            let workspace = workspaceManager.get_workspace_by_index(i);
            let windows = workspace.list_windows();
            
            for (let window of windows) {
                this._checkAndMoveWindow(window);
            }
        }
    }
}
