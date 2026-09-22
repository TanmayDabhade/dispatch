import { describe, expect, it } from 'bun:test';

import { parseFanoutArgs } from '../src/commands/fanout.js';
import { CliError } from '../src/context.js';

describe('parseFanoutArgs', () => {
  it('splits a comma-separated list', () => {
    expect(parseFanoutArgs('claude,codex', [])).toEqual([
      { executor: 'claude' },
      { executor: 'codex' },
    ]);
  });

  it('tolerates spaces and trailing commas', () => {
    expect(parseFanoutArgs(' claude , codex ,', [])).toEqual([
      { executor: 'claude' },
      { executor: 'codex' },
    ]);
  });

  it('pins a model to one agent without naming one for the rest', () => {
    // The two lists are not the same length, which is why the model syntax
    // names its executor rather than relying on position.
    expect(parseFanoutArgs('claude,codex', ['codex=gpt-5.5'])).toEqual([
      { executor: 'claude' },
      { executor: 'codex', model: 'gpt-5.5' },
    ]);
  });

  it('accepts several model pins', () => {
    expect(
      parseFanoutArgs('claude,codex', ['claude=opus', 'codex=gpt-5.5'])
    ).toEqual([
      { executor: 'claude', model: 'opus' },
      { executor: 'codex', model: 'gpt-5.5' },
    ]);
  });

  it('rejects an empty executor list', () => {
    expect(() => parseFanoutArgs('', [])).toThrow(CliError);
    expect(() => parseFanoutArgs(' , ', [])).toThrow(CliError);
  });

  it('rejects a malformed model pin', () => {
    expect(() => parseFanoutArgs('claude', ['gpt-5.5'])).toThrow(CliError);
    expect(() => parseFanoutArgs('claude', ['=gpt-5.5'])).toThrow(CliError);
  });

  it('rejects a model for an agent that is not being run', () => {
    // Silently ignoring it would leave the user thinking they pinned a model.
    expect(() => parseFanoutArgs('claude', ['codex=gpt-5.5'])).toThrow(
      CliError
    );
  });
});
