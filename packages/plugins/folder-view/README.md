# Folder view

Work through a folder of scores without the open dialog. Click the **📁**
in the header, choose a folder, and its scores are listed down the side:
click one to open it; the score in the active tab is highlighted, and
an open score carries a `*` when it has unsaved changes, the same
marker the tab shows. Sub-folders open in place, so a folder of cantatas
with a folder per work behaves the way you would expect. The list
**follows the folder**: a score someone adds, renames or deletes appears
or disappears without a refresh, and a file you have open that changes
underneath you is announced at once.

The folder you opened comes back the next time you start battuta.

## Turning it on and off

battuta menu → 🌣 shortcuts → **plugins** → *Folder view*. Off
deactivates it at once: the 📁 and the panel go together, and battuta
stops watching the folder. **Nothing about your scores changes** — this
plugin only ever reads, and the folder it remembers is remembered again
if you turn it back on.

## Keys

None. The 📁 in the header opens and closes the panel, and the panel's ×
closes it.

## Settings and storage

| Key | Where | Meaning |
| --- | --- | --- |
| `folder` | settings | The folder you opened, as a full path. It is re-opened at startup — and that is what brings the panel back, so closing the panel is for this session only. |
| — | storage | nothing |

## What it does not do

- **It needs the desktop app.** A browser tab cannot be handed a folder
  to read, so the panel says so and offers nothing it could not honour.
- **It lists `.mei` only, for now.** battuta opens MusicXML, ABC, Plaine
  & Easie and Humdrum too (through [format
  converters](../formats/)), but the list of extensions that are
  currently openable lives in the editor and is not yet something a
  plugin can ask for. `BUILDING.md` §7.1 has the detail; **you can still
  open those files** through *open file…* as always.
- **It reads, and never writes.** No rename, no delete, no new folder,
  no drag-and-drop. Saving is the editor's, through the paths it always
  used.
- **It sees only the folder you picked.** battuta asks the system for
  that folder and nothing else, and every read and watch outside it is
  refused — there is no "open any file on disk" permission behind this.
- **One folder at a time.** Choosing another replaces the list.
- **Hidden files and folders are skipped**, and so is anything that is
  not a score or a folder.

## Guide

[Folder view](../../../docs/src/content/docs/guide/folder-view.mdx) in
the user guide.
