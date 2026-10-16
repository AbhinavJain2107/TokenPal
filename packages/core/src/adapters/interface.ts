import { ParseResult } from '../types.js';

export interface AgentAdapter {
  readonly id: string;
  readonly name: string;

  /**
   * Checks whether this adapter can process the given file path.
   */
  canHandle(filePath: string): boolean;

  /**
   * Discovers default log directories to watch.
   */
  getDefaultWatchDirs(): string[];

  /**
   * Incrementally parses new bytes from the file starting from byte offset.
   * Tolerates partial lines (buffering incomplete line for next read).
   * Tolerates unknown event types and extra fields.
   * If format is unrecognised / invalid, returns ParseResult with error = "unsupported version".
   */
  parseIncremental(filePath: string, startOffset: number): Promise<ParseResult>;
}
