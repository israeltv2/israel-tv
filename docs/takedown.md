# Removal requests

Israel TV links to what Israeli broadcasters publish for free on their own sites; it hosts no video. If you are the
rights holder (or act for one) and want a show, a channel or a whole source removed from the public addon, write to
**israeltv2@proton.me** with:

- what it is: the show's name, or its address in the app (a series id like `iltv_kan_17`), or the channel;
- who you are and why (you own it, you act for the owner, or it should not be public);
- how to reach you.

What happens next:

1. **Within 2 days** we answer and take it off while we look at it: the item is added to the public instance's
   `hide` setting ([configuration](configuration.md#hide--taking-something-off-without-a-code-change)) and the
   service is restarted, which publishes the catalog without it. Nothing else changes, and no code change is needed.
2. We check the request and tell you the outcome. If it stays off, it stays in `hide`; if it was a mistake, it comes
   back with the same ids, so viewers' watch progress is intact.
3. We keep a short private note of the request (date, item, outcome) and nothing more.

Self-hosted copies are run by the people who run them: the same `hide` setting is how they take something off.

Security problems are not removal requests: see [SECURITY.md](../SECURITY.md).
