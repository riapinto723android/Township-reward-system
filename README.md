# Township Reward System

A co-op rewards tracker for a 20-player township: trophies, diamonds, tasks, and chat.

## Features

1. **Township trophies**: the township's total, a tier road (Sprout → Legend), progress to the next tier, and a trophies-per-day chart.
2. **Township diamonds**: a diamond vault where each player's diamonds always equal their trophies (1 trophy = 1 diamond by default; the rate can be changed to 1:2, 1:5 or 1:10), vault chests every 1,000 diamonds, and diamonds per player.
3. **20 players**: a podium, player cards and a sortable table with each player's trophies, diamonds and tasks. Tap a player to rename them, pick a color, correct totals or send a message.
4. **Tasks**: log completed tasks by type (Regatta, helicopter, train, airplane, ship, zoo, factory, other). The page shows total tasks for each player, tasks by type, and a task log where entries can be removed.
5. **Chat**: a group chat (Town square) for all 20 players and a private chat between any two players, with unread badges.

## Running it

It is a static site with no build step: `index.html`, `styles.css` and `app.js`.

- **Locally**: open `index.html` in a browser.
- **GitHub Pages**: Settings → Pages → Deploy from branch → pick the branch and `/ (root)`.
  The site will be served at `https://<your-username>.github.io/Township-reward-system/`.

### Where data is saved

- On GitHub Pages or a local file, data is saved in **that browser only** (localStorage). Tabs on the same
  device stay in sync, but other players won't see your changes. The first visit shows example data; use **Start fresh** to clear it.
- When published as a shared claude.ai artifact, the same code detects the shared database and everyone with access
  sees the same trophies, tasks and chats live.

To run a shared version on your own hosting you'd need a backend (for example Firebase or Supabase). Swap
`localStore` in `app.js` for one that uses it: it only needs `addActivity`, `removeActivity`, `setPlayer`, `setTown` and `addMessage`.
