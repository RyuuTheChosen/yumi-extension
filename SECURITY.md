# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 1.0.x   | :white_check_mark: |

## Reporting a Vulnerability

We take security seriously. If you discover a security vulnerability in Yumi, please report it responsibly.

### How to Report

**Email**: security@yumi-pals.com

**Or via Discord**: DM a moderator in our [Discord server](https://discord.gg/QPmrJS8baz)

### What to Include

- Description of the vulnerability
- Steps to reproduce
- Potential impact
- Any suggested fixes (optional)

### What to Expect

- **Acknowledgment**: Within 48 hours
- **Initial Assessment**: Within 7 days
- **Resolution Timeline**: Depends on severity, typically 30-90 days

### Scope

**In Scope:**
- Chrome extension code
- Yumi Hub API
- Website (yumi-pals.com)
- Data handling and storage

**Out of Scope:**
- Third-party dependencies (report to upstream)
- Social engineering attacks
- Physical attacks
- Denial of service attacks

## Security Measures

### Extension Security

- **No remote code execution** - All JavaScript is bundled locally
- **Minimal permissions** - Only requests necessary permissions
- **Local-first storage** - Messages and memories stay in your browser
- **No tracking** - No analytics or telemetry

### API Security

- **SQL Injection Prevention** - Parameterized queries
- **SSRF Protection** - Private IP blocking on image fetcher
- **Rate Limiting** - Brute-force protection on auth endpoints
- **Input Validation** - Zod schemas on all inputs
- **Encrypted Storage** - AES-256-GCM for sensitive data

### Authentication

- **JWT tokens** - Short-lived access (7 days), longer refresh (30 days)
- **Discord OAuth** - No password storage
- **Invite codes** - One-time use, 7-day expiry

## Responsible Disclosure

We kindly ask that you:

1. **Don't** publicly disclose until we've had time to address it
2. **Don't** access or modify other users' data
3. **Don't** perform actions that could harm service availability
4. **Do** provide sufficient detail to reproduce the issue
5. **Do** give us reasonable time to respond

## Recognition

We appreciate security researchers who help keep Yumi safe. With your permission, we'll acknowledge your contribution in our release notes.

## Contact

- **Security Email**: security@yumi-pals.com
- **Discord**: [discord.gg/QPmrJS8baz](https://discord.gg/QPmrJS8baz)
- **GitHub**: [Issues](https://github.com/RyuuTheChosen/yumi-extension/issues) (for non-sensitive bugs only)
