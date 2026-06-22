const authDisabledEnv = import.meta.env.VITE_AUTH_DISABLED;

export const AUTH_DISABLED = authDisabledEnv === undefined
  ? false
  : authDisabledEnv !== 'false';

type AuthUserData = { id: string; email: string; name: string };
type AuthOrgData = { id: string; name: string; slug: string };

export const LOCAL_AUTH_USER: AuthUserData | null = AUTH_DISABLED
  ? { id: 'local-admin', email: 'admin@nexus.local', name: 'Local Admin' }
  : null;

export const LOCAL_AUTH_ORG: AuthOrgData | null = AUTH_DISABLED
  ? { id: 'local-org', name: 'Nexus Local', slug: 'nexus-local' }
  : null;
