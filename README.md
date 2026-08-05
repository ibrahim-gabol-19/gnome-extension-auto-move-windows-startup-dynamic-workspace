# Auto Setup Windows

Auto Setup Windows is a GNOME Shell extension that moves selected applications to chosen workspaces during startup. It is designed for setups that use dynamic workspaces and want certain apps placed automatically when the session begins.

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

The extension stores its settings in the schema `org.gnome.shell.extensions.auto-setup-windows`.

## Build And Check

This project does not use a separate build system. The main validation step is compiling the GSettings schema:

```sh
glib-compile-schemas schemas/
```

After changing the JavaScript code, restart GNOME Shell or log out and back in to reload the extension.

## License

This project is licensed under the GNU General Public License, version 3. See `COPYING` for the full text.
