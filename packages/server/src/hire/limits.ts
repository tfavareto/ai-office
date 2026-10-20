// Limits of the hire endpoints.
/** Terminal launches per window: opening windows is the one thing this endpoint does, so it is kept slow on purpose. */
export const HIRE_LAUNCH_LIMIT = 5;
export const HIRE_LAUNCH_WINDOW_MS = 60_000;
/** Folder checks (path field feedback) per window. */
export const HIRE_CHECK_LIMIT = 120;
export const HIRE_CHECK_WINDOW_MS = 60_000;
