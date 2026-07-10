/** Shape of the authenticated principal attached to each request. */
export interface AuthUser {
  id: string;
  email: string;
  role: string;
  fullName: string;
  permissions: string[];
  mfaEnabled: boolean;
}

/** Access-token JWT payload. */
export interface AccessTokenPayload {
  sub: string;
  email: string;
  role: string;
  name: string;
  perms: string[];
  mfa: boolean;
  typ: 'access';
}

/** Short-lived step-up token issued right after a successful TOTP check. */
export interface StepUpTokenPayload {
  sub: string;
  typ: 'stepup';
}
