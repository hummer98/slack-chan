export const EXIT_OK = 0 as const;
export const EXIT_USER_ERROR = 1 as const;
export const EXIT_TRANSIENT = 2 as const;
export const EXIT_INTERNAL = 3 as const;

export type ExitCode =
  | typeof EXIT_OK
  | typeof EXIT_USER_ERROR
  | typeof EXIT_TRANSIENT
  | typeof EXIT_INTERNAL;
