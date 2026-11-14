import { Credential } from "mppx";
import { Mppx, Store, tempo } from "mppx/server";
import { db } from "./db";
import { env } from "./env";

// The verified payer is only reported through the payment.success event,
// so remember it against the request being served.
const payers = new WeakMap<object, string>();

function build() {
  const mppx = Mppx.create({
    methods: [
      tempo.charge({
        recipient: env.mppRecipient(),
        testnet: env.mppTestnet(),
        // Replay protection must be shared by every serverless instance.
        store: Store.postgres(db(), { keyPrefix: "podify:" }),
      }),
    ],
    realm: env.mppRealm(),
    secretKey: env.mppSecret(),
  });
  mppx.on("payment.success", (ctx) => {
    if (ctx.payer && ctx.input && typeof ctx.input === "object") payers.set(ctx.input as object, ctx.payer);
  });
  return mppx;
}

let instance: ReturnType<typeof build> | null = null;

/** Server-side MPP handler: issues 402 challenges and verifies payments. */
export function mpp() {
  return (instance ??= build());
}

/** Payer address for the payment that settled on this request. Call only after a successful charge. */
export function payerOf(request: Request): string | undefined {
  const seen = payers.get(request);
  if (seen) return seen;
  try {
    const address = Credential.fromRequest(request).source?.split(":").pop(); // did:pkh:eip155:<chain>:<address>
    return address && /^0x[0-9a-fA-F]{40}$/.test(address) ? address : undefined;
  } catch {
    return undefined;
  }
}

export const episodeCharge = () =>
  mpp().charge({ amount: env.episodePrice(), description: "Podify: one podcast episode from a paper or article" });
