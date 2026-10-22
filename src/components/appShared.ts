import type { PrintUnit } from '../state/project';
import { detectRuntime } from '../state/runtime';
import type { Message } from '../i18n';

/** Runtime tier for the triangle budgets (web, or an Electron-like desktop shell). */
export const RUNTIME = detectRuntime();

export const triangleCount = (unit: PrintUnit) => unit.source.indices.length / 3;

export const isAbort = (error: unknown) => error instanceof Error && error.name === 'AbortError';

/** The app's status line setter: a message key with its variables, or a plural pair. */
export type SetStatus = (key: string, vars?: Message['vars'], other?: string) => void;
