import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import {
  cert,
  getApps,
  initializeApp,
} from "firebase-admin/app";

import {
  getAuth,
} from "firebase-admin/auth";

const __filename =
  fileURLToPath(
    import.meta.url
  );

const __dirname =
  path.dirname(
    __filename
  );

const serviceAccountPath =
  process.env.RENDER
    ? "/etc/secrets/firebase-service-account.json"
    : path.join(
        __dirname,
        "firebase-service-account.json"
      );

function getFirebaseAdmin() {
  if (getApps().length > 0) {
    return getAuth();
  }

  if (
    !fs.existsSync(
      serviceAccountPath
    )
  ) {
    throw new Error(
      "Firebase service account JSON not found."
    );
  }

  const serviceAccount =
    JSON.parse(
      fs.readFileSync(
        serviceAccountPath,
        "utf8"
      )
    );

  initializeApp({
    credential:
      cert(serviceAccount),
  });

  return getAuth();
}

export default getFirebaseAdmin;