import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk';

import { ExtensionPreferences } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

function parseEntries(settings) {
    return settings.get_strv('app-workspace-list')
        .map(str => {
            const idx = str.lastIndexOf(':');
            if (idx === -1)
                return null;
            const workspace = parseInt(str.slice(idx + 1), 10);
            if (Number.isNaN(workspace))
                return null;
            return { appId: str.slice(0, idx), workspace };
        })
        .filter(entry => entry !== null);
}

function saveEntries(settings, entries) {
    settings.set_strv('app-workspace-list',
        entries.map(({ appId, workspace }) => `${appId}:${workspace}`));
}

// GNOME's dynamic workspaces collapse any empty workspace that isn't the
// last one, so a gap (e.g. workspaces 1, 2, 6 used) is never actually
// reachable at runtime. Squash the distinct workspace numbers in use down
// to a contiguous 0-based range, preserving order and ties, so a gap can
// never be saved regardless of what number was typed.
function compactWorkspaces(entries) {
    const distinctSorted = [...new Set(entries.map(e => e.workspace))].sort((a, b) => a - b);
    const remap = new Map(distinctSorted.map((w, i) => [w, i]));
    return entries.map(e => ({ appId: e.appId, workspace: remap.get(e.workspace) }));
}

// Modal list of installed applications not already tracked; picking one
// calls onSelected(appId) and closes the dialog.
function showAppPicker(parentWindow, excludeIds, onSelected) {
    const dialog = new Gtk.Dialog({
        title: 'Add Application',
        transient_for: parentWindow,
        modal: true,
        default_width: 420,
        default_height: 520,
        use_header_bar: 1,
    });
    dialog.add_button('Cancel', Gtk.ResponseType.CANCEL);
    dialog.connect('response', () => dialog.close());

    const searchEntry = new Gtk.SearchEntry({
        margin_top: 8,
        margin_bottom: 8,
        margin_start: 8,
        margin_end: 8,
    });

    const listBox = new Gtk.ListBox({
        selection_mode: Gtk.SelectionMode.NONE,
        css_classes: ['boxed-list'],
        margin_start: 8,
        margin_end: 8,
        margin_bottom: 8,
    });
    listBox.set_filter_func(row => {
        const text = searchEntry.get_text().toLowerCase();
        return !text || row._appName.toLowerCase().includes(text);
    });
    searchEntry.connect('search-changed', () => listBox.invalidate_filter());

    const apps = Gio.AppInfo.get_all()
        .filter(app => app.should_show() && !excludeIds.has(app.get_id()))
        .sort((a, b) => a.get_display_name().localeCompare(b.get_display_name()));

    for (const app of apps) {
        const row = new Adw.ActionRow({
            title: GLib.markup_escape_text(app.get_display_name(), -1),
            activatable: true,
        });
        row._appName = app.get_display_name();
        row.add_prefix(new Gtk.Image({ gicon: app.get_icon(), pixel_size: 32 }));
        row.connect('activated', () => {
            onSelected(app.get_id());
            dialog.close();
        });
        listBox.append(row);
    }

    const scrolled = new Gtk.ScrolledWindow({ vexpand: true, child: listBox });
    const box = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL });
    box.append(searchEntry);
    box.append(scrolled);

    dialog.get_content_area().append(box);
    dialog.present();
}

export default class AutoSetupWindowsPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();

        const page = new Adw.PreferencesPage();
        window.add(page);

        const appsGroup = new Adw.PreferencesGroup({
            title: 'Tracked Applications',
            description: 'Apps below are moved to their workspace when they open during the grace period. ' +
                'Workspace numbers always stay contiguous (no gaps), since GNOME collapses empty workspaces.',
        });
        page.add(appsGroup);

        const addButton = new Gtk.Button({
            icon_name: 'list-add-symbolic',
            valign: Gtk.Align.CENTER,
            css_classes: ['flat'],
            tooltip_text: 'Add Application',
        });
        appsGroup.set_header_suffix(addButton);

        let rows = new Map(); // appId -> { row, spin }

        const syncSpinValues = entries => {
            for (const { appId, workspace } of entries) {
                const entry = rows.get(appId);
                if (entry)
                    entry.spin.set_value(workspace + 1);
            }
        };

        const buildRow = ({ appId, workspace }) => {
            const appInfo = Gio.DesktopAppInfo.new(appId);
            const row = new Adw.ActionRow({
                title: GLib.markup_escape_text(appInfo ? appInfo.get_display_name() : appId, -1),
                subtitle: appId,
            });

            row.add_prefix(new Gtk.Image({
                gicon: appInfo ? appInfo.get_icon() : null,
                icon_name: appInfo ? null : 'application-x-executable-symbolic',
                pixel_size: 32,
            }));

            const spin = new Gtk.SpinButton({
                valign: Gtk.Align.CENTER,
                adjustment: new Gtk.Adjustment({
                    lower: 1,
                    upper: 36,
                    step_increment: 1,
                }),
                tooltip_text: 'Target workspace number',
            });
            spin.set_value(workspace + 1);
            spin.connect('value-changed', () => {
                const updated = parseEntries(settings)
                    .map(e => e.appId === appId ? { appId, workspace: spin.get_value_as_int() - 1 } : e);
                const compacted = compactWorkspaces(updated);
                saveEntries(settings, compacted);
                // Values only (no rows added/removed): update spin buttons
                // in place instead of rebuilding, so focus isn't lost.
                syncSpinValues(compacted);
            });
            row.add_suffix(spin);

            const removeButton = new Gtk.Button({
                icon_name: 'user-trash-symbolic',
                valign: Gtk.Align.CENTER,
                css_classes: ['flat'],
                tooltip_text: 'Remove',
            });
            removeButton.connect('clicked', () => {
                const compacted = compactWorkspaces(parseEntries(settings).filter(e => e.appId !== appId));
                saveEntries(settings, compacted);
                rebuildRows();
            });
            row.add_suffix(removeButton);

            return { row, spin };
        };

        const rebuildRows = () => {
            for (const { row } of rows.values())
                appsGroup.remove(row);
            rows.clear();

            for (const entry of parseEntries(settings)) {
                const built = buildRow(entry);
                appsGroup.add(built.row);
                rows.set(entry.appId, built);
            }
        };

        addButton.connect('clicked', () => {
            const existing = parseEntries(settings);
            const excludeIds = new Set(existing.map(e => e.appId));
            showAppPicker(window, excludeIds, appId => {
                // Default to a fresh workspace after the last one in use.
                const nextWorkspace = new Set(existing.map(e => e.workspace)).size;
                const compacted = compactWorkspaces([...existing, { appId, workspace: nextWorkspace }]);
                saveEntries(settings, compacted);
                rebuildRows();
            });
        });

        rebuildRows();
    }
}
