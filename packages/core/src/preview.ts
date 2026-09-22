// How a run's worktree gets turned into a running app: which package manager
// the checkout uses, and what command starts its dev server on a port the
// daemon picked. Pure — the server owns reading package.json and the lockfile
// and hands the contents in, the same split team.ts uses.

/** The package managers a checkout's lockfile can name. */
export type PackageManager = 'pnpm' | 'npm' | 'yarn' | 'bun';

// Lock file to package manager. Ordered most-specific first only for
// readability; the lookup is exact, so order does not affect the result.
const LOCK_FILES: ReadonlyArray<readonly [string, PackageManager]> = [
  ['pnpm-lock.yaml', 'pnpm'],
  ['bun.lockb', 'bun'],
  ['bun.lock', 'bun'],
  ['yarn.lock', 'yarn'],
  ['package-lock.json', 'npm'],
];

/**
 * Which package manager a checkout uses, from the lock files present at its
 * root. Defaults to npm when none is found: every Node checkout understands
 * `npm run`, so a wrong guess still starts something, where refusing would
 * leave a project that could have been previewed with no preview at all.
 *
 * `filenames` is the worktree root's directory listing, not paths.
 */
export function detectPackageManager(
  filenames: readonly string[]
): PackageManager {
  const present = new Set(filenames);
  for (const [file, manager] of LOCK_FILES) {
    if (present.has(file)) return manager;
  }
  return 'npm';
}

/**
 * How a dev tool is told which port to bind.
 *
 * A proxied preview has to land on the port the daemon allocated and nowhere
 * else, which is why this matters more than it looks: a dev server that finds
 * its port busy and quietly moves to the next one would leave the proxy
 * pointing at nothing. Vite takes `--strictPort` to make that a startup
 * failure instead; the others are matched on their own flag.
 *
 * Anything unrecognized falls through to the `PORT` environment variable,
 * which react-scripts, remix, nuxt and most hand-rolled servers read.
 */
const PORT_FLAGS: ReadonlyArray<readonly [RegExp, (port: number) => string]> = [
  // `\b` on both sides so "vitest" never matches "vite".
  [/\bvite\b/, (port) => `--port ${port} --strictPort`],
  [/\bnext\b/, (port) => `--port ${port}`],
  [/\bastro\b/, (port) => `--port ${port}`],
  [/\bng\b|\bangular\b/, (port) => `--port ${port}`],
  [/\bwebpack(-dev-server)?\b/, (port) => `--port ${port}`],
];

/** The flag string a dev script needs to bind `port`, or null when the tool is
 *  unrecognized and `PORT` in the environment is the only lever. */
function portFlagsFor(devScript: string, port: number): string | null {
  for (const [pattern, render] of PORT_FLAGS) {
    if (pattern.test(devScript)) return render(port);
  }
  return null;
}

/** What `detectPreviewCommand` found. The script name rides along with the
 *  command so a surface can say which one it picked — "started from `dev`"
 *  answers the first question anyone asks when a preview does the wrong
 *  thing. */
export interface DetectedPreview {
  /** The shell command that starts the dev server, bound to the port. */
  command: string;
  /** The script name it was built from, for the reason line a UI shows. */
  script: string;
}

/**
 * The command that starts this checkout's dev server on `port`, or null when
 * its package.json names no dev script.
 *
 * `dev` is preferred over `start` because `start` is as often a production
 * server as a dev one, and a preview wants the hot-reloading variant: the
 * whole point is that an agent's next edit shows up in the iframe.
 *
 * Extra flags go after `--` so the package manager forwards them to the script
 * rather than eating them itself. npm needs that separator; pnpm, yarn and bun
 * accept it too, so one form covers all four.
 */
export function detectPreviewCommand(
  scripts: Record<string, string> | undefined,
  manager: PackageManager,
  port: number
): DetectedPreview | null {
  const name = ['dev', 'start'].find(
    (key) => typeof scripts?.[key] === 'string' && scripts[key].trim() !== ''
  );
  if (name === undefined || scripts === undefined) return null;

  const flags = portFlagsFor(scripts[name], port);
  const base = `${manager} run ${name}`;
  return {
    command: flags === null ? base : `${base} -- ${flags}`,
    script: name,
  };
}

/**
 * The environment a preview command runs with.
 *
 * `PORT` is the fallback channel for every dev tool `PORT_FLAGS` does not
 * recognize. `HOST` pins the server to loopback so a preview is never exposed
 * beyond the machine the daemon runs on — the same promise the daemon itself
 * makes. `BROWSER=none` stops react-scripts and friends opening a browser
 * window on a machine whose user did not ask for one.
 */
export function previewEnv(port: number): Record<string, string> {
  return {
    PORT: String(port),
    HOST: '127.0.0.1',
    BROWSER: 'none',
    // So a project's own config can tell it is running as a preview.
    DISPATCH_PREVIEW: '1',
  };
}
