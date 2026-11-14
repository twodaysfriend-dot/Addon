/** Bedrock supplies console at runtime, independently of browser DOM APIs. */
declare const console: {
  warn(...values: unknown[]): void;
  error(...values: unknown[]): void;
};
