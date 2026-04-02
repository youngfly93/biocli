/**
 * Lightweight terminal spinner — zero dependencies.
 *
 * Shows a cycling animation (⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏) with an optional message
 * while async work is in progress. Clears itself when stopped.
 */

const FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
const INTERVAL_MS = 80;

export interface Spinner {
  /** Update the spinner message while running. */
  update(message: string): void;
  /** Stop and clear the spinner line. */
  stop(): void;
}

/**
 * Start a spinner. Returns a handle to stop it.
 *
 * Only activates when stderr is a TTY — in pipes / CI it becomes a no-op
 * so output stays clean.
 */
export function startSpinner(message: string): Spinner {
  // No-op in non-TTY environments (piped output, CI, etc.)
  if (!process.stderr.isTTY) {
    return { update() {}, stop() {} };
  }

  let frame = 0;
  let text = message;

  const timer = setInterval(() => {
    const line = `\r  ${FRAMES[frame % FRAMES.length]} ${text}`;
    process.stderr.write(line);
    frame++;
  }, INTERVAL_MS);

  return {
    update(msg: string) {
      text = msg;
    },
    stop() {
      clearInterval(timer);
      // Clear the spinner line
      process.stderr.write('\r' + ' '.repeat((text.length || 0) + 6) + '\r');
    },
  };
}
