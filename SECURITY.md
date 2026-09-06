# Security Policy

[![Security Policy](https://shieldcn.dev/badge/Security-Policy-blue.svg?logo=github)](https://github.com/nathcymru/Tocyn/security/policy)

## Supported Versions

Tocyn is currently in active development. Security updates are provided for the latest major version. Legacy branches or commits preceding the fork from Luminatik are not supported under this policy.

| Version | Supported          |
| ------- | ------------------ |
| 1.x.x   | :white_check_mark: |
| < 1.0.0 | :x:                |

## Reporting a Vulnerability

We take the security of Tocyn and its multi-tenant architecture seriously. If you discover a security vulnerability, please do not disclose it publicly on the issue tracker or in discussions.

### How to Report

Please report all security vulnerabilities using GitHub's Private Vulnerability Reporting feature:

1. Go to the [Security tab](https://github.com/nathcymru/Tocyn/security) of this repository.
2. Click on **Advisories** in the left sidebar.
3. Click the **Report a vulnerability** button.
4. Provide a detailed description of the vulnerability, including:
   - A summary of the issue.
   - Steps to reproduce the vulnerability.
   - The potential impact on tenant isolation, edge routing, or data integrity (D1/R2).
   - Any proof-of-concept code.

### What to Expect

- **Acknowledgement:** We aim to acknowledge receipt of your vulnerability report within 48 hours.
- **Triage:** We will verify the vulnerability and determine its severity based on our Cloudflare edge architecture. 
- **Resolution:** If the vulnerability is accepted, we will develop a patch, publish a GitHub Security Advisory, and credit you for the discovery.

## Scope and Infrastructure

Tocyn is built exclusively on the Cloudflare serverless edge. When evaluating vulnerabilities, please consider the following architectural constraints:
- **Tenant Isolation:** Tenant data in Cloudflare D1 is separated logically via application middleware. Vulnerabilities allowing cross-tenant data leakage are treated as critical.
- **Execution Environment:** Cloudflare Workers do not use a traditional Node.js runtime. Vulnerabilities dependent on standard Node.js APIs are generally out of scope unless they specifically bypass the Cloudflare V8 isolate constraints.
- **Transient Access:** Exploits targeting our presigned URL generation for Cloudflare R2 object storage are in scope.
