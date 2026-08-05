import GLib from 'gi://GLib';
import Shell from 'gi://Shell';
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';

const STARTUP_GRACE_PERIOD_SECONDS = 20;

function parseAppWorkspaces(entries) {
    const map = new Map();
    for (const entry of entries) {
        const idx = entry.lastIndexOf(':');
        if (idx === -1)
            continue;
        const workspace = parseInt(entry.slice(idx + 1), 10);
        if (Number.isNaN(workspace))
            continue;
        map.set(entry.slice(0, idx), workspace);
    }
    return map;
}

export default class AutoSetupWindowsExtension extends Extension {
    enable() {
        console.log("[Auto-Setup-Windows] Extension enabled.");

        this._settings = this.getSettings();
        this._appWorkspaces = parseAppWorkspaces(this._settings.get_strv('app-workspace-list'));
        this._appWorkspacesChangedId = this._settings.connect('changed::app-workspace-list', () => {
            this._appWorkspaces = parseAppWorkspaces(this._settings.get_strv('app-workspace-list'));
        });

        this._windowCreatedId = global.display.connect('window-created', this._onWindowCreated.bind(this));
        this._signals = [];
        this._startupPhase = true;

        // Run once on load just in case apps are already open
        this._scanOpenWindows();

        // WAYLAND FIX: Apps at login compete to spawn, causing GNOME's dynamic
        // workspaces to collapse empty ones. We wait 4 seconds for tracked apps
        // to fully spawn, then force a synchronization to place them correctly.
        this._startupTimeoutId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 4, () => {
            this._scanOpenWindows();
            this._startupTimeoutId = null;
            return GLib.SOURCE_REMOVE;
        });

        // After the grace period, stop auto-placing windows: disconnect the
        // window-created listener so windows opened later are left alone.
        this._graceTimeoutId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, STARTUP_GRACE_PERIOD_SECONDS, () => {
            this._startupPhase = false;
            if (this._windowCreatedId) {
                global.display.disconnect(this._windowCreatedId);
                this._windowCreatedId = null;
            }
            this._graceTimeoutId = null;
            return GLib.SOURCE_REMOVE;
        });
    }

    disable() {
        console.log("[Auto-Setup-Windows] Extension disabled.");
        if (this._startupTimeoutId) {
            GLib.Source.remove(this._startupTimeoutId);
            this._startupTimeoutId = null;
        }

        if (this._graceTimeoutId) {
            GLib.Source.remove(this._graceTimeoutId);
            this._graceTimeoutId = null;
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

        if (this._appWorkspacesChangedId) {
            this._settings.disconnect(this._appWorkspacesChangedId);
            this._appWorkspacesChangedId = null;
        }
        this._settings = null;
        this._appWorkspaces = null;
    }

    _onWindowCreated(display, window) {
        let signalId = window.connect('notify::wm-class', () => {
            this._checkAndMoveWindow(window);
        });

        this._signals.push({ window: window, id: signalId });
        this._checkAndMoveWindow(window);
    }

    // `force` bypasses the startup-grace-period gate; used for the explicit
    // startup scans rather than the passive window-created/notify::wm-class listeners.
    _checkAndMoveWindow(window, force = false) {
        if (!force && !this._startupPhase) return;

        const app = Shell.WindowTracker.get_default().get_window_app(window);
        if (!app) return;

        const appId = app.get_id();
        if (!this._appWorkspaces.has(appId)) return;

        const targetWorkspaceIndex = this._appWorkspaces.get(appId);
        // Give Mutter (Wayland) 500ms to map the window securely
        // before transferring it to another workspace.
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, 500, () => {
            this._moveToWorkspace(window, targetWorkspaceIndex);
            return GLib.SOURCE_REMOVE;
        });
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
        }
    }

    // Used at startup to place windows of tracked apps that are already open.
    _scanOpenWindows() {
        const workspaceManager = global.workspace_manager;
        const numWorkspaces = workspaceManager.n_workspaces;

        for (let i = 0; i < numWorkspaces; i++) {
            let workspace = workspaceManager.get_workspace_by_index(i);
            let windows = workspace.list_windows();

            for (let window of windows) {
                this._checkAndMoveWindow(window, true);
            }
        }
    }
}
