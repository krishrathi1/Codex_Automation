const authDisabledEnv = import.meta.env.VITE_AUTH_DISABLED;

export const AUTH_DISABLED = authDisabledEnv === undefined
  ? true
  : authDisabledEnv !== 'false';

export const LOCAL_AUTH_USER = {
  id: 'local-admin',
  email: 'admin@nexus.local',
  name: 'Local Admin',
};

export const LOCAL_AUTH_ORG = {
  id: 'local-org',
  name: 'Nexus Local',
  slug: 'nexus-local',
};
