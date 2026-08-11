import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
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
        this._settings = this.getSettings();
        this._appWorkspaces = parseAppWorkspaces(this._settings.get_strv('app-workspace-list'));
        this._settings.connectObject('changed::app-workspace-list', () => {
            this._appWorkspaces = parseAppWorkspaces(this._settings.get_strv('app-workspace-list'));
        }, this);

        this._trackedWindows = new Map();
        this._startupPhase = true;

        global.display.connectObject('window-created', this._onWindowCreated.bind(this), this);

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
            global.display.disconnectObject(this);
            this._graceTimeoutId = null;
            return GLib.SOURCE_REMOVE;
        });
    }

    disable() {
        if (this._startupTimeoutId) {
            GLib.Source.remove(this._startupTimeoutId);
            this._startupTimeoutId = null;
        }

        if (this._graceTimeoutId) {
            GLib.Source.remove(this._graceTimeoutId);
            this._graceTimeoutId = null;
        }

        global.display.disconnectObject(this);

        if (this._trackedWindows) {
            for (const [window, tracking] of this._trackedWindows.entries()) {
                window.disconnectObject(this);
                if (tracking.timeoutId)
                    GLib.Source.remove(tracking.timeoutId);
            }
            this._trackedWindows.clear();
            this._trackedWindows = null;
        }

        if (this._settings)
            this._settings.disconnectObject(this);
        this._settings = null;
        this._appWorkspaces = null;
    }

    _onWindowCreated(display, window) {
        if (this._trackedWindows.has(window))
            return;

        window.connectObject(
            'notify::wm-class', () => this._checkAndMoveWindow(window),
            'unmanaged', () => this._clearTrackedWindow(window),
            this);

        this._trackedWindows.set(window, { timeoutId: null });
        this._checkAndMoveWindow(window);
    }

    _clearTrackedWindow(window) {
        if (!this._trackedWindows || !this._trackedWindows.has(window))
            return;

        const tracking = this._trackedWindows.get(window);
        window.disconnectObject(this);
        if (tracking.timeoutId)
            GLib.Source.remove(tracking.timeoutId);

        this._trackedWindows.delete(window);
    }

    _checkAndMoveWindow(window, force = false) {
        if (!force && !this._startupPhase)
            return;

        // Ignore dialogs, splash screens, popups, utility windows, etc.
        if (window.window_type !== Meta.WindowType.NORMAL || window.is_skip_taskbar())
            return;

        const app = Shell.WindowTracker.get_default().get_window_app(window);
        if (!app)
            return;

        const appId = app.get_id();
        if (!this._appWorkspaces.has(appId))
            return;

        const targetWorkspaceIndex = this._appWorkspaces.get(appId);

        const tracking = this._trackedWindows.get(window);
        if (tracking && tracking.timeoutId) {
            GLib.Source.remove(tracking.timeoutId);
            tracking.timeoutId = null;
        }

        const timeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 500, () => {
            if (this._trackedWindows && this._trackedWindows.has(window)) {
                const item = this._trackedWindows.get(window);
                if (item)
                    item.timeoutId = null;
                this._moveToWorkspace(window, targetWorkspaceIndex);
            }
            return GLib.SOURCE_REMOVE;
        });

        if (tracking) {
            tracking.timeoutId = timeoutId;
        }
    }

    _moveToWorkspace(window, index) {
        const workspaceManager = global.workspace_manager;

        // Ensure target workspace index exists
        while (workspaceManager.n_workspaces <= index) {
            workspaceManager.append_new_workspace(false, global.get_current_time());
        }

        const targetWorkspace = workspaceManager.get_workspace_by_index(index);
        if (targetWorkspace && window.get_workspace() !== targetWorkspace) {
            window.change_workspace(targetWorkspace);
        }
    }

    _scanOpenWindows() {
        const workspaceManager = global.workspace_manager;
        const numWorkspaces = workspaceManager.n_workspaces;

        for (let i = 0; i < numWorkspaces; i++) {
            const workspace = workspaceManager.get_workspace_by_index(i);
            const windows = workspace.list_windows();

            for (const window of windows) {
                if (this._trackedWindows.has(window)) {
                    this._checkAndMoveWindow(window, true);
                } else {
                    this._onWindowCreated(global.display, window);
                }
            }
        }
    }
}
