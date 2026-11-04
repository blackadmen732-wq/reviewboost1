/**
 * The owner's Light/Dark/System choice, shared by the root layout (which
 * applies it before paint) and the Theme Control in Settings (which sets it).
 *
 * Plain module on purpose: the layout is a server component, and a constant
 * exported from a "use client" file reaches it as a client reference, not as
 * the string.
 */

export type ThemeChoice = "light" | "dark" | "system";

export const THEME_STORAGE_KEY = "rb-theme";

/** Runs in <head> before paint. Kept tiny, and it must never throw. */
export const THEME_BOOT_SCRIPT = `try{var t=localStorage.getItem("${THEME_STORAGE_KEY}");if(t==="light"||t==="dark")document.documentElement.dataset.theme=t}catch(e){}`;
