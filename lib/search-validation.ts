/**
 * Keep request validation aligned with classifier.compactText().
 *
 * The matcher intentionally supports ASCII letters/digits and CJK Unified
 * Ideographs. Other Unicode scripts are not searchable by the current
 * classifier, so accepting them at the API boundary would produce a later
 * crawler error instead of a useful 400 response.
 */
export function validSearchKeyword(value: string): boolean {
  return /[0-9a-z\u4e00-\u9fff]/i.test(value);
}
