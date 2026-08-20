# Auto-Move Windows on Startup with Dynamic Workspace

[![ko-fi](https://img.shields.io/badge/Support%20me%20on%20Ko--fi-F16061?style=flat&logo=ko-fi&logoColor=white)](https://ko-fi.com/ibg019)

[Extension Homepage](https://extensions.gnome.org/extension/10639/auto-move-windows-on-startup-with-dynamic-workspac/)


Auto-Move Windows on Startup with Dynamic Workspace is a GNOME Shell extension that moves selected applications to chosen workspaces during startup. It is designed for setups that use dynamic workspaces and want certain apps placed automatically when the session begins.

## Status

The extension has been tested on GNOME Shell 48. The metadata declares compatibility with GNOME Shell 45 through 48, but versions other than 48 have not been verified by me.

## Features

- Moves selected app windows to their workspace at startup.
- Works with GNOME Shell dynamic workspaces.
- Provides a preferences window to add, remove, and assign a target workspace to each tracked application.

## Installation

Install the extension into your local GNOME Shell extensions directory, then enable it with GNOME Extensions or the GNOME Shell extension tools.

If you are testing the extension directly from this source tree, make sure the schema is compiled before starting GNOME Shell:

```sh
glib-compile-schemas schemas/
```

## Configuration

Open the extension preferences and add the applications you want tracked. Each application is assigned a workspace number, starting at 1 in the UI.

Please note, gaps are not allowed in workspace assignment.

Example of valid configuration:

```text
App1: Workspace 1
App2: Workspace 2
App3: Workspace 3
```

Example of invalid configuration:

```text
App1: Workspace 1
App2: Workspace 3
App3: Workspace 4
```

The extension stores its settings in the schema `org.gnome.shell.extensions.auto-move-windows-startup-dynamic-workspace`.

## Build And Check

This project does not use a separate build system. The main validation step is compiling the GSettings schema:

```sh
glib-compile-schemas schemas/
```

After changing the JavaScript code, restart GNOME Shell or log out and back in to reload the extension.

## License

This project is licensed under the GNU General Public License, version 3. See `COPYING` for the full text.

## Contributing

Please make a GitHub issue.
