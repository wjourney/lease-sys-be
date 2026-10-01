/** expiresAt stores a date-only value at UTC midnight; it remains valid through that Hong Kong calendar day. */
export function accountExpired(
  expiresAt: Date | null | undefined,
  now = new Date(),
) {
  return (
    !!expiresAt && now.getTime() >= expiresAt.getTime() + 16 * 60 * 60 * 1000
  );
}
