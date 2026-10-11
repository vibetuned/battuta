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
stops watching the folder. **Nothing about your scores changes** — apart
from the names you gave and the scores and folders you made, this plugin
only ever reads — and the
folder it remembers is remembered again if you turn it back on.

## Renaming

Point at a row and click its **✎**, or select the row and press **F2**:
the name becomes a field. **Enter** or clicking away renames, **Esc**
cancels. A score is edited without its extension and keeps `.mei`; a
folder is renamed as typed and stays open. An open tab follows its file —
new name, new path to save to. A name that exists, an empty one, one with
a separator or one starting with a dot is refused with a notice.

## New scores and folders

**+ score** and **+ folder** in the header create in the target folder:
the last folder clicked, or the folder of the last score opened — the top
folder until then. The target is marked with a blue bar at the left of
its row (beside the folder's name in the header when it is the top
folder), and hovering a button names it. A field opens first
inside that folder; Enter or clicking away creates, Esc cancels. A new
score is a blank one (treble staff, 4/4, four empty measures, titled
after its name), saved as `.mei` and opened at once in a tab. A new
folder appears open and empty and becomes the target, so the next score
goes in it. An existing name is refused — nothing is overwritten.

## Keys

None in the keymap. The 📁 in the header opens and closes the panel, and
the panel's × closes it. **F2** on a focused row renames it — a key the
row handles itself, so it is not a binding and does not appear in the
shortcut editor.

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
- **Its writes are rename and create, nothing else.** No delete, no
  overwrite, no moving between folders, no drag-and-drop, and the folder
  you opened cannot itself be renamed from here. A score keeps its `.mei` —
  the type does not change here. Saving is the editor's, through the
  paths it always used.
- **It sees only the folder you picked.** battuta asks the system for
  that folder and nothing else, and every read, watch, rename and create
  outside it is refused — there is no "open any file on disk" permission behind this.
- **One folder at a time.** Choosing another replaces the list.
- **Hidden files and folders are skipped**, and so is anything that is
  not a score or a folder.

## Guide

[Folder view](../../../docs/src/content/docs/guide/folder-view.mdx) in
the user guide.
