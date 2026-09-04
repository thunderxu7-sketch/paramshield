import { PrivyClient } from "@privy-io/node";

async function main() {
  const appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID;
  const appSecret = process.env.PRIVY_APP_SECRET;

  if (!appId || !appSecret) {
    console.log(
      JSON.stringify(
        {
          integration: "privy",
          sdkImport: "ok",
          authenticatedRead: "not-run",
          reason:
            "NEXT_PUBLIC_PRIVY_APP_ID and PRIVY_APP_SECRET are not configured",
        },
        null,
        2,
      ),
    );
    return;
  }

  const privy = new PrivyClient({ appId, appSecret });
  const wallets = await privy.wallets().list({ limit: 1 });

  console.log(
    JSON.stringify(
      {
        integration: "privy",
        sdkImport: "ok",
        authenticatedRead: "ok",
        returnedWallets: wallets.data.length,
        nextCursorPresent: Boolean(wallets.next_cursor),
      },
      null,
      2,
    ),
  );
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unknown error";
  console.error(`Privy spike failed: ${message}`);
  process.exitCode = 1;
});
