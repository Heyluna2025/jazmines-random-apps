# For the office-building session: Kristina's inbox cleanup (from Jazmine, 13-14 Nov)

Jazmine wants jazmine@gotoluna.com almost empty by 8:00 AM every day, with only what needs her left in the inbox, tagged Urgent or Important.

## Blocker found
None of the three inboxes has granted the archive permission (gmail.modify), so Kristina's 5 AM tidy-up has never archived anything. The archive log table is empty.
Jazmine must sign in again once for jazmine@gotoluna.com (send /google to Mimi) and allow the new permission.

## Code changes needed in the shared archive module used by ao-tick
1. **Circle rule.** Archive every email from a circle.so sender, even when the plain-code keep filter matches words like "student", "log in" or "code". Keep only Circle mail about plan, billing or API limits. A lesson saying this is already saved for Kristina in the knowledge table.
2. **Two more labels.** Let the change function also add the labels "Urgent" and "Important ⭐". Both already exist in jazmine@gotoluna.com. Kristina should tag kept emails: Urgent for payment approvals, security alerts and deadlines today; Important for anything else that needs Jazmine.
3. **Bigger daily pass.** The pass looks at 40 emails from the last 14 days. Raise it so a full day of mail is handled, and keep running at 5 AM so the inbox is clean by 8 AM.
4. **One-time backlog sweep.** The inbox holds about 9,800 conversations. Use Gmail batchModify, up to 1,000 messages per call, to archive inbox mail older than 7 days that is not starred and not labeled Urgent or Important ⭐. Nothing is deleted; it stays searchable under All Mail.

## Already done by the admin session
- Labels "Urgent" and "Important ⭐" created in jazmine@gotoluna.com.
- Urgent: UnionBank payment waiting for her approval.
- Important ⭐: Google security alert for admin@aiempoweredclub.com, Later's Instagram connection expired, Circle API limit at 80%, Metrobank RTGS change from 15 Nov, Hi-Precision reply to LUNA outreach.
- About 35 newsletters and promotions from 11 to 13 Nov archived.
- Circle bulk archive was started but cut off by a container restart, so it is incomplete.
