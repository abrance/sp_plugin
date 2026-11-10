/** Scoped logger. Set `DEBUG` once per plugin so released builds stay quiet. */
export interface Logger {
  debug(...args: unknown[]): void;
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
}

export function createLogger(scope: string, debug = false): Logger {
  const tag = `[${scope}]`;
  return {
    debug: (...args) => {
      if (debug) console.log(tag, ...args);
    },
    info: (...args) => console.log(tag, ...args),
    warn: (...args) => console.warn(tag, ...args),
    error: (...args) => console.error(tag, ...args),
  };
}
