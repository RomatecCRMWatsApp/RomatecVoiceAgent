// Side-effect-only module: patches console.{log,warn,error,info} once at import
// time to prefix every line with [HH:MM BRT] in America/Fortaleza, regardless of
// the system TZ (Railway containers default to UTC). Import this FIRST in
// server.ts, before any module-level code that might log.

const fmt = new Intl.DateTimeFormat('pt-BR', {
  timeZone: 'America/Fortaleza',
  hour:     '2-digit',
  minute:   '2-digit',
  hour12:   false,
});

function stamp(): string {
  return `[${fmt.format(new Date())} BRT]`;
}

(['log', 'warn', 'error', 'info'] as const).forEach((method) => {
  const original = console[method].bind(console);
  console[method] = (...args: unknown[]): void => {
    original(stamp(), ...args);
  };
});
