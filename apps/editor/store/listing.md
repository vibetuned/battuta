# Store listing — App Store and Google Play

> The texts of battuta's listings on iPhone, iPad and Android (phase 10,
> [PLANNING.md](../../../PLANNING.md)). Every form the two stores ask to fill
> in is answered in [questions.md](questions.md). Verovio's licence (LGPL-3.0)
> asks for visible attribution in the stores' metadata: the credit paragraph
> below goes in both full descriptions, and the app carries the full notices
> (battuta menu → *about battuta*).

## Names

| | App Store | Google Play |
|---|---|---|
| Name (30 max) | battuta | battuta |
| Subtitle (30 max) / short description (80 max) | Music notation editor (MEI) | Write and edit sheet music in MEI. Free, open source, offline, no account. |
| Category | Music (secondary: Education) | Music & Audio |
| Price | Free, no in-app purchases | Free, no in-app purchases, no ads |

battuta is lower-case everywhere, as on the website and in the app.

## Full description

The same text for both stores (under 4,000 characters, Google Play's limit;
the App Store's is the same). The sentence on files differs: the App Store's
first, Google Play's in brackets.

> battuta is a music notation editor that works the way a text editor does: a
> caret that walks through the notes, a selection, copy and paste, and undo
> that always lands. Your score is an MEI file, the open format of the Music
> Encoding Initiative, and it stays yours.
>
> • Write music by touch with the on-screen keyboard, from a hardware
>   keyboard, or by playing a MIDI instrument connected by USB or Bluetooth.
>   Accidentals follow the key signature, and what you enter always adds up to
>   a full measure.
> • Arrange in blocks: select measures and staves, copy them, paste them into
>   another staff or another score, transpose them.
> • Ties, slurs, articulations, ornaments, dynamics, hairpins, pedal and
>   fingering; tuplets and grace notes; lyrics, chord symbols and Roman
>   numerals.
> • Repeats, voltas, segno and coda — and playback that takes the jumps you
>   wrote, on the built-in piano or on your own MIDI instrument or app.
> • Transcribe with a PDF of the original beside the score, or with a
>   recording's pitch traced over it.
> • Open MusicXML, ABC, Humdrum and Plaine & Easie; export SVG pages, MIDI,
>   Humdrum and Plaine & Easie. Page view shows the score engraved as printed
>   pages.
> • Your scores live in battuta's own folder in the Files app, or in any
>   folder you pick, iCloud Drive included; the share sheet sends a score or
>   an export anywhere. *(Google Play: Your scores live in battuta's own
>   folder, or in any folder you pick; the share sheet sends a score or an
>   export anywhere.)*
>
> battuta is made in the open by Vibetuned, a non-profit for music and arts
> education. It is free software (GNU AGPL v3): no account, no ads, no
> tracking, and it never connects to the internet — nothing you write leaves
> your device. The source is at github.com/vibetuned/battuta.
>
> **Music notation is engraved by Verovio (verovio.org), © RISM Digital
> Center, used under the GNU LGPL v3.** Piano samples from the Salamander
> Grand Piano (Alexander Holm; CC BY 3.0). PDF display by pdf.js (Mozilla;
> Apache License 2.0).

**URLs**: support `https://github.com/vibetuned/battuta/issues` · marketing
`https://battuta.vibetuned.com/` · privacy policy
`https://battuta.vibetuned.com/reference/privacy/`
([`privacy.mdx`](../../../docs/src/content/docs/reference/privacy.mdx)).

The App Store's promotional text, keywords and *What's New*, and Google Play's
tags and release notes: [questions.md](questions.md).

## Privacy answers

What the app does: everything stays on the device — scores in battuta's
folder or in the folders the user picks, the open tabs, settings and keymap
in the WebView's storage, and on iOS the bookmarks that reopen a picked
folder. No account, no analytics, no advertising, no tracking. The app makes
no network request at all: Verovio, the piano samples and the fonts ship
inside it. Bluetooth is used only to connect a MIDI instrument the user picks;
files leave the app only through the share sheet or a save the user makes.

- **App Store privacy label**: Data Not Collected.
- **Google Play data safety**: no data collected, no data shared.
- **Permissions**: Bluetooth / nearby devices (Android 12+); the location on
  Android 8–11 only (a Bluetooth scan needs it there, `maxSdkVersion 30`);
  internet — declared by Tauri's Android template and used by nothing in the
  app.

## Screenshots

`npm run store:screenshots` (`scripts/store-screenshots.mjs`) makes them
from the app itself, into `store/screenshots/` (not kept in git), each set
as that device sees the app — its shell, a touch screen, its width: writing
at the caret with the on-screen keyboard; page view playing; a block
selected; a PDF's scans over the measures to transcribe; the folder view
(its list staged — a browser has no folder; the panel is the app's).

| Folder | Size | For |
|---|---|---|
| `ios-iphone-6.9/` | 1320 × 2868 | App Store, iPhone 6.9″, upright (the smaller iPhones are scaled from it) |
| `ios-ipad-13/` | 2752 × 2064 | App Store, iPad 13″, sideways |
| `android-phone/` | 1080 × 1920 | Google Play, phone, upright |
| `android-tablet/` | 2560 × 1440 | Google Play, 7″ and 10″ tablets, sideways |
| `google-play/feature-graphic.png` | 1024 × 500 | Google Play's feature graphic |
| `google-play/icon.png` | 512 × 512 | Google Play's icon, from the logo |

The apps' own icons come with the builds (`src-tauri/icons/mobile/`, from
the logo).

## Content ratings

No violence, no user-generated content shared with other users, no purchases,
no chat, no web browsing. Expected: App Store 4+, Google Play *Everyone*
(IARC). The questionnaires, answered: [questions.md](questions.md).
