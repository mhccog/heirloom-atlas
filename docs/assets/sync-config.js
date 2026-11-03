/* Address of the Notion sync service (Cloudflare Worker). Not a secret: the Worker refuses anyone without the passphrase.
   Filled in by scripts/deploy-sync.sh. Empty means sync stays off until an address is entered under Notion sync → Advanced. */
window.HEIRLOOM_SYNC = { url: '' };
