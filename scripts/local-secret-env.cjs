'use strict';

const { existsSync, readFileSync } = require('fs');

const LOCAL_ENV_PATH = '.env.local';

function loadLocalSecretEnv() {
  if (!existsSync(LOCAL_ENV_PATH)) {
    throw new Error('Missing .env.local local secret source.');
  }

  for (const raw of readFileSync(LOCAL_ENV_PATH, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const separator = line.indexOf('=');
    if (separator < 1) continue;
    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (key && !process.env[key]) process.env[key] = value;
  }
}

function requireLocalSecret(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required local secret: ${name}.`);
  return value;
}

function requireLocalAdminCredentials() {
  return {
    email: requireLocalSecret('BILLING_LOCAL_ADMIN_EMAIL'),
    password: requireLocalSecret('BILLING_LOCAL_ADMIN_PASSWORD'),
  };
}

function requireHaciendaSandboxCredentials() {
  return {
    username: requireLocalSecret('F4S_SANDBOX_USERNAME'),
    password: requireLocalSecret('F4S_SANDBOX_PASSWORD'),
  };
}

module.exports = {
  loadLocalSecretEnv,
  requireLocalSecret,
  requireLocalAdminCredentials,
  requireHaciendaSandboxCredentials,
};
