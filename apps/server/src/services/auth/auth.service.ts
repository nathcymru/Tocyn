import * as jose from "jose";
import { JWTPayload, User } from "../../types";
import { Env } from "../../bindings";
import { UserAuthResolver } from "../../auth/user-auth-resolver";

export class AuthService {
  constructor(private env?: Env) {}

  /**
   * Generates an aud: "app" JWT with an explicitly supplied authentication state.
   * Unverified tokens are intentionally rejected by protected routes.
   * Use generateMfaChallengeToken for the MFA challenge flow.
   */
  public async generateToken(
    user: User | { id: string; email: string; role: string; tenant_id?: string },
    secret: string,
    mfaVerified: boolean,
    expiresIn: string = "24h"
  ): Promise<string> {
    if (typeof mfaVerified !== "boolean") {
      throw new Error("Explicit MFA verification state required");
    }
    const alg = "HS256";
    const secretKey = new TextEncoder().encode(secret);

    const tenantId = (user as any).tenant_id;
    if (!tenantId || typeof tenantId !== "string" || !tenantId.trim()) {
      throw new Error("Missing tenant context for token generation");
    }

    const payload: JWTPayload & { tenant_id?: string } = {
      sub: user.id,
      email: user.email,
      role: user.role as any,
      tenant_id: tenantId,
      mfa_verified: mfaVerified,
      iat: Math.floor(Date.now() / 1000),
      exp: 0,
    };

    const token = await new jose.SignJWT({ ...payload })
      .setProtectedHeader({ alg })
      .setAudience("app")
      .setIssuedAt()
      .setExpirationTime(expiresIn)
      .sign(secretKey);

    return token;
  }

  /**
   * Generates a short-lived MFA challenge token with aud: "mfa-challenge".
   */
  public async generateMfaChallengeToken(
    user: User | { id: string; email: string; role: string; tenant_id?: string },
    secret: string,
    expiresIn: string = "15m"
  ): Promise<string> {
    const tenantId = (user as any).tenant_id;
    if (!tenantId || typeof tenantId !== "string" || !tenantId.trim()) {
      throw new Error("Missing tenant context for MFA challenge token generation");
    }

    const alg = "HS256";
    const secretKey = new TextEncoder().encode(secret);

    const payload: JWTPayload & { tenant_id?: string } = {
      sub: user.id,
      email: user.email,
      role: user.role as any,
      tenant_id: tenantId,
      mfa_verified: false,
      iat: Math.floor(Date.now() / 1000),
      exp: 0,
    };

    const token = await new jose.SignJWT({ ...payload })
      .setProtectedHeader({ alg })
      .setAudience("mfa-challenge")
      .setIssuedAt()
      .setExpirationTime(expiresIn)
      .sign(secretKey);

    return token;
  }

  /**
   * Verifies a JWT token using aud: "app".
   */
  public async verifyToken(token: string): Promise<User | null> {
    if (!this.env?.JWT_SECRET) return null;

    try {
      const secretKey = new TextEncoder().encode(this.env.JWT_SECRET);
      const { payload } = await jose.jwtVerify(token, secretKey, {
        audience: "app",
      });

      const jwtPayload = payload as unknown as JWTPayload;

      if (jwtPayload.mfa_verified !== true) {
        return null;
      }

      const tenantId = (jwtPayload as any).tenant_id;
      if (!tenantId || typeof tenantId !== "string" || !tenantId.trim()) return null;
      if (!jwtPayload.sub) return null;

      if (!this.env?.DB) return null;

      const resolver = new UserAuthResolver(this.env.DB);
      const resolved = await resolver.resolveUserById(tenantId, jwtPayload.sub);
      if (!resolved || resolved.role !== jwtPayload.role) return null;
      return {
        id: resolved.userId,
        email: resolved.email,
        full_name: resolved.fullName,
        role: resolved.role,
        tenant_id: resolved.tenantId,
      } as any;
    } catch (err) {
      console.error("Token verification failed:", err);
      return null;
    }
  }

  /**
   * Verifies the password against the hash.
   */
  public async verifyPassword(password: string, storedHash: string): Promise<boolean> {
    const parts = storedHash.split(":");
    if (parts.length !== 3) return false;

    const salt = this.base64ToUint8Array(parts[0]);
    const iterations = parseInt(parts[1], 10);
    const hash = this.base64ToUint8Array(parts[2]);

    const passwordBuffer = new TextEncoder().encode(password);
    const key = await crypto.subtle.importKey(
      "raw",
      passwordBuffer,
      { name: "PBKDF2" },
      false,
      ["deriveBits", "deriveKey"]
    );

    const derivedBits = await crypto.subtle.deriveBits(
      {
        name: "PBKDF2",
        salt: salt,
        iterations: iterations,
        hash: "SHA-256",
      },
      key,
      256
    );

    const derivedArray = new Uint8Array(derivedBits);
    if (derivedArray.length !== hash.length) return false;

    let equal = true;
    for (let i = 0; i < hash.length; i++) {
      if (derivedArray[i] !== hash[i]) equal = false;
    }
    return equal;
  }

  /**
   * Hashes a password using PBKDF2.
   */
  public async hashPassword(password: string): Promise<string> {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iterations = 100000;
    const passwordBuffer = new TextEncoder().encode(password);

    const key = await crypto.subtle.importKey(
      "raw",
      passwordBuffer,
      { name: "PBKDF2" },
      false,
      ["deriveBits", "deriveKey"]
    );

    const derivedBits = await crypto.subtle.deriveBits(
      {
        name: "PBKDF2",
        salt: salt,
        iterations: iterations,
        hash: "SHA-256",
      },
      key,
      256
    );

    const hash = new Uint8Array(derivedBits);
    return `${this.uint8ArrayToBase64(salt)}:${iterations}:${this.uint8ArrayToBase64(hash)}`;
  }

  private uint8ArrayToBase64(arr: Uint8Array): string {
    return btoa(String.fromCharCode(...arr));
  }

  private base64ToUint8Array(base64: string): Uint8Array {
    const binaryString = atob(base64);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes;
  }
}

export const authService = new AuthService();
