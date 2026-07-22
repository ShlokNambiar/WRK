# WRK — Delete your account & data

WRK ("the app", package `com.metis.wrk`) lets you permanently delete your
account and every piece of data associated with it.

## What gets deleted

Deletion removes, immediately and permanently:

- your WRK account (the sign-in itself)
- your derived daily feed (schedule summary, brief, email-task list)
- your task backup
- your email sender rules (mutes/allows)
- your subscription entitlement record
- the encrypted Google refresh token (WRK's read-only access to your
  Calendar/Gmail ends at that moment)

Your Google account itself is never touched. Nothing is retained after
deletion — WRK stores no email bodies or raw calendar data to begin with (see
the [privacy policy](PRIVACY.html)).

## How to delete

**In the app (instant):** open WRK → **Account** → scroll down →
**Delete account & data** → confirm.

**Without the app** (e.g. already uninstalled): email
**shlok@pepl.life** with the subject "Delete my WRK account" from the Google
address you signed in with. Your account and all data will be deleted within
7 days and you'll get a confirmation reply.

You can also revoke WRK's Google access at any time at
[myaccount.google.com/permissions](https://myaccount.google.com/permissions) —
this stops all data access immediately, independent of account deletion.
