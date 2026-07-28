import { describe, it, expect } from 'vitest';
import { isUkrainianOnly, findDisallowedLatinTokens } from '../src/validation';

describe('isUkrainianOnly', () => {
  it('accepts pure Ukrainian text', () => {
    expect(isUkrainianOnly('Дослідники синтезували нову сполуку.')).toBe(true);
  });

  it('rejects English words left in the body', () => {
    expect(isUkrainianOnly('Дослідники виявили the new compound.')).toBe(false);
    expect(findDisallowedLatinTokens('Дослідники виявили the new compound.')).toEqual([
      'the',
      'new',
      'compound',
    ]);
  });

  it('allows chemical formulas through', () => {
    expect(isUkrainianOnly('Формула кухонної солі — NaCl, а води — H2O.')).toBe(true);
    expect(isUkrainianOnly('Глюкоза має формулу C6H12O6.')).toBe(true);
  });

  it('allows permitted SI units and pH', () => {
    expect(isUkrainianOnly('Розчин мав pH 7 і масу 5 mg.')).toBe(true);
  });

  it('rejects a Latin acronym that is not a valid element chain', () => {
    expect(isUkrainianOnly('Дослідники використали DNA-секвенування.')).toBe(false);
  });

  it('allows Roman numerals used for centuries', () => {
    expect(isUkrainianOnly('Це відбулося у XIX столітті.')).toBe(true);
    expect(isUkrainianOnly('Подія XX століття.')).toBe(true);
  });
});
