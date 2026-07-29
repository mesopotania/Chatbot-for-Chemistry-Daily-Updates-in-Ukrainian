const PERMITTED_LATIN_TOKENS = new Set<string>(['nm', 'pm', 'mm', 'cm', 'km', 'kg', 'mg', 'ml', 'kJ', 'mol', 'pH']);

const ELEMENT_SYMBOLS = new Set([
  'H', 'He', 'Li', 'Be', 'B', 'C', 'N', 'O', 'F', 'Ne', 'Na', 'Mg', 'Al', 'Si', 'P', 'S', 'Cl', 'Ar',
  'K', 'Ca', 'Sc', 'Ti', 'V', 'Cr', 'Mn', 'Fe', 'Co', 'Ni', 'Cu', 'Zn', 'Ga', 'Ge', 'As', 'Se', 'Br', 'Kr',
  'Rb', 'Sr', 'Y', 'Zr', 'Nb', 'Mo', 'Tc', 'Ru', 'Rh', 'Pd', 'Ag', 'Cd', 'In', 'Sn', 'Sb', 'Te', 'I', 'Xe',
  'Cs', 'Ba', 'Au', 'Hg', 'Tl', 'Pb', 'Bi', 'Pt',
]);

const LATIN_WORD = /[A-Za-z][A-Za-z0-9]*/g;

function isChemicalFormula(token: string): boolean {
  const segments = token.match(/[A-Z][a-z]?\d*/g);
  if (!segments || segments.join('') !== token) return false;
  return segments.every((seg) => ELEMENT_SYMBOLS.has(seg.match(/^[A-Z][a-z]?/)![0]));
}

const ROMAN_NUMERAL = /^M{0,4}(CM|CD|D?C{0,3})(XC|XL|L?X{0,3})(IX|IV|V?I{0,3})$/;

function isRomanNumeral(token: string): boolean {
  return token.length > 0 && ROMAN_NUMERAL.test(token);
}

export function findDisallowedLatinTokens(text: string): string[] {
  const matches = text.match(LATIN_WORD) ?? [];
  return matches.filter(
    (token) => !PERMITTED_LATIN_TOKENS.has(token) && !isChemicalFormula(token) && !isRomanNumeral(token)
  );
}

export function isUkrainianOnly(text: string): boolean {
  return findDisallowedLatinTokens(text).length === 0;
}

// Converts the plain ASCII digits inside recognised chemical formulas to Unicode
// subscripts (CO2 -> CO₂, H2SO4 -> H₂SO₄). Only touches tokens that pass the
// same formula check used by validation, so ordinary numbers — years, yields,
// percentages — are left untouched. Idempotent: formulas already written with
// subscripts contain no ASCII digits and pass through unchanged.
export function subscriptChemicalFormulas(text: string): string {
  return text.replace(LATIN_WORD, (token) =>
    isChemicalFormula(token) ? token.replace(/[0-9]/g, (d) => String.fromCharCode(0x2080 + Number(d))) : token
  );
}
