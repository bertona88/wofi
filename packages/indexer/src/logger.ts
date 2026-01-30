import type { Logger } from './types.js'

export function createLogger(opts?: { json?: boolean }): Logger {
  const json = opts?.json === true
  if (json) {
    return {
      debug: (message, meta) => console.debug(JSON.stringify({ level: 'debug', message, ...meta })),
      info: (message, meta) => console.info(JSON.stringify({ level: 'info', message, ...meta })),
      warn: (message, meta) => console.warn(JSON.stringify({ level: 'warn', message, ...meta })),
      error: (message, meta) => console.error(JSON.stringify({ level: 'error', message, ...meta }))
    }
  }
  return {
    debug: (message, meta) => console.debug(message, meta ?? ''),
    info: (message, meta) => console.info(message, meta ?? ''),
    warn: (message, meta) => console.warn(message, meta ?? ''),
    error: (message, meta) => console.error(message, meta ?? '')
  }
}
