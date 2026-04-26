export function hasRole(
  role: string | string[] | undefined | null,
  ...required: string[]
): boolean {
  if (!role) return false;
  const owned = (
    Array.isArray(role) ? role : role.split(',').map((r) => r.trim())
  )
    .filter((r) => r.length > 0)
    .map((r) => r.toLowerCase());
  return required.some((r) => owned.includes(r.toLowerCase()));
}
