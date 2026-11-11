/*
 * A software authenticator for tests: P-256 ES256, attestation fmt "none".
 * It produces responses that @simplewebauthn/server will verify.
 */
import { createHash, createPrivateKey, generateKeyPairSync, sign as cryptoSign } from "node:crypto";
import { isoBase64URL, isoCBOR } from "@simplewebauthn/server/helpers";
import type { AuthenticationResponseJSON, RegistrationResponseJSON } from "@simplewebauthn/server";

export class SoftwarePasskey {
  credId: Uint8Array;
  privateKeyPem: string;
  publicJwk: { x: string; y: string };
  counter = 0;

  constructor() {
    const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
    this.privateKeyPem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
    this.publicJwk = publicKey.export({ format: "jwk" }) as { x: string; y: string };
    this.credId = crypto.getRandomValues(new Uint8Array(16));
  }

  get id() {
    return isoBase64URL.fromBuffer(this.credId);
  }

  register(opts: { challenge: string; origin: string; rpID: string }): RegistrationResponseJSON {
    const clientDataJSON = Buffer.from(JSON.stringify({
      type: "webauthn.create",
      challenge: opts.challenge,
      origin: opts.origin,
      crossOrigin: false,
    }), "utf8");
    const authData = this.authData(opts.rpID, true);
    const attestationObject = isoCBOR.encode(new Map<string, any>([
      ["fmt", "none"],
      ["attStmt", new Map()],
      ["authData", authData],
    ]));
    return {
      id: this.id,
      rawId: this.id,
      type: "public-key",
      response: {
        clientDataJSON: isoBase64URL.fromBuffer(new Uint8Array(clientDataJSON)),
        attestationObject: isoBase64URL.fromBuffer(attestationObject),
        transports: ["internal"],
      },
      clientExtensionResults: {},
    };
  }

  authenticate(opts: { challenge: string; origin: string; rpID: string }): AuthenticationResponseJSON {
    this.counter += 1;
    const clientDataJSON = Buffer.from(JSON.stringify({
      type: "webauthn.get",
      challenge: opts.challenge,
      origin: opts.origin,
      crossOrigin: false,
    }), "utf8");
    const authData = this.authData(opts.rpID, false);
    const clientHash = createHash("sha256").update(clientDataJSON).digest();
    const signed = Buffer.concat([Buffer.from(authData), clientHash]);
    const der = cryptoSign("sha256", signed, createPrivateKey(this.privateKeyPem));
    return {
      id: this.id,
      rawId: this.id,
      type: "public-key",
      response: {
        clientDataJSON: isoBase64URL.fromBuffer(new Uint8Array(clientDataJSON)),
        authenticatorData: isoBase64URL.fromBuffer(authData),
        signature: isoBase64URL.fromBuffer(new Uint8Array(der)),
        userHandle: undefined,
      },
      clientExtensionResults: {},
    };
  }

  private authData(rpID: string, attest: boolean): Uint8Array {
    const rpIdHash = createHash("sha256").update(rpID).digest();
    const flags = attest ? 0x45 : 0x05; // UP + UV (+ AT when registering)
    const counter = Buffer.alloc(4);
    counter.writeUInt32BE(this.counter);
    const parts: Buffer[] = [rpIdHash, Buffer.from([flags]), counter];
    if (attest) {
      const aaguid = Buffer.alloc(16);
      const idLen = Buffer.alloc(2);
      idLen.writeUInt16BE(this.credId.length);
      const x = Buffer.from(this.publicJwk.x, "base64url");
      const y = Buffer.from(this.publicJwk.y, "base64url");
      const cose = isoCBOR.encode(new Map<number, any>([
        [1, 2],
        [3, -7],
        [-1, 1],
        [-2, new Uint8Array(x)],
        [-3, new Uint8Array(y)],
      ]));
      parts.push(aaguid, idLen, Buffer.from(this.credId), Buffer.from(cose));
    }
    return new Uint8Array(Buffer.concat(parts));
  }
}
