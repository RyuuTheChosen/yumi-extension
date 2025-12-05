/**
 * Companion Package Verification Public Key
 *
 * RSA public key for verifying companion package signatures.
 * This prevents MITM attacks and ensures packages come from Yumi.
 *
 * To generate a new key pair, run from apps/api:
 *   node -e "require('./dist/lib/packageSigning.js').setupKeys()"
 */

export const PACKAGE_VERIFICATION_PUBLIC_KEY = `
-----BEGIN PUBLIC KEY-----
[PUBLIC KEY WILL BE INSERTED HERE DURING SETUP]
This is a placeholder. In production, this will contain the actual
RSA-4096 public key generated offline and securely stored.
-----END PUBLIC KEY-----
`.trim()

/**
 * Check if package signing is enabled
 * Only enable after generating keys and deploying
 */
export const PACKAGE_SIGNING_ENABLED = false

/**
 * Instructions for enabling package signing:
 *
 * 1. Generate key pair (run once, offline):
 *    cd apps/api
 *    node -e "require('./dist/lib/packageSigning.js').setupKeys()"
 *
 * 2. Store private key securely:
 *    - Add to API .env: PACKAGE_SIGNING_PRIVATE_KEY="..."
 *    - Never commit to version control
 *
 * 3. Update this file:
 *    - Replace PACKAGE_VERIFICATION_PUBLIC_KEY with generated public key
 *    - Set PACKAGE_SIGNING_ENABLED = true
 *
 * 4. Re-sign all existing companions:
 *    - Run signing script to add signatures to database
 *    - Update all companion records with new signatures
 *
 * 5. Deploy:
 *    - Deploy API with private key env var
 *    - Deploy extension with updated public key
 */
