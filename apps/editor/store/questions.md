# Store questions and tags

> The forms App Store Connect and the Google Play Console ask to fill in,
> answered from what the app does. The listing texts are in
> [listing.md](listing.md); building in the README's *Tablets and phones*
> section. The stores reword their forms from time to time: answer a question
> asked differently from the same facts.

## The facts the answers rest on

| | battuta |
|---|---|
| Accounts, sign-in | None |
| Personal data collected or shared | None — everything stays on the device ([privacy](https://battuta.vibetuned.com/reference/privacy/)) |
| Advertising, tracking, analytics, crash reporting | None |
| Purchases, subscriptions | None — free |
| User-generated content shared with other users, chat | None — scores are files on the device; the user sends one elsewhere only through the system share sheet |
| Network | None. The app makes no network request: Verovio, the piano samples and the fonts ship inside it, and it opens no links |
| Device features | Bluetooth, only to connect a MIDI instrument the user picks (iOS: Apple's Bluetooth MIDI view; Android: a scan for Bluetooth MIDI devices); on Android 8–11 the location permission, only because a Bluetooth scan needs it there. USB MIDI needs no permission |
| Background mode (iOS) | Audio — required to create the virtual MIDI source other apps receive playback from |
| Microphone, camera, photos, location data, contacts, notifications | Not used (the pitch reference reads a recording the user picks as a file) |
| Encryption | None at all — exempt |
| Third-party content | Verovio (LGPL v3), the Salamander piano samples (CC BY 3.0), Noto Music (OFL), pdf.js (Apache 2.0) and the libraries listed in the app (battuta menu → *about battuta*) |
| Content | A music notation editor: no violence, language, sexual content, drugs, gambling or horror |
| Devices | iPhone and iPad from iOS / iPadOS 15; Android phones and tablets from Android 7.0 (API 24). Reading a PDF in the PDF reference needs iOS / iPadOS 26.2 (its PDF library); before that the panel says so and takes the pages as images |

## App Store Connect

### App information

| Field | Answer |
|---|---|
| Name / subtitle | battuta / Music notation editor (MEI) |
| Bundle ID | `com.vibetuned.battuta` (one for every platform) |
| Primary category / secondary | Music / Education |
| Content rights — *does the app contain, show or access third-party content?* | **Yes** — and *do you have the rights?* **Yes**: open licences (LGPL, CC BY, OFL, Apache, MIT and the like), credited in the app |
| Copyright | © 2026 Vibetuned |
| Privacy policy URL | https://battuta.vibetuned.com/reference/privacy/ |
| Support URL / marketing URL | https://github.com/vibetuned/battuta/issues / https://battuta.vibetuned.com/ |
| Export compliance | No encryption (`ITSAppUsesNonExemptEncryption = false` in `Info.ios.plist`; no question at upload) |
| Privacy manifest | `PrivacyInfo.xcprivacy` in the app: no tracking, no data collected; reasons given for the user defaults (CA92.1) and file timestamps (C617.1, 3B52.1) |

### Age rating

Every question **None** or **No** — expected rating **4+**.

| Group | Questions | Answer |
|---|---|---|
| In-app controls | Parental controls; age assurance | No |
| Capabilities | Unrestricted web access | **No** (no browser, no links opened) |
| | User-generated content; messaging and chat; advertising | No |
| Mature themes | Profanity or crude humour; horror or fear themes; alcohol, tobacco or drug use or references | None |
| Medical or wellness | Medical or treatment information; health or wellness topics | None / No |
| Sexuality or nudity | Mature or suggestive themes; sexual content or nudity; graphic sexual content and nudity | None |
| Violence | Cartoon or fantasy; realistic; prolonged, graphic or sadistic; guns or other weapons | None |
| Chance-based activities | Simulated gambling; gambling; contests; loot boxes | None / No |
| Made for Kids | — | No |

### App privacy

| Question | Answer |
|---|---|
| Do you or your third-party partners collect data from this app? | **No, we do not collect data from this app** — label: *Data Not Collected* |
| Does the app track users? | No |

### Accessibility (Accessibility Nutrition Labels)

Claim only what is checked on a device. Today nothing is claimed: VoiceOver,
Voice Control, Larger Text, Dark Interface, Differentiate Without Color Alone,
Sufficient Contrast, Reduced Motion, Captions, Audio Descriptions — not claimed
until tested.

### Pricing and availability

Free, no in-app purchases; every country (or Vibetuned's choice). iPhone and
iPad.

### App Review information

Sign-in required: **No**. Contact: Vibetuned (name, phone and email as for
Vibetuned's other apps). Notes:

> battuta is a music notation editor for MEI files. No account is needed, no
> data is collected, and the app makes no network connection.
>
> To try it without an instrument: the app opens on an empty score with the
> on-screen keyboard. Tap **INPUT** in the bar at the bottom, then tap keys on
> the piano — each tap writes a note (the digit keys pick its duration); ⌫
> erases. **page view** in the header shows the engraved pages, and ▶ plays
> the score.
>
> Files: scores are saved in battuta's own folder (Files app → On My iPhone /
> iPad → battuta); the battuta menu opens any file, saves a copy anywhere, and
> shares a score through the share sheet.
>
> Bluetooth: **MIDI** at the bottom right lists the instruments, and its
> *Bluetooth MIDI…* opens Apple's Bluetooth MIDI view to connect one; that is
> the only use of Bluetooth. The audio background mode is there because iOS
> creates a virtual MIDI source — the one other music apps receive battuta's
> playback from — only for an app that has it.
>
> Music notation is engraved by Verovio (LGPL v3, © RISM Digital Center),
> credited in the description and in the app (battuta menu → about battuta).

### Version information

| Field | Text |
|---|---|
| Promotional text (170) | Write music the way you write text: a caret, a selection, undo that always lands, and an MEI file that stays yours. Free and open source, with no account and no tracking. |
| Description | [listing.md](listing.md) — with the Verovio credit |
| Keywords (100) | see *Tags and keywords* below |
| What's New | battuta on iPhone and iPad: write, edit and play MEI scores by touch or with a MIDI instrument over USB or Bluetooth, with your scores in the Files app. |
| Screenshots | iPhone 6.9″ and iPad 13″ ([listing.md](listing.md#screenshots)) |

## Google Play Console

### Store settings

| Field | Answer |
|---|---|
| App or game | App |
| Category | Music & Audio |
| Tags (up to 5, from Play's list) | see *Tags and keywords* below |
| Contact email / website | Vibetuned's (as for its other apps) / https://battuta.vibetuned.com/ |

### Main store listing

App name, short description (80) and full description (4000):
[listing.md](listing.md). Graphics: the icon at 512 × 512 (from the logo, as
the launcher icons are), the feature graphic and screenshots
([listing.md](listing.md#screenshots)).

### App content

| Declaration | Answer |
|---|---|
| Privacy policy | https://battuta.vibetuned.com/reference/privacy/ |
| Ads | **No**, the app contains no ads |
| App access | **All functionality is available without special access** (no login). Note for review: a MIDI instrument is optional — the on-screen keyboard writes notes by touch |
| Content rating (IARC) | see below |
| Target audience and content | Vibetuned's choice. Age groups 13–15, 16–17 and 18+ keep the app outside the Families policy; choosing a younger group brings that policy's requirements. *Appeals to children*: answer honestly |
| News app; government app; health app | No |
| Financial features | None |
| Advertising ID | Not used (no ads, no analytics) |
| Data safety | see below |

### Content rating (IARC questionnaire)

| Question | Answer |
|---|---|
| Category | **Utility, Productivity, Communication, or Other** |
| Violence; fear; sexuality; language; controlled substances; crude humour; gambling | No |
| Does the app let users interact or exchange content with other users? | No (a score sent through the system share sheet goes to another app the user picks, not to battuta's users) |
| Does it share the user's physical location with other users? | No |
| Can users buy digital goods? | No |
| Unrestricted internet access (a browser, open web)? | No |
| Expected | Everyone · PEGI 3 · USK 0 · ClassInd L |

### Data safety

| Question | Answer |
|---|---|
| Does the app collect or share any of the required user data types? | **No** |
| Is all user data encrypted in transit? | Asked only if data were collected |
| Account creation | The app has no accounts |
| Data deletion | Not applicable: nothing is collected; the device's data goes with the app |
| Independent security review | No |

Bluetooth and the location permission (Android 8–11) are used on the device to
connect an instrument; nothing is sent anywhere, so neither counts as
*collected*. The internet permission comes with Tauri's Android template;
nothing in the app uses it.

### Release notes

> battuta on Android: write, edit and play MEI scores by touch or with a MIDI
> instrument over USB or Bluetooth.

## Tags and keywords

**App Store keywords** (100 characters, comma-separated, no spaces after
commas; the name and the category count already, so they are left out):

```
notation,sheet music,score,composer,MEI,MusicXML,midi,piano,transcription,arranging,engraving
```

Other words worth rotating in: `composition`, `music theory`, `lyrics`,
`chords`, `roman numerals`, `transpose`, `ABC`, `Humdrum`.

**Google Play tags** — Play offers a fixed list per category; pick the five
closest to:

1. Sheet music / music notation
2. Music composition
3. Music education
4. MIDI
5. Piano

**Google Play search** reads the title and the short and full descriptions:
the full description in [listing.md](listing.md) already says *notation, MEI,
MIDI, Bluetooth, keyboard, chord symbols, Roman numerals, repeats, playback,
PDF, MusicXML, ABC, Humdrum* in its sentences — keep it that way: Play's policy
forbids keyword lists in a description.
