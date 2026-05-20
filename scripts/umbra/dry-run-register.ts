import { getUserRegistrationFunction } from "@umbra-privacy/sdk/registration";
import type {
  SignedTransaction,
  TransactionSignature,
} from "@umbra-privacy/sdk";
import { getDevnetUmbraClient, jsonSafe } from "./lib.js";

const client = await getDevnetUmbraClient();
const register = getUserRegistrationFunction(
  { client },
  {
    rpc: {
      transactionForwarder: {
        forwardSequentially: (transactions: readonly SignedTransaction[]) => {
          console.log(
            `Forwarder received ${transactions.length} transaction(s)`,
          );
          console.log(jsonSafe(transactions[0]));
          return Promise.resolve(["DRY_RUN_SIGNATURE" as TransactionSignature]);
        },
        forwardInParallel: (transactions: readonly SignedTransaction[]) =>
          Promise.resolve(
            transactions.map(() => "DRY_RUN_SIGNATURE" as TransactionSignature),
          ),
        fireAndForget: () =>
          Promise.resolve("DRY_RUN_SIGNATURE" as TransactionSignature),
      },
    },
  },
);

const signatures = await register({ confidential: false, anonymous: false });

console.log(jsonSafe(signatures));
