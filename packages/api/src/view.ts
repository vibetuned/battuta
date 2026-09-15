/**
 * The view host service: what a plugin may do to the NOTATION on screen.
 * Today, one thing — light events in page view as they sound, following
 * the music when the playing measure leaves the window. The host owns the
 * SVG; a plugin names ids (engraved ones — the page contains no clones).
 */
export interface HighlightCue {
  /** Engraved ids to light now. */
  on: readonly string[];
  /** Engraved ids to unlight now. */
  off: readonly string[];
  /** The measure starting now: the view scrolls to it when it is off screen. */
  measureOn?: string;
}

export interface ViewService {
  /** Apply one cue. A no-op in tile view and with no document open. */
  highlight(cue: HighlightCue): void;
  /** Unlight everything — stop, seek, an edit. */
  clearHighlight(): void;
}
