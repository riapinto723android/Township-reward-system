# Township Reward System

A co-op rewards tracker for a 20-player township: trophies, diamonds, tasks, and chat.

## Features

1. **Township trophies**: the township's total, a tier road (Sprout → Legend), progress to the next tier, and a trophies-per-day chart.
2. **Township diamonds**: a diamond vault where each player's diamonds always equal their trophies (1 trophy = 1 diamond by default; the rate can be changed to 1:2, 1:5 or 1:10), vault chests every 1,000 diamonds, and diamonds per player.
3. **20 players**: a podium, player cards and a sortable table with each player's trophies, diamonds and tasks. Tap a player to rename them, pick a color, correct totals or send a message.
4. **Tasks**: log completed tasks by type (Regatta, helicopter, train, airplane, ship, zoo, factory, other). The page shows total tasks for each player, tasks by type, and a task log where entries can be removed.
5. **Chat**: a group chat (Town square) for all 20 players and a private chat between any two players, with unread badges.

## Live site

https://riapinto723android.github.io/Township-reward-system/

No sign-up, no email and no personal details are needed. Players just open the link and pick their
player slot under **Who are you?**

### Turning on GitHub Pages (one time)

1. Open the repository's **Settings → Pages**.
2. Under **Build and deployment**, set **Source** to **Deploy from a branch**.
3. Pick branch **main** and folder **/ (root)**, then **Save**.

The site goes live at the address above within a minute or two, and redeploys on every push to `main`.

## Where data is saved

The GitHub Pages site saves to **each browser on its own device** (localStorage). Tabs on the same device
stay in sync, but other players don't see your tasks or messages. The first visit shows example data;
use **Start fresh** to clear it.

To share trophies, tasks and chat between players' phones without accounts or emails, the site needs a
database service (for example Firebase with anonymous sign-in). `app.js` keeps all saving in one store
object, so a shared store only needs `addActivity`, `removeActivity`, `setPlayer`, `setTown` and `addMessage`.

## Running it locally

Open `index.html` in a browser. There's no build step.
