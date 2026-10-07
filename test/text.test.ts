import { describe, expect, it } from 'vitest';
import { extractNumbers, normalize, quoteAppearsIn } from '../src/text';

describe('normalize', () => {
  it('ignores case, currency symbols, markdown and thousands separators', () => {
    expect(normalize('**$1,240** Employees')).toBe('1240 employees');
  });

  it('treats smart quotes and dashes like plain ones', () => {
    expect(normalize('It\u2019s a \u201cfull\u201d year \u2013 2025')).toBe('it\'s a "full" year - 2025');
  });

  it('does not strip commas that are not thousands separators', () => {
    expect(normalize('Austin, Texas')).toBe('austin, texas');
  });
});

describe('quoteAppearsIn', () => {
  const doc = 'Acme reported revenue of $412.3 million for the quarter. Headcount was 1,240 at year end.';

  it('accepts a verbatim quote', () => {
    expect(quoteAppearsIn('Acme reported revenue of $412.3 million for the quarter.', doc)).toBe(true);
  });

  it('ignores formatting differences', () => {
    expect(quoteAppearsIn('ACME REPORTED REVENUE OF 412.3 MILLION FOR THE QUARTER', doc)).toBe(true);
  });

  it('accepts an ellipsis when every kept segment is real', () => {
    expect(quoteAppearsIn('Acme reported revenue ... for the quarter.', doc)).toBe(true);
  });

  it('rejects a fabricated number', () => {
    expect(quoteAppearsIn('Acme reported revenue of $999.9 million for the quarter.', doc)).toBe(false);
  });

  it('rejects an ellipsis that hides a fabricated segment', () => {
    expect(quoteAppearsIn('Acme reported revenue ... and doubled its dividend.', doc)).toBe(false);
  });

  it('rejects quotes too short to prove anything', () => {
    expect(quoteAppearsIn('the quarter', doc)).toBe(false);
  });
});

describe('extractNumbers', () => {
  it('finds integers and decimals, ignoring thousands commas', () => {
    expect(extractNumbers('Revenue $412.3 million, 1,240 staff')).toEqual(['412.3', '1240']);
  });
});
