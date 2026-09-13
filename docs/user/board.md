# Board

The board shows every unarchived thread across your connected environments as a
card in one of four columns, so you can see at a glance which agents are waiting
on you, which are working, and which are idle.

On web and desktop, open it from the sidebar footer, from the command palette
(**Open board**), or with `Cmd/Ctrl+Shift+B`. The same shortcut closes it again.
The sidebar icon carries the number of cards in **Needs you**. The board is not
available on mobile.

## Columns

- **Needs you**: the agent is blocked on an approval or a question, has a plan
  waiting for your go-ahead, or failed. The longest wait is at the top.
- **Working**: the agent is starting, running, or still has background work.
- **Done**: the last turn finished within the past 24 hours and nobody has
  moved on from it yet.
- **Parked**: snoozed, settled, older than 24 hours, or never run.

Columns follow the thread's state; you cannot drag cards between them. Use the
card's actions instead.

## Act on a card

Click a card to open its actions without leaving the board. Enter opens the
focused card and Esc closes it. Double-click a card, or use **Open**, to go to
the thread.

- Questions show their options and a field for a typed answer. Number keys
  `1`-`9` pick an option while no field has focus. Multi-question prompts step
  through one question at a time; the answer is sent after the last one.
- Approvals show the request and the same decisions the chat offers.
- A plan shows its first lines and **Implement plan**, which starts the
  implementation in that thread.
- A failed, done, or parked thread takes a one-line next instruction. It sends
  with the thread's current model and mode; attachments, model changes, and
  slash commands still need the thread itself.
- **Stop** interrupts a working thread. **Snooze**, **Unsnooze**, **Un-settle**,
  and **Archive** work as they do in the thread menu.

The popover closes when the card moves to another column, for example once an
answered question starts the agent again.

## Filter by project

Use the project menu in the header to narrow the board to one project. The
filter lives in the page URL, so a shared link keeps it, and opening the board
from the sidebar always shows every project.
