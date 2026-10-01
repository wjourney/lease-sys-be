export const secret = () => {
  const s = process.env.JWT_SECRET;
  if (!s || s.length < 32)
    throw new Error("JWT_SECRET must contain at least 32 characters");
  return s;
};
export const sessionCookieOptions = {
  secure: process.env.NODE_ENV === "production",
  sameSite: "strict" as const,
  path: "/",
  maxAge: 8 * 3600000,
};
