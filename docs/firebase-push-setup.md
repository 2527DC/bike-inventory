# Firebase setup for push notifications — step by step

For whoever sets up push for BCH OPS. At the end you will have pasted **one JSON file and four
short values** into **Settings → Notifications → Push**, and pressed a test button that makes a
notification appear on your phone.

Takes about 15 minutes. Free: Firebase Cloud Messaging costs nothing at this scale.

**What you collect, and where it goes in the app:**

| # | What | Where you get it in Firebase | App field (Settings → Notifications → Push) | Secret? |
|---|---|---|---|---|
| 1 | **Service-account JSON** (a downloaded file) | Project settings → **Service accounts** → Generate new private key | **Service-account JSON** — paste the whole file | **YES** |
| 2 | `apiKey` | Project settings → **General** → Your apps → Web app → SDK setup and configuration | **Web API key** | no |
| 3 | `messagingSenderId` | same place | **Messaging sender id** | no |
| 4 | `appId` | same place | **Web app id** | no |
| 5 | **VAPID public key** (Web Push certificate) | Project settings → **Cloud Messaging** → Web Push certificates | **VAPID public key** | no |
| — | `projectId` | inside the JSON | **Firebase project id** — leave blank, it fills itself | no |

---

## Before you start

- A Google account that will **own** the Firebase project. Use a business account
  (e.g. `inventory.bharathcyclehub@gmail.com`), not a personal one, so access survives staff changes.
- A laptop with Chrome. The Firebase console is awkward on a phone.
- An admin login to BCH OPS (the Push tab needs the `settings_notifications` edit permission).
- **Production only:** `NEXTAUTH_URL` on the server must be the real `https://` address of the
  app. Push links are refused by Firebase unless they are https (see `docs/notifications-guide.md`,
  Caution 1).

---

## Step 1 — Create the Firebase project

1. Open **https://console.firebase.google.com** and sign in with the owner account.
2. Click **Create a project** (or **Add project**).
3. **Project name:** `bch-ops` (any name works; it only shows in the console). Continue.
4. **Google Analytics:** turn it **off**. It is not needed for push. Click **Create project**.
5. Wait for "Your new project is ready", then **Continue**.

> Already have a Firebase project for BCH? Use it. Skip to Step 2.

## Step 2 — Register the web app (gets values 2, 3 and 4)

1. On the project home page, click the **Web** icon — it looks like `</>` — under
   "Get started by adding Firebase to your app".
   *(If you don't see it: gear icon ⚙ next to "Project Overview" → **Project settings** →
   **General** → scroll to **Your apps** → **Add app** → **Web**.)*
2. **App nickname:** `BCH OPS web`.
3. **Do NOT tick** "Also set up Firebase Hosting". The app is hosted on the VPS / Vercel.
4. Click **Register app**.
5. Firebase shows a code block like this:

   ```js
   const firebaseConfig = {
     apiKey: "AIzaSyA-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
     authDomain: "bch-ops.firebaseapp.com",
     projectId: "bch-ops",
     storageBucket: "bch-ops.firebasestorage.app",
     messagingSenderId: "123456789012",
     appId: "1:123456789012:web:abcdef1234567890"
   };
   ```

6. Copy three values into a note for now:
   - `apiKey` → will go into **Web API key**
   - `messagingSenderId` → **Messaging sender id**
   - `appId` → **Web app id**
7. Click **Continue to console**. You don't need to install anything — the app already has the
   Firebase SDK.

> Lost the code block? ⚙ **Project settings** → **General** → **Your apps** → your web app →
> **SDK setup and configuration** → choose **Config**. It is shown again there.

## Step 3 — Check that Cloud Messaging (V1) is on

1. ⚙ **Project settings** → **Cloud Messaging** tab.
2. Under **Firebase Cloud Messaging API (V1)** it should say **Enabled**.
3. If it says Disabled: click the **⋮** menu beside it → **Manage API in Google Cloud Console** →
   **Enable**. Come back to the Firebase tab and refresh.

> Ignore "Cloud Messaging API (Legacy)". It is shut down and the app does not use it.

## Step 4 — Generate the Web Push certificate (gets value 5)

1. Still on ⚙ **Project settings** → **Cloud Messaging**.
2. Scroll down to **Web configuration** → **Web Push certificates**.
3. Click **Generate key pair**.
4. A **Key pair** appears — a long string starting with `B`, about 87 characters.
   Copy it → it goes into **VAPID public key**.

> Only generate once. A new pair makes every phone that already enabled push stop receiving
> until it enables again.

## Step 5 — Download the service-account JSON (value 1, the secret one)

1. ⚙ **Project settings** → **Service accounts** tab.
2. Make sure **Firebase Admin SDK** is selected (it is by default). Ignore the code sample.
3. Click **Generate new private key** → **Generate key**.
4. A file downloads, named like `bch-ops-firebase-adminsdk-abc12-1a2b3c4d5e.json`.
5. Open it in a text editor (TextEdit on Mac: right-click → Open With → TextEdit). It looks like:

   ```json
   {
     "type": "service_account",
     "project_id": "bch-ops",
     "private_key_id": "…",
     "private_key": "-----BEGIN PRIVATE KEY-----\n…\n-----END PRIVATE KEY-----\n",
     "client_email": "firebase-adminsdk-abc12@bch-ops.iam.gserviceaccount.com",
     "client_id": "…",
     "token_uri": "https://oauth2.googleapis.com/token",
     …
   }
   ```

   The app checks that `type` is `service_account` and that `project_id`, `private_key`,
   `client_email` and `token_uri` are present. A file missing any of them is refused on save,
   with the missing field named.

> ⚠️ **This file is a password.** Anyone holding it can send notifications as BCH OPS.
> - Do **not** email it, WhatsApp it, commit it to git, or put it in `.env`.
> - After pasting it into the app (Step 6), **delete the downloaded file** and empty the Trash.
> - If it ever leaks: Service accounts → Google Cloud → the service account → **Keys** → delete
>   that key, then generate a new one and paste it again.

## Step 6 — Paste everything into BCH OPS

1. Log in to BCH OPS as an admin. Go to **Settings → Notifications**, open the **Push** tab.
2. Fill in:

   | App field | Paste |
   |---|---|
   | **Firebase project id** | leave **blank** — filled from the JSON |
   | **Service-account JSON** | the **entire** file contents, from the first `{` to the last `}` |
   | **Web API key** | `apiKey` from Step 2 |
   | **Messaging sender id** | `messagingSenderId` from Step 2 |
   | **Web app id** | `appId` from Step 2 |
   | **VAPID public key** | the key pair from Step 4 |

3. Switch **Push enabled** on.
4. Click **Save**. The JSON box now shows `configured (client_email firebase-adminsdk-…)` — the
   app never shows the file again.
5. Delete the downloaded JSON file from your computer (Step 5 warning).

## Step 7 — Turn it on for your device and test

1. Same page, card **This device** → **Enable push on this device**.
2. The browser asks to allow notifications → **Allow**. The device appears under **My devices**
   with the last 6 characters of its token.
3. Click **Send test push to my devices**. Within a few seconds a notification appears.
   The status badge changes to **Connected**.
4. The test push is **not** saved to your **Notifications** list (the bell). Real event
   notifications are, once events start firing.

## Step 8 — Every staff member, once per phone

1. **Install the app first** (this matters on phones):
   - **Android (Chrome):** open the app → ⋮ menu → **Add to Home screen** / **Install app**.
   - **iPhone (Safari, iOS 16.4 or later):** Share button → **Add to Home Screen**. Push does
     **not** work in a normal Safari tab on iPhone — only from the Home Screen app.
2. Open the installed app → **Settings → Notifications → Push → This device → Enable push on this
   device** → **Allow**.
   > ⚠️ **Known gap (23 Sep 2026):** that button is currently **only** on the admin page
   > (`src/app/(dashboard)/settings/notifications/page.tsx:578`). Staff without the
   > `settings_notifications` permission cannot reach it, so they cannot enable push on their own
   > phone yet. Until that is fixed, an admin can sign in on the staff member's phone and press it,
   > or the button is added to a screen everyone has (e.g. `/notifications`).
3. **Sound:** the notification uses the phone's normal notification sound. If there is none, check
   the phone settings (Android: long-press a notification → Settings → Sound; iPhone: Settings →
   Notifications → BCH OPS → Sounds). On Xiaomi / Oppo / Vivo / Realme also set the app's
   battery setting to **No restrictions**, or notifications stop when the app is closed.

---

## If something goes wrong

| What you see | Cause | Fix |
|---|---|---|
| Save refused: `type must be "service_account"` or a field is missing | You pasted the web config or part of the file | Paste the **whole** downloaded JSON (Step 5) |
| Test: `Google OAuth 400 invalid_grant` | The key was deleted in Google Cloud, or the JSON is from another project | Generate a new private key (Step 5) and paste it again |
| Test: `FCM 400 INVALID_ARGUMENT` mentioning a link | `NEXTAUTH_URL` is not `https://` on the server | Fix `NEXTAUTH_URL`, restart the app |
| Test: "You have no registered devices" | Step 7 not done on this browser | **Enable push on this device** first |
| **Enable push** does nothing / permission never asked | Notifications were blocked for the site earlier | Click the padlock in the address bar → Notifications → **Allow**, reload |
| Works on laptop, not on the phone | App not installed to the Home Screen, or phone blocks notifications for Chrome | Step 8 |
| Worked, then stopped on one phone | Its token expired or the site data was cleared | Enable push on that device again |
| Everyone stopped after someone "regenerated" the Web Push key | Step 4 was redone | Every device enables push again |

More detail on how notifications flow, and where to look when one does not arrive:
`docs/notifications-guide.md` §4 and §6.

---

## Checklist

- [ ] Firebase project created (Step 1)
- [ ] Web app registered; `apiKey`, `messagingSenderId`, `appId` copied (Step 2)
- [ ] Cloud Messaging API (V1) shows **Enabled** (Step 3)
- [ ] Web Push key pair generated and copied (Step 4)
- [ ] Service-account JSON downloaded (Step 5)
- [ ] All values pasted, Push enabled, **Save** (Step 6)
- [ ] Downloaded JSON **deleted** from the computer
- [ ] Enable push on this device → **Send test push** → notification arrived, badge **Connected** (Step 7)
- [ ] Staff told to install the app and enable push on their phones (Step 8)
